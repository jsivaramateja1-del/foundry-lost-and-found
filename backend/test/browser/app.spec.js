/**
 * Browser tests.
 *
 * A real Chromium loads the real pages from the real server. The database is an
 * in-memory MongoDB that is thrown away afterwards, so nothing here can touch
 * production data.
 */
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const PORT = 5178;
const BASE = `http://127.0.0.1:${PORT}`;
let mongod;
let server;
let mongoose;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

test.beforeAll(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('foundry-browser-test');

  // Seed one verified campus location so the Explorer has real content and the
  // "Verified" badge can be asserted rather than assumed.
  mongoose = require('mongoose');
  await mongoose.connect(uri);
  const CampusLocation = require('../../src/models/CampusLocation');
  await CampusLocation.create({
    name: 'Sai University Main Campus',
    kind: 'landmark',
    description: 'One Hub Road, OMR, Paiyanur',
    lat: 12.65416,
    lng: 80.15771,
    source: 'University contact page and Wikipedia',
    sourceUrl: 'https://en.wikipedia.org/wiki/Sai_University'
  });
  await mongoose.disconnect();

  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGO_URI: uri,
      JWT_SECRET: 'browser_test_secret_used_only_here',
      PORT: String(PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 15000))]);
    clearTimeout(timer);
  }
  if (mongod) await mongod.stop().catch(() => {});
});

test('the homepage is served by the application', async ({ page }) => {
  const res = await page.goto('/');
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle(/Foundry/i);
  await expect(page.locator('a[href="explorer.html"]').first()).toBeVisible();
});

test('the public board renders listings or an explicit empty state', async ({ page }) => {
  await page.goto('/');
  const empty = page.locator('#empty-state');
  const items = page.locator('#items-list, .item-card');
  await expect(empty.or(items.first())).toBeVisible({ timeout: 20000 });
});

test('Campus Explorer loads Leaflet and draws the map', async ({ page }) => {
  await page.goto('/explorer.html');
  await page.waitForFunction(() => typeof window.L !== 'undefined', null, { timeout: 20000 });
  await expect(page.locator('#map')).toBeVisible();
  // Assert what our code is responsible for: Leaflet initialised the container
  // and our marker code ran. Whether OpenStreetMap's tile servers paint pixels
  // is their network, not this application, and asserting on it makes the suite
  // fail for reasons we cannot fix.
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/, { timeout: 20000 });
  await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible({ timeout: 20000 });
});

test('Campus Explorer lists the seeded location as verified', async ({ page }) => {
  await page.goto('/explorer.html');
  const card = page.locator('.loc-card', { hasText: 'Sai University Main Campus' });
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText(/Verified/i);
  await expect(card.locator('a', { hasText: /view source/i })).toHaveAttribute('href', /^https?:\/\//);
});

test('searching the Explorer filters the location list', async ({ page }) => {
  await page.goto('/explorer.html');
  await expect(page.locator('.loc-card').first()).toBeVisible({ timeout: 20000 });
  await page.fill('#loc-search', 'zzzz-no-such-place');
  await expect(page.locator('#loc-list')).toContainText(/No location matches/i);
});

test('selecting a location offers walking directions', async ({ page }) => {
  await page.goto('/explorer.html');
  const card = page.locator('.loc-card').first();
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.click();
  await expect(page.locator('#loc-detail a', { hasText: /walking directions/i }))
    .toHaveAttribute('href', /openstreetmap\.org\/directions/);
});

test('the report form offers campus locations', async ({ page }) => {
  await page.goto('/');
  const option = page.locator('#rf-location option[value="Sai University Main Campus"]');
  await expect(option).toHaveCount(1, { timeout: 20000 });
});

test('the registration form rejects a non-university address', async ({ page }) => {
  await page.goto('/auth.html?mode=register');
  await page.fill('#register-name', 'Browser Test');
  await page.fill('#register-email', 'someone@gmail.com');
  await page.fill('#register-password', 'secret123');
  await page.fill('#register-confirm', 'secret123');
  await page.click('#register-submit');
  await expect(page.locator('#register-error')).toContainText(/university|domain|allowed/i, { timeout: 15000 });
});

test('the login form is reachable and rejects an unknown account', async ({ page }) => {
  await page.goto('/auth.html');
  await page.fill('#login-email', 'nobody@scds.saiuniversity.edu.in');
  await page.fill('#login-password', 'wrongpassword');
  await page.click('#login-submit');
  await expect(page.locator('#login-error')).toBeVisible({ timeout: 15000 });
});

test('no horizontal overflow at this viewport', async ({ page }) => {
  for (const url of ['/', '/explorer.html', '/auth.html']) {
    await page.goto(url);
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${url} overflows by ${overflow}px`).toBeLessThanOrEqual(2);
  }
});
