/**
 * Proves the IP layer of the rate limiter works without authentication.
 *
 * Its own process, with low limits set before the app is required, so it
 * cannot interfere with the other suites.
 *
 * The account layer cannot be exercised here: it needs a signed-in user, and
 * therefore a database. test/api.test.js covers it.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';
process.env.RATE_LIMIT_ITEMS_IP_MAX = '3';
process.env.RATE_LIMIT_CLAIMS_IP_MAX = '50';

const request = require('supertest');
const app = require('../src/app');

let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed++; results.push(`  PASS  ${name}`); }
  else { failed++; results.push(`  FAIL  ${name} ${detail}`); }
};

(async () => {
  // Three unauthenticated attempts are rejected for being unauthenticated
  const attempts = [];
  for (let i = 0; i < 3; i += 1) {
    attempts.push(await request(app).post('/api/items').send({ title: 'x' }));
  }
  check('the first requests are refused for lacking a token, not for rate limiting',
    attempts.every((r) => r.status === 401), attempts.map((r) => r.status).join(','));

  // The fourth exceeds the IP budget set above
  const fourth = await request(app).post('/api/items').send({ title: 'x' });
  check('the IP limit then returns 429', fourth.status === 429, `got ${fourth.status}`);
  check('the 429 body is JSON with a message',
    fourth.headers['content-type'].includes('application/json') &&
    /too many requests from this network/i.test(fourth.body.message || ''),
    JSON.stringify(fourth.body));

  // A different route has its own bucket, so it is unaffected
  const other = await request(app).post('/api/claims').send({ itemId: 'x', message: 'y' });
  check('each route has its own counter', other.status === 401, `got ${other.status}`);

  // The report route has its own limiter too
  const report = await request(app).post('/api/items/64d2f1f1f1f1f1f1f1f1f1f1/report').send({ reason: 'spam' });
  check('the report route is not affected by the item route budget', report.status === 401, `got ${report.status}`);

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Rate-limit suite crashed:', err.message);
  console.log(results.join('\n'));
  process.exit(1);
});
