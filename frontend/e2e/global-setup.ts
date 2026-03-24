/**
 * Global setup: seed the Firebase Auth Emulator with a test user before any
 * tests run.  The emulator must be running on http://127.0.0.1:9099.
 *
 * Start with:
 *   firebase emulators:start --only auth --project demo-project
 */

const EMULATOR_HOST = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-project';

export default async function globalSetup() {
  // Clear all existing emulator users to start from a known state.
  await fetch(
    `${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' }
  ).catch(() => {
    // If the emulator isn't running, tests that need auth will fail with a
    // clear "window.__e2eAuth.signIn is not a function" error instead of a
    // confusing network error here.
    console.warn(
      '[e2e] Firebase Auth Emulator not reachable at',
      EMULATOR_HOST,
      '— auth-dependent tests will fail.'
    );
  });

  // Create the primary test user via the emulator admin endpoint.
  // Using `Authorization: Bearer owner` grants admin access in the emulator,
  // which allows specifying a fixed localId so that mock data UIDs stay stable.
  const createRes = await fetch(
    `${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer owner',
      },
      body: JSON.stringify({
        localId: 'test-user-001',
        email: 'e2e@test.example',
        password: 'TestPass1234!',
        displayName: 'E2E Tester',
      }),
    }
  ).catch(() => null);

  if (!createRes?.ok) {
    console.warn(
      '[e2e] Failed to create test user in emulator — status:',
      createRes?.status,
      await createRes?.text().catch(() => '')
    );
  }
}
