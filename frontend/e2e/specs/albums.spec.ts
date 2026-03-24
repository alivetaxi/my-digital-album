import { expect } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { AlbumListPage } from '../pages/album-list.page';
import { ALBUMS } from '../fixtures/test-data';

test.describe('Album list', () => {
  test('shows My Albums and Shared with Me sections', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await expect(albumList.myAlbumsSection).toBeVisible();
    await expect(albumList.sharedSection).toBeVisible();
    await expect(albumList.albumCard(ALBUMS.myPrivate.title)).toBeVisible();
    await expect(albumList.albumCard(ALBUMS.shared.title)).toBeVisible();
  });

  test('album card displays title, media count and visibility badge', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    const card = albumList.albumCard(ALBUMS.myPrivate.title);
    await expect(card).toContainText(String(ALBUMS.myPrivate.mediaCount));
    await expect(card.locator('.visibility-badge')).toContainText('private');
  });

  test('new album button is visible when authenticated', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await expect(albumList.newAlbumButton).toBeVisible();
  });

  test('create album — modal opens, title typed, album appears in list', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await albumList.openCreateForm();
    await expect(albumList.formModal).toBeVisible();
    await expect(albumList.formModal.getByRole('heading', { name: 'New Album' })).toBeVisible();

    await albumList.fillAlbumForm('My New Album');
    await albumList.submitForm();

    // After save the modal closes and the new album appears in the list.
    await expect(albumList.formModal).not.toBeVisible();
    await expect(albumList.albumCard('My New Album')).toBeVisible();
  });

  test('create album with public visibility', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await albumList.createAlbum('Public Test Album', 'public');

    const card = albumList.albumCard('Public Test Album');
    await expect(card.locator('.visibility-badge')).toContainText('public');
  });

  test('create album — cancel closes modal without adding an album', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await albumList.openCreateForm();
    await albumList.titleInput.fill('Should Not Be Created');
    await albumList.cancelButton.click();

    await expect(albumList.formModal).not.toBeVisible();
    await expect(albumList.albumCard('Should Not Be Created')).not.toBeVisible();
  });

  test('edit album — opens pre-filled modal and saves updated title', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await albumList.clickEdit(ALBUMS.myPrivate.title);
    await expect(albumList.formModal).toBeVisible();
    await expect(albumList.formModal.getByRole('heading', { name: 'Edit Album' })).toBeVisible();

    // Title field should be pre-filled.
    await expect(albumList.titleInput).toHaveValue(ALBUMS.myPrivate.title);

    await albumList.titleInput.fill('Renamed Album');
    await albumList.submitForm();

    await expect(albumList.formModal).not.toBeVisible();
    await expect(albumList.albumCard('Renamed Album')).toBeVisible();
  });

  test('delete album — confirmation dialog; album removed from list', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    // Accept the browser confirm() dialog.
    page.once('dialog', (d) => d.accept());
    await albumList.clickDelete(ALBUMS.myPrivate.title);

    await expect(albumList.albumCard(ALBUMS.myPrivate.title)).not.toBeVisible();
  });

  test('delete album — dismiss confirm dialog keeps album in list', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    page.once('dialog', (d) => d.dismiss());
    await albumList.clickDelete(ALBUMS.myPrivate.title);

    await expect(albumList.albumCard(ALBUMS.myPrivate.title)).toBeVisible();
  });

  test('clicking album card navigates to album detail', async ({ authedPage: page }) => {
    const albumList = new AlbumListPage(page);
    await albumList.goto();

    await albumList.albumCard(ALBUMS.myPrivate.title).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/albums/${ALBUMS.myPrivate.id}`));
  });
});
