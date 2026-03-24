import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { AlbumDetailPage } from '../pages/album-detail.page';
import { AlbumAccessPage } from '../pages/album-access.page';
import { ALBUMS, MEMBERS } from '../fixtures/test-data';

const ALBUM_ID = ALBUMS.myPrivate.id; // owner, private album

test.describe('Album sharing / access management', () => {
  async function openAccessModal(page: Page) {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.manageAccessButton.click();
    const access = new AlbumAccessPage(page);
    await access.modal.waitFor({ state: 'visible' });
    return access;
  }

  test('Manage access button is visible for album owner', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await expect(detail.manageAccessButton).toBeVisible();
  });

  test('Manage access button is hidden for public albums', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUMS.myPublic.id);
    await expect(detail.manageAccessButton).not.toBeVisible();
  });

  test('access modal opens and shows Manage Access heading for owner', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);
    await expect(access.heading).toContainText('Manage Access');
  });

  test('existing members are listed', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);

    await expect(access.memberList).toBeVisible();
    for (const member of MEMBERS) {
      await expect(access.memberRow(member.email)).toBeVisible();
    }
  });

  test('pending invite member shows Pending invite badge', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);
    const pendingRow = access.memberRow(MEMBERS[1].email);

    await expect(pendingRow.getByText('Pending invite')).toBeVisible();
  });

  test('pending invite member shows copy invite link button', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);
    await expect(access.copyInviteLinkFor(MEMBERS[1].email)).toBeVisible();
  });

  test('add new member shows up in the list', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);

    await access.addMember('newmember@example.com', 'read');

    await expect(access.memberRow('newmember@example.com')).toBeVisible();
  });

  test('add new member with write permission', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);

    await access.addMember('writer@example.com', 'write');

    await expect(access.memberRow('writer@example.com')).toBeVisible();
  });

  test('Add button is disabled when email field is empty', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);
    await expect(access.addButton).toBeDisabled();
  });

  test('changing member permission updates the select value', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);

    const select = access.permissionSelectFor(MEMBERS[0].email);
    await select.selectOption('write');

    // After the PATCH mock responds, the select should remain on "write".
    await expect(select).toHaveValue('write');
  });

  test('remove member hides them from the list', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);

    await access.removeButtonFor(MEMBERS[0].email).click();

    await expect(access.memberRow(MEMBERS[0].email)).not.toBeVisible();
  });

  test('closing the modal hides it', async ({ authedPage: page }) => {
    const access = await openAccessModal(page);
    await access.close();

    await expect(access.modal).not.toBeVisible();
  });
});
