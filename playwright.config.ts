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
  projects: [
    // 桌面输入用例只在 desktop-chromium 跑：isMobile 仿真会把 wheel 合成为触摸手势
    {
      name: 'mobile-chromium',
      testIgnore: /desktop-input.*\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chromium',
      testMatch: /desktop-input.*\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
})
