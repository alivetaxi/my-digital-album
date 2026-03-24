import { type Page, type Locator } from '@playwright/test';

export class AlbumDetailPage {
  readonly backButton: Locator;
  readonly uploadButton: Locator;
  readonly editAlbumButton: Locator;
  readonly manageAccessButton: Locator;
  readonly mediaGrid: Locator;
  readonly loadError: Locator;

  // Upload modal
  readonly uploadModal: Locator;
  readonly dropZone: Locator;
  readonly fileInput: Locator;
  readonly fileList: Locator;
  readonly uploadSubmitButton: Locator;
  readonly uploadCancelButton: Locator;
  readonly truncatedWarning: Locator;
  readonly rejectionList: Locator;
  readonly progressSummary: Locator;

  constructor(private readonly page: Page) {
    this.backButton = page.locator('.back-btn');
    this.uploadButton = page.getByTitle('Upload');
    this.editAlbumButton = page.getByTitle('Edit album');
    this.manageAccessButton = page.getByTitle('Manage access');
    this.mediaGrid = page.locator('.media-grid');
    this.loadError = page.locator('.load-error');

    // Upload modal
    this.uploadModal = page.locator('.modal');
    this.dropZone = page.locator('.drop-zone');
    this.fileInput = page.locator('input[type="file"]');
    this.fileList = page.locator('.file-list');
    this.uploadSubmitButton = page.getByRole('button', { name: /upload \d+ file/i });
    this.uploadCancelButton = page.locator('.modal').getByRole('button', { name: 'Cancel' });
    this.truncatedWarning = page.getByText('Only the first 50 files');
    this.rejectionList = page.locator('.rejections');
    this.progressSummary = page.locator('.progress-summary');
  }

  async goto(albumId: string) {
    await this.page.goto(`/albums/${albumId}`);
    // Wait for the media grid to appear; Firestore listeners keep the network
    // busy so 'networkidle' would never resolve.
    await this.page.locator('.media-grid').waitFor({ state: 'visible' });
  }

  mediaCell(index: number): Locator {
    return this.page.locator('.media-cell').nth(index);
  }

  mediaLink(index: number): Locator {
    return this.mediaCell(index).locator('.media-link');
  }

  skeletonCells(): Locator {
    return this.page.locator('.media-cell.skeleton');
  }

  async openUploadModal() {
    await this.uploadButton.click();
    await this.uploadModal.waitFor({ state: 'visible' });
  }

  async pickFiles(files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
    await this.fileInput.setInputFiles(files.map(f => ({
      name: f.name,
      mimeType: f.mimeType,
      buffer: f.buffer,
    })));
  }
}
