import { type Page, type Locator } from '@playwright/test';

export class AlbumListPage {
  readonly heading: Locator;
  readonly newAlbumButton: Locator;
  readonly loadingState: Locator;
  readonly emptyState: Locator;
  readonly myAlbumsSection: Locator;
  readonly sharedSection: Locator;
  readonly publicSection: Locator;
  readonly deleteErrorBanner: Locator;

  // Album form modal
  readonly formModal: Locator;
  readonly titleInput: Locator;
  readonly privateOption: Locator;
  readonly publicOption: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Albums' });
    this.newAlbumButton = page.getByRole('button', { name: 'New album' });
    this.loadingState = page.getByText('Loading…');
    this.emptyState = page.getByText('No albums yet');
    this.myAlbumsSection = page.getByRole('heading', { name: 'My Albums' });
    this.sharedSection = page.getByRole('heading', { name: 'Shared with Me' });
    this.publicSection = page.getByRole('heading', { name: 'Public Albums' });
    this.deleteErrorBanner = page.locator('.delete-error-banner');

    // Modal
    this.formModal = page.locator('.modal');
    this.titleInput = page.getByLabel('Title');
    this.privateOption = page.getByRole('button', { name: 'Private' });
    this.publicOption = page.getByRole('button', { name: 'Public' });
    this.saveButton = page.getByRole('button', { name: /create|save/i });
    this.cancelButton = page.locator('.modal').getByRole('button', { name: 'Cancel' });
  }

  async goto() {
    await this.page.goto('/albums');
    // Wait for the page container to appear rather than 'networkidle'; Firestore
    // listeners keep WebSocket connections open and would block 'networkidle'.
    await this.page.locator('.album-list-page').waitFor({ state: 'visible' });
  }

  albumCard(title: string): Locator {
    return this.page.locator('.album-card', { hasText: title });
  }

  editButtonFor(title: string): Locator {
    return this.albumCard(title).locator('.card-action-btn[title="Edit"]');
  }

  deleteButtonFor(title: string): Locator {
    return this.albumCard(title).locator('.card-action-btn[title="Delete"]');
  }

  /** Hover the album cover to reveal the card action buttons, then click edit. */
  async clickEdit(title: string) {
    await this.albumCard(title).locator('.album-cover').hover();
    await this.editButtonFor(title).click({ force: true });
  }

  /** Hover the album cover to reveal the card action buttons, then click delete. */
  async clickDelete(title: string) {
    await this.albumCard(title).locator('.album-cover').hover();
    await this.deleteButtonFor(title).click({ force: true });
  }

  async openCreateForm() {
    await this.newAlbumButton.click();
    await this.formModal.waitFor({ state: 'visible' });
  }

  async fillAlbumForm(title: string, visibility: 'private' | 'public' = 'private') {
    await this.titleInput.fill(title);
    if (visibility === 'public') {
      await this.publicOption.click();
    } else {
      await this.privateOption.click();
    }
  }

  async submitForm() {
    await this.saveButton.click();
  }

  async createAlbum(title: string, visibility: 'private' | 'public' = 'private') {
    await this.openCreateForm();
    await this.fillAlbumForm(title, visibility);
    await this.submitForm();
  }
}
