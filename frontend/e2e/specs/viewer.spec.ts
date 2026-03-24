import { expect } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { MediaViewerPage } from '../pages/media-viewer.page';
import { ALBUMS, MEDIA_ITEMS } from '../fixtures/test-data';

const ALBUM_ID = ALBUMS.myPrivate.id;
const FIRST_MEDIA = MEDIA_ITEMS[0];
const SECOND_MEDIA = MEDIA_ITEMS[1];

test.describe('Media viewer', () => {
  test('loads and shows the current media image', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    // Main image renders (src comes from the original-url mock).
    await expect(viewer.mainImage).toBeVisible();
  });

  test('counter shows correct position', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    // Media list has 3 items; first item → "1 / 3"
    await expect(viewer.counter).toContainText('1 / 3');
  });

  test('thumbnail strip renders one button per media item', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    const thumbs = viewer.thumbnailStrip.locator('.strip-thumb');
    await expect(thumbs).toHaveCount(MEDIA_ITEMS.length);
  });

  test('clicking Next arrow advances to the second item', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.navigateNext();
    await expect(viewer.counter).toContainText('2 / 3');
  });

  test('clicking Previous arrow goes back to first item', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    // Start at second item.
    await viewer.goto(ALBUM_ID, SECOND_MEDIA.id);

    await viewer.navigatePrev();
    await expect(viewer.counter).toContainText('1 / 3');
  });

  test('ArrowRight key navigates forward', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.pressArrowRight();
    await expect(viewer.counter).toContainText('2 / 3');
  });

  test('ArrowLeft key navigates backward', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, SECOND_MEDIA.id);

    await viewer.pressArrowLeft();
    await expect(viewer.counter).toContainText('1 / 3');
  });

  test('clicking thumbnail strip item jumps to that item', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    // Click the third thumbnail.
    await viewer.stripThumb(2).click();
    await expect(viewer.counter).toContainText('3 / 3');
  });

  test('existing description is visible on load', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    // FIRST_MEDIA has description "A sunny day"
    await expect(viewer.descriptionText).toContainText(FIRST_MEDIA.description!);
  });

  test('edit description — textarea pre-filled, save updates display', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.startEditDescription();
    await expect(viewer.editTextarea).toBeVisible();
    await expect(viewer.editTextarea).toHaveValue(FIRST_MEDIA.description!);

    await viewer.saveDescription('Updated caption');
    await expect(viewer.editTextarea).not.toBeVisible();
    await expect(viewer.descriptionText).toContainText('Updated caption');
  });

  test('cancel edit description restores display without saving', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.startEditDescription();
    await viewer.editTextarea.fill('Should not be saved');
    await viewer.cancelDescriptionButton.click();

    await expect(viewer.editTextarea).not.toBeVisible();
    await expect(viewer.descriptionText).toContainText(FIRST_MEDIA.description!);
  });

  test('Escape key cancels description edit', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.startEditDescription();
    await viewer.editTextarea.press('Escape');

    await expect(viewer.editTextarea).not.toBeVisible();
  });

  test('add description button shown when media has no description', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    // SECOND_MEDIA has description: null
    await viewer.goto(ALBUM_ID, SECOND_MEDIA.id);

    await expect(viewer.addDescriptionButton).toBeVisible();
    await expect(viewer.descriptionText).not.toBeVisible();
  });

  test('delete media navigates back to album when list becomes empty', async ({ authedPage: page }) => {
    // Override media list to return only one item so deletion empties the list.
    await page.route(/\/api\/albums\/[^/]+\/media(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { items: [MEDIA_ITEMS[0]], nextCursor: null } });
      } else {
        await route.continue();
      }
    });

    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.deleteMedia();

    await expect(page).toHaveURL(new RegExp(`/albums/${ALBUM_ID}`), { timeout: 5_000 });
  });

  test('delete media with multiple items moves to next item', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.deleteMedia();

    // List still has items; stays on viewer at the same index (now showing second item).
    await expect(page).toHaveURL(new RegExp(`/albums/${ALBUM_ID}/media/`));
  });

  test('back button navigates to album detail', async ({ authedPage: page }) => {
    const viewer = new MediaViewerPage(page);
    await viewer.goto(ALBUM_ID, FIRST_MEDIA.id);

    await viewer.backButton.click();
    await expect(page).toHaveURL(new RegExp(`/albums/${ALBUM_ID}$`));
  });
});
