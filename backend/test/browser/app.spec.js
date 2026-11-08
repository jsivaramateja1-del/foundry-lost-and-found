/**
 * End-to-end browser tests against the real PostgreSQL backend.
 *
 * These exist because every bug found in this migration was found by reading
 * code, never by running the app. A page that threw on `Object.entries(
 * data.stats)` passed every check the project had.
 */
const { test, expect } = require('@playwright/test');

const STUDENT = { email: 'browser@scds.saiuniversity.edu.in', password: 'BrowserTest123' };

test.describe('public board', () => {
  test('the homepage renders seeded listings', async ({ page }) => {
    await page.goto('/index.html');
    // If the API shape drifted, the board shows an error state instead.
    await expect(page.locator('body')).not.toContainText('Could not load');
    await expect(page.getByText('Black Wireless Earbuds').first()).toBeVisible();
    await expect(page.getByText('Student ID Card').first()).toBeVisible();
  });

  test('a listing card shows the reporter, not a placeholder', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByText('Black Wireless Earbuds').first().click();
    // reportedBy is a uuid with the name in reporterName; reading .name on the
    // uuid rendered 'A student' for every listing.
    await expect(page.getByText('Browser Student').first()).toBeVisible();
  });

  test('search narrows the board', async ({ page }) => {
    await page.goto('/index.html');
    const search = page.locator('#search, input[type="search"]').first();
    if (await search.count()) {
      await search.fill('earbuds');
      await page.waitForTimeout(600);
      await expect(page.getByText('Black Wireless Earbuds').first()).toBeVisible();
      await expect(page.getByText('Student ID Card').first()).toHaveCount(0);
    }
  });
});

test.describe('authentication', () => {
  test('the sign-in page loads and rejects a bad password', async ({ page }) => {
    await page.goto('/auth.html');
    await page.fill('#login-email', STUDENT.email);
    await page.fill('#login-password', 'wrong-password');
    await page.locator('#form-login button[type="submit"]').click();
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 10000 });
  });

  test('a verified student can sign in and the dashboard renders', async ({ page }) => {
    await page.goto('/auth.html');
    await page.fill('#login-email', STUDENT.email);
    await page.fill('#login-password', STUDENT.password);
    await page.locator('#form-login button[type="submit"]').click();

    await page.waitForURL(/dashboard\.html/, { timeout: 15000 });

    // The dashboard reads data.stats; when that key was missing the whole page
    // threw and every tile stayed '—'.
    await expect(page.locator('[data-metric]').first()).not.toHaveText('—', { timeout: 15000 });
    await expect(page.locator('#listings-body tr').first()).toBeVisible();
  });

  test('the leaderboard renders a rank for the seeded student', async ({ page }) => {
    await page.goto('/auth.html');
    await page.fill('#login-email', STUDENT.email);
    await page.fill('#login-password', STUDENT.password);
    await page.locator('#form-login button[type="submit"]').click();
    await page.waitForURL(/dashboard\.html/, { timeout: 15000 });

    // The endpoint returned entries/position while the page read
    // leaderboard/rank, so this panel always said 'Could not load'.
    await expect(page.locator('body')).not.toContainText('Could not load the leaderboard');
    await expect(page.getByText('Browser Student').first()).toBeVisible();
  });

  test('the dashboard shows the notification the seed created', async ({ page }) => {
    await page.goto('/auth.html');
    await page.fill('#login-email', STUDENT.email);
    await page.fill('#login-password', STUDENT.password);
    await page.locator('#form-login button[type="submit"]').click();
    await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
    await page.waitForTimeout(1000);
    // Notification rows came back snake_case, so every date rendered '—'.
    await expect(page.locator('body')).toContainText(/Welcome to the browser test seed/);
  });
});

test.describe('registration validation', () => {
  test('a non-university address is refused in the browser', async ({ page }) => {
    await page.goto('/auth.html');
    await page.getByRole('tab', { name: /create account/i }).click().catch(() => {});
    await page.fill('#register-email', 'someone@gmail.com');
    await page.fill('#register-name', 'Outsider');
    await page.fill('#register-password', 'Password123');
    await page.locator('#form-register button[type="submit"]').click();
    await expect(page.locator('#register-error')).toBeVisible({ timeout: 10000 });
  });

  test('a school subdomain is accepted by client validation', async ({ page }) => {
    await page.goto('/auth.html');
    await page.getByRole('tab', { name: /create account/i }).click().catch(() => {});
    await page.fill('#register-email', 'new.student@scds.saiuniversity.edu.in');
    await page.fill('#register-name', 'New Student');
    await page.fill('#register-password', 'Password123');
    // The client used an exact-match domain list, which rejected every school
    // subdomain the server accepts.
    await expect(page.locator('#register-email')).toHaveJSProperty('validity.valid', true);
  });
});
