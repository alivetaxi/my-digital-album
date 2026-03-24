import { type Page, type Locator } from '@playwright/test';

export class AlbumAccessPage {
  readonly modal: Locator;
  readonly heading: Locator;
  readonly memberList: Locator;
  readonly emptyMessage: Locator;
  readonly emailInput: Locator;
  readonly permissionSelect: Locator;
  readonly addButton: Locator;
  readonly addError: Locator;
  readonly closeButton: Locator;

  constructor(private readonly page: Page) {
    this.modal = page.locator('.modal');
    this.heading = page.getByRole('heading', { name: /manage access|who has access/i });
    this.memberList = page.locator('.member-list');
    this.emptyMessage = page.getByText('No members yet.');
    this.emailInput = page.locator('.add-member-form input[type="email"]');
    this.permissionSelect = page.locator('.add-member-form select');
    this.addButton = page.locator('.add-btn');
    this.addError = page.locator('.add-member-form .error-msg');
    this.closeButton = page.locator('.modal .close-btn');
  }

  memberRow(email: string): Locator {
    return this.memberList.locator('.member-row', { hasText: email });
  }

  permissionSelectFor(email: string): Locator {
    return this.memberRow(email).locator('.permission-select');
  }

  removeButtonFor(email: string): Locator {
    return this.memberRow(email).locator('.remove-btn');
  }

  copyInviteLinkFor(email: string): Locator {
    return this.memberRow(email).locator('.copy-btn');
  }

  async addMember(email: string, permission: 'read' | 'write' = 'read') {
    await this.emailInput.fill(email);
    await this.permissionSelect.selectOption(permission);
    await this.addButton.click();
  }

  async close() {
    await this.closeButton.click();
    await this.modal.waitFor({ state: 'hidden' });
  }
}
