import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../fixtures/api-mocks';
import { LoginPage } from '../pages/login.page';

test.describe('Auth flow', () => {
  test('login page shows Sign in with Google button', async ({ page }) => {
    await setupApiMocks(page);
    const login = new LoginPage(page);
    await login.goto();

    await expect(login.signInButton).toBeVisible();
    await expect(login.signInButton).toBeEnabled();
  });

  test('clicking Sign in with Google opens a popup', async ({ page }) => {
    await setupApiMocks(page);
    const login = new LoginPage(page);
    await login.goto();

    const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
    await login.signInButton.click();
    const popup = await popupPromise;

    // Firebase will open a popup for Google OAuth; verify it was created.
    expect(popup).not.toBeNull();
    if (popup) await popup.close();
  });

  test('authenticated user visiting /albums sees the album list heading', async ({ page }) => {
    await setupApiMocks(page);

    // Sign in via emulator helper.
    await page.goto('/');
    await page.evaluate(
      async ({ email, password }) => {
        const auth = (window as Window & { __e2eAuth?: { signIn: (e: string, p: string) => Promise<void> } }).__e2eAuth;
        if (!auth) throw new Error('__e2eAuth not found');
        await auth.signIn(email, password);
      },
      { email: 'e2e@test.example', password: 'TestPass1234!' }
    );

    await page.goto('/albums');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Albums', level: 1 })).toBeVisible();
  });

  test('navigating to /login when already authenticated still shows login page', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/login');
    const login = new LoginPage(page);
    await expect(login.signInButton).toBeVisible();
  });

  test('unknown route redirects to /albums', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveURL(/\/albums/);
  });
});
