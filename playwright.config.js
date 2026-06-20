import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:8000', headless: true, hasTouch: true },
  webServer: {
    command: 'python3 -m http.server 8000',
    url: 'http://localhost:8000',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
