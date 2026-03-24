import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Use the same node binary that is running Playwright (respects nvm).
    command: `${process.execPath} node_modules/.bin/ng serve --configuration=e2e --port=4200`,
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
