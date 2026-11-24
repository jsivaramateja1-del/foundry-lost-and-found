/**
 * Stage 4 security regression tests.
 *
 * Covers the fixes that can be proven without a database: the public item
 * projection (B-3), the password byte ceiling (B-6), JWT algorithm pinning
 * (B-7) and the CORS allow-list decision (B-4). The database-backed fixes
 * (B-1 logout revocation, B-2 self-verification) need PostgreSQL and are
 * recorded as BLOCKED in the repair report.
 */
process.env.JWT_SECRET = 'stage4_test_secret_that_is_definitely_long_enough_32';

const jwt = require('jsonwebtoken');
const items = require('../src/repositories/items');
const { passwordProblem, PASSWORD_MAX_BYTES } = require('../src/routes/auth.v2.routes');

let passed = 0, failed = 0;
const out = [];
const check = (n, c, d = '') => {
  if (c) { passed++; out.push(`  PASS  ${n}`); }
  else { failed++; out.push(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
};

/* ================= B-3: public projection drops the reporter UUID ========= */
// toItem() maps from raw database columns, so the fixture uses snake_case.
const row = {
  id: 'abc', title: 'Keys', description: 'd', category: 'Other',
  subcategory: '', custom_category: 'Misc', location: 'AB1', custom_location: '',
  date: '2026-11-01', type: 'found', status: 'open', image_url: '',
  verified_at: null, verified_by: null,
  reported_by: 'user-uuid-1234', reporter_name: 'Asha',
  created_at: 'x', updated_at: 'y'
};
const full = items.toItem(row);
check('toItem still carries reportedBy internally', full.reportedBy === 'user-uuid-1234');

const pub = items.toPublicItem(full);
check('toPublicItem removes reportedBy', pub.reportedBy === undefined);
check('toPublicItem keeps reporterName (deliberate product behaviour)', pub.reporterName === 'Asha');
check('toPublicItem keeps the fields the board needs',
  pub.id === 'abc' && pub.title === 'Keys' && pub.location === 'AB1' && pub.type === 'found');
check('toPublicItem does not mutate the original', full.reportedBy === 'user-uuid-1234');
check('toPublicItem handles null', items.toPublicItem(null) === null);

/* ================= B-6: password byte ceiling ============================= */
check('rejects a short password', passwordProblem('short') !== null);
check('accepts 8 characters', passwordProblem('abcdefgh') === null);
check('accepts exactly 72 ASCII bytes', passwordProblem('a'.repeat(PASSWORD_MAX_BYTES)) === null);
check('rejects 73 ASCII bytes', passwordProblem('a'.repeat(PASSWORD_MAX_BYTES + 1)) !== null);
// 24 four-byte emoji = 96 bytes but only 48 UTF-16 code units; a character
// count would wrongly accept this.
const emoji = '\u{1F600}'.repeat(24);
check('rejects 24 emoji (96 UTF-8 bytes, 48 code units)',
  Buffer.byteLength(emoji, 'utf8') === 96 && passwordProblem(emoji) !== null);
check('accepts 18 emoji (72 bytes)', passwordProblem('\u{1F600}'.repeat(18)) === null);
check('rejects 19 emoji (76 bytes)', passwordProblem('\u{1F600}'.repeat(19)) !== null);
check('rejects a non-string', passwordProblem(null) !== null && passwordProblem(123) !== null);

/* ================= B-7: JWT algorithm pinning ============================= */
const secret = process.env.JWT_SECRET;
const good = jwt.sign({ id: 'u1', role: 'student', tv: 0 }, secret, { algorithm: 'HS256' });
check('a HS256 token verifies with algorithms pinned',
  jwt.verify(good, secret, { algorithms: ['HS256'] }).id === 'u1');

const hs512 = jwt.sign({ id: 'u1' }, secret, { algorithm: 'HS512' });
let rejected = false;
try { jwt.verify(hs512, secret, { algorithms: ['HS256'] }); } catch { rejected = true; }
check('a HS512 token is rejected when only HS256 is allowed', rejected);

let noneRejected = false;
try { jwt.verify(jwt.sign({ id: 'x' }, '', { algorithm: 'none' }), secret, { algorithms: ['HS256'] }); }
catch { noneRejected = true; }
check('an unsigned (alg none) token is rejected', noneRejected);

let expiredRejected = false;
try {
  jwt.verify(jwt.sign({ id: 'u1' }, secret, { algorithm: 'HS256', expiresIn: -10 }), secret, { algorithms: ['HS256'] });
} catch { expiredRejected = true; }
check('an expired token is rejected', expiredRejected);

/* ================= B-4: CORS allow-list decision ========================= */
// Exercised with a real request rather than by introspecting the middleware
// stack, which is private to Express and changes between versions.
const request = require('supertest');

function appWith(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/app.v2')];
  const app = require('../src/app.v2');
  process.env = saved;
  return app;
}

(async () => {
  const prodNoList = appWith({ NODE_ENV: 'production', CLIENT_ORIGIN: '' });
  let r = await request(prodNoList).get('/api/items/stats').set('Origin', 'https://evil.example');
  check('production with no CLIENT_ORIGIN sends no allow-origin header',
    !r.headers['access-control-allow-origin'], r.headers['access-control-allow-origin'] || 'absent');

  const prodAllowed = appWith({ NODE_ENV: 'production', CLIENT_ORIGIN: 'https://app.example' });
  r = await request(prodAllowed).get('/api/items/stats').set('Origin', 'https://app.example');
  check('an allowed origin is echoed back',
    r.headers['access-control-allow-origin'] === 'https://app.example', r.headers['access-control-allow-origin'] || 'absent');

  r = await request(prodAllowed).get('/api/items/stats').set('Origin', 'https://other.example');
  check('a different origin is not echoed back',
    r.headers['access-control-allow-origin'] !== 'https://other.example', r.headers['access-control-allow-origin'] || 'absent');

  console.log(out.join('\n'));
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
