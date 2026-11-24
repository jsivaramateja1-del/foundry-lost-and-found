/**
 * B-10 — authentication rate limiting, exercised through the real middleware.
 *
 * Three buckets must all hold:
 *   1. ip:account   20 / 15 min  (the original)
 *   2. account only 20 / 15 min  (closes the proxy-pool hole)
 *   3. ip only     120 / 15 min  (closes the spray hole, generous for campus NAT)
 *
 * Limits are lowered via env for the test so it does not need 120 requests.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration_secret_only_for_tests';
const request = require('supertest');

const URL = process.env.TEST_DATABASE_URL;
let pass = 0, fail = 0;
const results = [];
const ck = (n, c, d = '') => {
  if (c) { pass++; results.push(`  PASS  ${n}`); }
  else { fail++; results.push(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
};
if (!URL) {
  console.log('\n  SKIPPED — TEST_DATABASE_URL is not set.\n0 passed, 0 failed, SUITE SKIPPED\n');
  process.exit(0);
}

// Small windows so the test is fast and deterministic.
process.env.RATE_LIMIT_AUTH_MAX = '3';          // ip:account
process.env.RATE_LIMIT_AUTH_ACCOUNT_MAX = '5';  // account only
process.env.RATE_LIMIT_AUTH_IP_MAX = '10';      // ip only

process.env.DATABASE_URL = URL;
process.env.PG_NO_SSL = 'true';
const { connectDB, many } = require('../src/config/pg');

(async () => {
  await connectDB();
  await many('truncate users, items, claims, notifications, point_events, reports restart identity cascade');
  const app = require('../src/app.v2');

  const tryLogin = (email, ip) =>
    request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'wrongpassword' });

  /* 1. Same account, same IP — the original ip:account bucket (limit 3). */
  let blocked = false;
  for (let i = 0; i < 6; i++) {
    const r = await tryLogin('victim@scds.saiuniversity.edu.in', '10.0.0.1');
    if (r.status === 429) { blocked = true; break; }
  }
  ck('B-10 repeated attempts on one account from one IP are limited (429)', blocked);

  /* 2. Same account, ROTATING IPs — only the account-only bucket can catch this. */
  blocked = false;
  for (let i = 0; i < 10; i++) {
    const r = await tryLogin('victim@scds.saiuniversity.edu.in', `10.0.1.${i}`);
    if (r.status === 429) { blocked = true; break; }
  }
  ck('B-10 the same account is still limited when the IP keeps changing (account ceiling)', blocked);

  /* 3. Many accounts, one IP — only the IP bucket can catch this. */
  blocked = false;
  for (let i = 0; i < 16; i++) {
    const r = await tryLogin(`spray${i}@scds.saiuniversity.edu.in`, '10.0.2.9');
    if (r.status === 429) { blocked = true; break; }
  }
  ck('B-10 one IP spraying many accounts is limited (IP ceiling)', blocked);

  /* 4. A different IP is unaffected by another IP's spending. */
  const fresh = await tryLogin('someone@scds.saiuniversity.edu.in', '10.0.3.77');
  ck('B-10 a different IP still gets a normal response', fresh.status !== 429, `got ${fresh.status}`);

  /* 5. Rate limiting did not break a legitimate sign-in. */
  const ok = await request(app).post('/api/auth/login').set('X-Forwarded-For', '10.0.9.9')
    .send({ email: 'integration@scds.saiuniversity.edu.in', password: 'secret123' });
  ck('B-10 a legitimate sign-in is not blocked', ok.status !== 429, `got ${ok.status}`);

  console.log(results.join('\n'));
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.message); process.exit(1); });
