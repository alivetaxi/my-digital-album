import { test as base, type Page } from '@playwright/test';
import { setupApiMocks } from './api-mocks';
import { TEST_USER } from './test-data';

type E2eFixtures = {
  /** A page that is already signed in as TEST_USER with API mocks active. */
  authedPage: Page;
};

export const test = base.extend<E2eFixtures>({
  authedPage: async ({ page }, use) => {
    await setupApiMocks(page);

    // Load the app so Firebase initialises and __e2eAuth is available.
    await page.goto('/');

    // Sign in via the helper exposed by app.config.ts in e2e mode.
    await page.evaluate(
      async ({ email, password }) => {
        const auth = (window as Window & { __e2eAuth?: { signIn: (e: string, p: string) => Promise<void> } }).__e2eAuth;
        if (!auth) throw new Error('__e2eAuth not found — is the app built with configuration=e2e?');
        await auth.signIn(email, password);
      },
      { email: TEST_USER.email, password: TEST_USER.password }
    );

    // Wait for Angular to navigate away from the loading state.
    await page.waitForURL(/\/(albums|login)/, { timeout: 15_000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';
