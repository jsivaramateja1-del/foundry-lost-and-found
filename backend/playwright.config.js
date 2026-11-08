const { defineConfig, devices } = require('@playwright/test');

/**
 * Browser tests run against the real Express application, started by the spec's
 * own setup against an in-memory MongoDB. Nothing is mocked: the pages, the API
 * and the database are the same code that ships.
 */
module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5178',
    trace: 'off',
    screenshot: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } }
  ]
});
