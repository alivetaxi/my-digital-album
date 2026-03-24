import { type Page, type Locator } from '@playwright/test';

export class MediaViewerPage {
  readonly mainImage: Locator;
  readonly counter: Locator;
  readonly prevButton: Locator;
  readonly nextButton: Locator;
  readonly deleteButton: Locator;
  readonly backButton: Locator;

  // Description editing
  readonly descriptionText: Locator;
  readonly addDescriptionButton: Locator;
  readonly editDescriptionButton: Locator;
  readonly editTextarea: Locator;
  readonly saveDescriptionButton: Locator;
  readonly cancelDescriptionButton: Locator;

  // Error states
  readonly deleteErrorBanner: Locator;
  readonly loadError: Locator;

  // Thumbnail strip
  readonly thumbnailStrip: Locator;

  constructor(private readonly page: Page) {
    this.mainImage = page.locator('.main-image');
    this.counter = page.locator('.counter');
    this.prevButton = page.getByRole('button', { name: 'Previous' });
    this.nextButton = page.getByRole('button', { name: 'Next' });
    this.deleteButton = page.getByTitle('Delete');
    this.backButton = page.locator('.back-btn');

    this.descriptionText = page.locator('.media-description');
    this.addDescriptionButton = page.locator('.add-desc-btn');
    this.editDescriptionButton = page.locator('.edit-icon-btn');
    this.editTextarea = page.locator('.edit-input');
    this.saveDescriptionButton = page.locator('.edit-save');
    this.cancelDescriptionButton = page.locator('.edit-cancel');

    this.deleteErrorBanner = page.locator('.error-banner');
    this.loadError = page.getByText('Failed to load media.');

    this.thumbnailStrip = page.locator('.thumbnail-strip');
  }

  async goto(albumId: string, mediaId: string) {
    await this.page.goto(`/albums/${albumId}/media/${mediaId}`);
    await this.page.locator('.viewer-page').waitFor({ state: 'visible' });
  }

  async navigateNext() {
    await this.nextButton.click();
  }

  async navigatePrev() {
    await this.prevButton.click();
  }

  async pressArrowRight() {
    await this.page.locator('.viewer-page').focus();
    await this.page.keyboard.press('ArrowRight');
  }

  async pressArrowLeft() {
    await this.page.locator('.viewer-page').focus();
    await this.page.keyboard.press('ArrowLeft');
  }

  async startEditDescription() {
    const addBtn = this.addDescriptionButton;
    const editBtn = this.editDescriptionButton;
    if (await addBtn.isVisible()) {
      await addBtn.click();
    } else {
      await editBtn.click();
    }
  }

  async saveDescription(text: string) {
    await this.editTextarea.fill(text);
    await this.saveDescriptionButton.click();
  }

  async deleteMedia() {
    this.page.once('dialog', (d) => d.accept());
    await this.deleteButton.click();
  }

  stripThumb(index: number): Locator {
    return this.thumbnailStrip.locator('.strip-thumb').nth(index);
  }
}
