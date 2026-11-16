import { defineConfig, devices } from '@playwright/test'
const previewUrl = process.env.HERFIT_TEST_BASE_URL
const cloudTest = process.env.HERFIT_TEST_CLOUD === '1'
export default defineConfig({
  testDir: './tests',
  testMatch: cloudTest ? '**/cloud.spec.ts' : '**/app.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  outputDir:
    process.env.HERFIT_TEST_OUTPUT ?? (cloudTest ? '.cache/test-cloud' : '.cache/test-demo'),
  use: { baseURL: previewUrl ?? 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
})
