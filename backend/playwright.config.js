// Browser tests drive the real UI against the real Postgres backend.
// The old suite booted mongodb-memory-server, so it exercised none of the code
// that is actually deployed.
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.BROWSER_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: BASE, trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node server.v2.js',
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: process.env.TEST_DATABASE_URL || '',
      PG_NO_SSL: 'true',
      JWT_SECRET: process.env.JWT_SECRET || 'browser_test_secret_only',
      NODE_ENV: 'test',
      APP_URL: BASE,
      CLIENT_ORIGIN: BASE
    }
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } }
  ]
});
