/**
 * PostgreSQL integration tests.
 *
 * These exercise the real database — real constraints, real transactions. They
 * run only when TEST_DATABASE_URL points at a database you are willing to
 * destroy, because every run truncates the tables.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:pg
 *
 * Without that variable the suite prints SKIPPED and exits 0. It does not
 * pretend to have passed: the summary line says so explicitly.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration_secret_only_for_tests';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const URL = process.env.TEST_DATABASE_URL;
let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

if (!URL) {
  console.log('\n  SKIPPED — TEST_DATABASE_URL is not set.');
  console.log('  These tests need a real Postgres database and will not run without one.');
  console.log('\n0 passed, 0 failed, SUITE SKIPPED\n');
  process.exit(0);
}

process.env.DATABASE_URL = URL;
process.env.PG_NO_SSL = 'true';

const { connectDB, closeDB, many, one, transaction } = require('../src/config/pg');

(async () => {
  try {
    await connectDB();
    // Clean slate. Safe because TEST_DATABASE_URL is by definition disposable.
    await many('truncate users, items, claims, notifications, point_events, reports, campus_locations restart identity cascade');

    const app = require('../src/app.v2');
    const users = require('../src/repositories/users');
    const points = require('../src/repositories/points');

    // ---------- auth ----------
    const reg = await request(app).post('/api/auth/register')
      .send({ name: 'Integration Student', email: 'integration@scds.saiuniversity.edu.in', password: 'secret123' });
    check('register accepts a university address (201)', reg.status === 201, `got ${reg.status}`);
    check('register issues no token', !reg.body.token);
    check('register reports pending verification', reg.body.pendingVerification === true);

    const dup = await request(app).post('/api/auth/register')
      .send({ name: 'Integration Student', email: 'integration@scds.saiuniversity.edu.in', password: 'secret123' });
    check('a duplicate email is refused (409)', dup.status === 409, `got ${dup.status}`);

    const badDomain = await request(app).post('/api/auth/register')
      .send({ name: 'Outsider', email: 'someone@gmail.com', password: 'secret123' });
    check('an external domain is refused (400)', badDomain.status === 400, `got ${badDomain.status}`);

    const beforeVerify = await request(app).post('/api/auth/login')
      .send({ email: 'integration@scds.saiuniversity.edu.in', password: 'secret123' });
    check('an unverified account cannot sign in (403)', beforeVerify.status === 403, `got ${beforeVerify.status}`);

    // Verify by writing a known token straight into the row.
    const userRow = await users.findByEmail('integration@scds.saiuniversity.edu.in');
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await users.setVerificationToken(userRow.id, hash, new Date(Date.now() + 60000));

    const verify = await request(app).get(`/api/auth/verify?token=${token}`);
    check('verification succeeds with the emailed token (200)', verify.status === 200, `got ${verify.status}`);

    const reuse = await request(app).get(`/api/auth/verify?token=${token}`);
    check('a verification token cannot be reused (400)', reuse.status === 400, `got ${reuse.status}`);

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'integration@scds.saiuniversity.edu.in', password: 'secret123' });
    check('a verified account signs in (200)', login.status === 200 && Boolean(login.body.token));

    const me = await request(app).get('/api/auth/me')
      .set({ Authorization: `Bearer ${login.body.token}` });
    check('the token reaches a protected route (200)', me.status === 200, `got ${me.status}`);

    const wrongPw = await request(app).post('/api/auth/login')
      .send({ email: 'integration@scds.saiuniversity.edu.in', password: 'wrong' });
    check('a wrong password is refused (401)', wrongPw.status === 401, `got ${wrongPw.status}`);

    // ---------- items ----------
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const created = await request(app).post('/api/items').set(auth).send({
      title: 'Integration Wallet', description: 'brown leather', category: 'Bags',
      location: 'Library', date: '2026-11-01', type: 'found'
    });
    check('a found listing is created (201)', created.status === 201, `got ${created.status}`);

    const listed = await request(app).get('/api/items');
    check('the new listing appears on the board', listed.body.total === 1, `total ${listed.body.total}`);

    const searched = await request(app).get('/api/items?q=wallet');
    check('full-text search finds it', searched.body.total === 1, `total ${searched.body.total}`);

    const injected = await request(app).get('/api/items?category[$ne]=x');
    check('an object-valued filter is refused (400)', injected.status === 400, `got ${injected.status}`);

    // ---------- ledger idempotency ----------
    const u2 = await users.create({
      name: 'Ledger Test', email: 'ledger@scds.saiuniversity.edu.in',
      password: await bcrypt.hash('secret123', 4)
    });
    const first = await points.awardOnce({ userId: u2.id, type: 'return', eventKey: 'return:test:1' });
    const second = await points.awardOnce({ userId: u2.id, type: 'return', eventKey: 'return:test:1' });
    check('the first award credits', first.credited === true);
    check('the second award with the same key credits nothing', second.credited === false);

    const after = await users.findById(u2.id);
    check('points were credited exactly once', after.points === 10, `points ${after.points}`);

    const audit = await points.auditUser(u2.id);
    check('the ledger audit reports the account in sync', audit.inSync === true, JSON.stringify(audit));

    // ---------- transactions ----------
    try {
      await transaction(async (client) => {
        await client.query("insert into users (name,email,password) values ('Rollback','rollback@scds.saiuniversity.edu.in','x')");
        throw new Error('deliberate');
      });
    } catch { /* expected */ }
    const rolled = await users.findByEmail('rollback@scds.saiuniversity.edu.in');
    check('a failed transaction leaves no row behind', rolled === null);

    await many('truncate users, items, claims, notifications, point_events, reports, campus_locations restart identity cascade');
  } catch (err) {
    check('the integration suite ran', false, err.message);
    console.error(err);
  } finally {
    await closeDB().catch(() => {});
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
