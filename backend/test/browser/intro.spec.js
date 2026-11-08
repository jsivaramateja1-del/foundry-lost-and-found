/**
 * The intro sequence, driven in a real browser.
 *
 * A storyboard built from SVG and CSS is only worth having if it actually
 * renders, can be skipped, and stays out of the way of someone who asked for
 * reduced motion. Those are the three things that cannot be checked by reading.
 */
const { test, expect } = require('@playwright/test');

test.describe('intro sequence', () => {
  test('plays on a first visit and can be skipped', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/index.html');

    const intro = page.locator('.intro');
    await expect(intro).toBeVisible({ timeout: 5000 });

    // The first scene and its caption are on screen.
    await expect(page.locator('.intro__scene--on')).toHaveCount(1);
    await expect(page.locator('.intro__caption')).toContainText(/campus/i, { timeout: 5000 });

    // Skipping removes it and leaves the board usable.
    await page.locator('.intro__skip').click();
    await expect(intro).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#search')).toBeVisible();
  });

  test('does not play a second time', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('foundry.intro.seen', '1'));
    await page.goto('/index.html');
    await expect(page.locator('.intro')).toHaveCount(0);
    await expect(page.locator('#search')).toBeVisible();
  });

  test('the escape key closes it', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/index.html');
    await expect(page.locator('.intro')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.intro')).toHaveCount(0, { timeout: 5000 });
  });

  test('advances through its scenes', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/index.html');
    await expect(page.locator('.intro')).toBeVisible({ timeout: 5000 });

    const first = await page.locator('.intro__caption').textContent();
    // The second scene arrives on its own timer.
    await expect(page.locator('.intro__caption')).not.toHaveText(first, { timeout: 12000 });
  });
});

test.describe('intro respects reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('never appears when the visitor asked for less motion', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/index.html');
    // The overlay is display:none under the media query, so it must not be
    // visible and must not block the board.
    await expect(page.locator('.intro')).toBeHidden();
    await expect(page.locator('#search')).toBeVisible();
  });
});
