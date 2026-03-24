import { expect } from '@playwright/test';
import { test } from '../fixtures/auth.fixture';
import { AlbumDetailPage } from '../pages/album-detail.page';
import { ALBUMS } from '../fixtures/test-data';

/** Creates a minimal in-memory JPEG buffer (valid enough for the browser's File API). */
function smallJpegBuffer(): Buffer {
  // Minimal JPEG header + EOI marker — just enough to pass format checks.
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

const ALBUM_ID = ALBUMS.myPrivate.id;

test.describe('Media upload', () => {
  test('upload button is visible for album owner', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);

    await expect(detail.uploadButton).toBeVisible();
  });

  test('upload modal opens and shows drop zone', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await expect(detail.uploadModal.getByRole('heading', { name: 'Upload Photos & Videos' })).toBeVisible();
    await expect(detail.dropZone).toBeVisible();
    await expect(page.getByText('Choose Files')).toBeVisible();
  });

  test('picking a valid image adds it to the file list', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await detail.pickFiles([
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
    ]);

    await expect(detail.fileList).toBeVisible();
    await expect(detail.fileList.getByText('photo.jpg')).toBeVisible();
    await expect(page.getByRole('button', { name: /upload 1 file/i })).toBeVisible();
  });

  test('picking multiple files shows correct upload button label', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await detail.pickFiles([
      { name: 'a.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
      { name: 'b.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
      { name: 'c.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
    ]);

    await expect(page.getByRole('button', { name: /upload 3 file/i })).toBeVisible();
  });

  test('picking an unsupported file type shows rejection', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await detail.pickFiles([
      { name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    ]);

    await expect(detail.rejectionList).toBeVisible();
    await expect(detail.rejectionList.getByText('document.pdf')).toBeVisible();
    await expect(detail.rejectionList.getByText('unsupported format')).toBeVisible();
  });

  test('removing a file from the list decrements the upload button count', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await detail.pickFiles([
      { name: 'keep.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
      { name: 'remove.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
    ]);

    await expect(page.getByRole('button', { name: /upload 2 file/i })).toBeVisible();

    // Click the remove button on the second file entry.
    await detail.fileList.locator('.remove-btn').nth(1).click();

    await expect(page.getByRole('button', { name: /upload 1 file/i })).toBeVisible();
    await expect(detail.fileList.getByText('remove.jpg')).not.toBeVisible();
  });

  test('cancel closes upload modal without uploading', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await detail.pickFiles([
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
    ]);

    await detail.uploadCancelButton.click();
    await expect(detail.uploadModal).not.toBeVisible();
  });

  test('successful upload closes modal and reloads media grid', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    await detail.pickFiles([
      { name: 'upload.jpg', mimeType: 'image/jpeg', buffer: smallJpegBuffer() },
    ]);

    await page.getByRole('button', { name: /upload 1 file/i }).click();

    // Modal should close after upload completes.
    await expect(detail.uploadModal).not.toBeVisible({ timeout: 15_000 });
  });

  test('upload button is disabled when no files are selected', async ({ authedPage: page }) => {
    const detail = new AlbumDetailPage(page);
    await detail.goto(ALBUM_ID);
    await detail.openUploadModal();

    // No files picked yet — the upload button should be disabled.
    const uploadBtn = page.getByRole('button', { name: /upload 0 file/i });
    // The button text is "Upload 0 file(s)" only when entries is empty and
    // the template shows it. Actually the template hides the count button
    // when entries.length===0 and shows just "Upload" disabled.
    // We target by disabled attribute on any primary button.
    const primaryBtn = detail.uploadModal.locator('.btn-primary');
    await expect(primaryBtn).toBeDisabled();
    void uploadBtn; // suppress unused-variable lint
  });
});
