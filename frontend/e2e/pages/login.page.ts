import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  readonly signInButton: Locator;

  constructor(private readonly page: Page) {
    this.signInButton = page.getByRole('button', { name: /continue with google/i });
  }

  async goto() {
    await this.page.goto('/login');
  }

  /** Returns the popup that opens when clicking Sign in with Google. */
  async clickSignIn() {
    const popup = this.page.waitForEvent('popup');
    await this.signInButton.click();
    return popup;
  }
}
