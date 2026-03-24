import { type Page } from '@playwright/test';
import { ALBUMS, MEDIA_ITEMS, MEMBERS, TEST_USER } from './test-data';

/**
 * Register Playwright route intercepts for all /api/* endpoints.
 * Individual tests can override specific routes after calling this.
 */
export async function setupApiMocks(page: Page): Promise<void> {
  // ── Albums list ────────────────────────────────────────────────────────────
  await page.route('/api/albums', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          mine: [ALBUMS.myPrivate, ALBUMS.myPublic],
          shared: [ALBUMS.shared],
          public: [],
        },
      });
    } else if (route.request().method() === 'POST') {
      // Create album — echo back with a new id.
      const body = JSON.parse(route.request().postData() ?? '{}');
      const now = new Date().toISOString();
      await route.fulfill({
        status: 201,
        json: {
          id: `album-new-${Date.now()}`,
          title: body.title ?? 'Untitled',
          visibility: body.visibility ?? 'private',
          myPermission: 'owner',
          mediaCount: 0,
          ownerId: TEST_USER.uid,
          coverMediaId: null,
          coverThumbnailUrl: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    } else {
      await route.continue();
    }
  });

  // ── Single album ───────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/([^/]+)$/, async (route) => {
    const url = route.request().url();
    const albumId = url.split('/api/albums/')[1];
    const album =
      Object.values(ALBUMS).find((a) => a.id === albumId) ?? ALBUMS.myPrivate;

    if (route.request().method() === 'GET') {
      await route.fulfill({ json: album });
    } else if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ json: { ...album, ...body, updatedAt: new Date().toISOString() } });
    } else if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.continue();
    }
  });

  // ── Media list ─────────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/media(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: MEDIA_ITEMS, nextCursor: null } });
    } else {
      await route.continue();
    }
  });

  // ── Upload URL ─────────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/media\/upload-url$/, async (route) => {
    if (route.request().method() === 'POST') {
      const items = JSON.parse(route.request().postData() ?? '[]') as Array<{ sha256: string }>;
      const result: Record<string, { url: string; multipart: boolean }> = {};
      for (const item of items) {
        // Use same-origin URL to avoid CORS preflight in tests.
        result[item.sha256] = { url: 'http://localhost:4200/e2e-mock-gcs', multipart: false };
      }
      await route.fulfill({ json: result });
    } else {
      await route.continue();
    }
  });

  // ── Mock GCS upload target (same-origin to avoid CORS preflight) ──────────
  await page.route('http://localhost:4200/e2e-mock-gcs', async (route) => {
    await route.fulfill({ status: 200, body: '' });
  });

  // ── Single media ───────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/media\/(?!upload-url$)([^/]+)$/, async (route) => {
    const url = route.request().url();
    const mediaId = url.split('/media/')[1];
    const media = MEDIA_ITEMS.find((m) => m.id === mediaId) ?? MEDIA_ITEMS[0];

    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ json: { ...media, ...body, updatedAt: new Date().toISOString() } });
    } else if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.continue();
    }
  });

  // ── Original URL ───────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/media\/[^/]+\/original-url$/, async (route) => {
    await route.fulfill({ json: { url: 'https://storage.mock/original.jpg' } });
  });

  // ── Members ────────────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/members$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MEMBERS });
    } else if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 201,
        json: {
          email: body.email,
          userId: null,
          displayName: null,
          photoURL: null,
          permission: body.permission ?? 'read',
          inviteToken: 'new-invite-token',
          addedAt: new Date().toISOString(),
        },
      });
    } else {
      await route.continue();
    }
  });

  // ── Member permission / remove ─────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/members\/.+/, async (route) => {
    const url = route.request().url();
    const email = decodeURIComponent(url.split('/members/')[1]);
    const member = MEMBERS.find((m) => m.email === email) ?? MEMBERS[0];

    if (route.request().method() === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ json: { ...member, ...body } });
    } else if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.continue();
    }
  });

  // ── Accept invite ──────────────────────────────────────────────────────────
  await page.route(/\/api\/albums\/[^/]+\/accept-invite$/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: ALBUMS.shared });
    } else {
      await route.continue();
    }
  });
}
