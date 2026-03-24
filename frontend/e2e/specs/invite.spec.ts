import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../fixtures/api-mocks';
import { test as authTest } from '../fixtures/auth.fixture';
import { ALBUMS } from '../fixtures/test-data';

const VALID_INVITE_URL = `/invite?albumId=${ALBUMS.shared.id}&token=valid-token-abc`;

test.describe('Invite accept — unauthenticated', () => {
  test('invalid invite link (missing params) shows error', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/invite');

    await expect(page.getByText('Invalid invite link.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to albums' })).toBeVisible();
  });

  test('invite with missing albumId shows error', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/invite?token=abc123');

    await expect(page.getByText('Invalid invite link.')).toBeVisible();
  });

  test('invite with missing token shows error', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto(`/invite?albumId=${ALBUMS.shared.id}`);

    await expect(page.getByText('Invalid invite link.')).toBeVisible();
  });

  test('unauthenticated user sees sign-in prompt', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto(VALID_INVITE_URL);

    await expect(
      page.getByText('You need to be signed in to accept this invitation.')
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in to accept/i })).toBeVisible();
  });

  test('sign-in link on invite page includes returnUrl', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto(VALID_INVITE_URL);

    const signInLink = page.getByRole('link', { name: /sign in to accept/i });
    const href = await signInLink.getAttribute('href');

    expect(href).toContain('/login');
    expect(href).toContain(encodeURIComponent('/invite'));
    expect(href).toContain(ALBUMS.shared.id);
  });
});

test.describe('Invite accept — authenticated', () => {
  authTest('authenticated user sees success and gets redirected', async ({ authedPage: page }) => {
    await page.goto(VALID_INVITE_URL);

    await expect(page.getByText('You now have access. Redirecting…')).toBeVisible();

    // After 1.5 s the component navigates to the album.
    await expect(page).toHaveURL(
      new RegExp(`/albums/${ALBUMS.shared.id}`),
      { timeout: 5_000 }
    );
  });

  authTest('failed invite (bad token) shows error message', async ({ authedPage: page }) => {
    // Override the accept-invite route to simulate a 400 error.
    await page.route(/\/api\/albums\/[^/]+\/accept-invite$/, async (route) => {
      await route.fulfill({
        status: 400,
        json: { error: { code: 'INVALID_TOKEN', message: 'Invite token is invalid or expired.', status: 400 } },
      });
    });

    await page.goto(VALID_INVITE_URL);

    await expect(page.getByText('Invite token is invalid or expired.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to albums' })).toBeVisible();
  });
});
