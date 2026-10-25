import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    hasTouch: true,
    viewport: { width: 412, height: 915 },
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'npm run build:harness && npm run preview:harness -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
})
