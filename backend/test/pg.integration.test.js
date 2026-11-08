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
  if (process.env.CI === 'true') {
    // In CI a skip is a lie: the workflow is supposed to provide a database,
    // so a missing URL means the job is misconfigured, not that there is
    // nothing to test.
    console.error('\n  FAILED — TEST_DATABASE_URL is required in CI.\n');
    process.exit(1);
  }
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

    // ---------- resend verification ----------
    const unknownResend = await request(app).post('/api/auth/resend-verification')
      .send({ email: 'nobody@scds.saiuniversity.edu.in' });
    check('resend answers 200 for an unknown address', unknownResend.status === 200,
      `got ${unknownResend.status}`);

    const unverified = await users.create({
      name: 'Resend Test', email: 'resend@scds.saiuniversity.edu.in',
      password: await bcrypt.hash('secret123', 4)
    });
    const knownResend = await request(app).post('/api/auth/resend-verification')
      .send({ email: 'resend@scds.saiuniversity.edu.in' });
    check('resend answers 200 for a real address', knownResend.status === 200);
    check('resend gives the same answer either way (no enumeration)',
      unknownResend.body.message === knownResend.body.message,
      `${unknownResend.body.message} vs ${knownResend.body.message}`);

    const withToken = await users.findById(unverified.id);
    check('resend stores a fresh verification token',
      Boolean(withToken.verificationTokenHash) && Boolean(withToken.verificationTokenExpires));

    // A verified account must not be re-tokened.
    await users.markVerified(unverified.id);
    await request(app).post('/api/auth/resend-verification')
      .send({ email: 'resend@scds.saiuniversity.edu.in' });
    const afterVerify = await users.findById(unverified.id);
    check('resend does nothing for an already-verified account',
      afterVerify.verificationTokenHash === null);

    // ---------- faculty applications ----------
    const facultyReg = await request(app).post('/api/auth/register')
      .send({ name: 'Prof Applicant', email: 'prof@saiuniversity.edu.in', password: 'secret123' });
    check('a faculty address registers (201)', facultyReg.status === 201, `got ${facultyReg.status}`);
    check('a faculty address is flagged as a pending application',
      facultyReg.body.pendingApproval === true, JSON.stringify(facultyReg.body));
    check('a faculty address gets the faculty role', facultyReg.body.role === 'faculty');

    const studentReg = await request(app).post('/api/auth/register')
      .send({ name: 'Student Applicant', email: 'kid@scds.saiuniversity.edu.in', password: 'secret123' });
    check('a school subdomain is NOT a pending application',
      studentReg.body.pendingApproval === false, JSON.stringify(studentReg.body));
    check('a school subdomain gets the student role', studentReg.body.role === 'student');

    const profRow = await users.findByEmail('prof@saiuniversity.edu.in');
    check('the faculty application is stored as pending', profRow.pendingApproval === true);
    check('the faculty application is stored with the faculty role', profRow.role === 'faculty');

    // Verify the address, then confirm approval is still required.
    const profToken = crypto.randomBytes(32).toString('hex');
    await users.setVerificationToken(profRow.id,
      crypto.createHash('sha256').update(profToken).digest('hex'),
      new Date(Date.now() + 60000));
    await request(app).get(`/api/auth/verify?token=${profToken}`);

    const pendingLogin = await request(app).post('/api/auth/login')
      .send({ email: 'prof@saiuniversity.edu.in', password: 'secret123' });
    check('a verified but unapproved faculty account still cannot sign in (403)',
      pendingLogin.status === 403, `got ${pendingLogin.status}`);

    // Approving must also verify the address: an applicant whose verification
    // email never arrived would otherwise be approved and still unable to sign in.
    await users.approve(profRow.id);
    const afterApproval = await users.findById(profRow.id);
    check('approving an account also marks its address verified',
      afterApproval.emailVerified === true, `emailVerified=${afterApproval.emailVerified}`);

    const approvedLogin = await request(app).post('/api/auth/login')
      .send({ email: 'prof@saiuniversity.edu.in', password: 'secret123' });
    check('an approved faculty account can sign in (200)',
      approvedLogin.status === 200 && Boolean(approvedLogin.body.token),
      `got ${approvedLogin.status}`);

    // ---------- faculty journey, end to end over HTTP ----------
    // Everything above called the repository directly. This drives the real
    // routes in the order a person would: register, verify, be refused, be
    // approved by an administrator, then sign in.
    const applicant = await request(app).post('/api/auth/register')
      .send({ name: 'Journey Prof', email: 'journey@saiuniversity.edu.in', password: 'secret123' });
    check('journey: the application is accepted', applicant.status === 201, `got ${applicant.status}`);
    check('journey: the response says it is a pending application',
      applicant.body.pendingApproval === true);
    check('journey: the message mentions administrator approval',
      /administrat/i.test(applicant.body.message || ''), applicant.body.message);

    const journeyRow = await users.findByEmail('journey@saiuniversity.edu.in');
    const journeyToken = crypto.randomBytes(32).toString('hex');
    await users.setVerificationToken(journeyRow.id,
      crypto.createHash('sha256').update(journeyToken).digest('hex'),
      new Date(Date.now() + 60000));
    const journeyVerify = await request(app)
      .post('/api/auth/verify-email').send({ token: journeyToken });
    check('journey: the address verifies', journeyVerify.status === 200, `got ${journeyVerify.status}`);

    const journeyRefused = await request(app).post('/api/auth/login')
      .send({ email: 'journey@saiuniversity.edu.in', password: 'secret123' });
    check('journey: a verified but unapproved professor is refused', journeyRefused.status === 403,
      `got ${journeyRefused.status}`);

    // An administrator approves through the real route.
    const superadmin = await users.create({
      name: 'Journey Admin', email: 'journeyadmin@saiuniversity.edu.in',
      password: await bcrypt.hash('secret123', 4), role: 'superadmin'
    });
    await users.markVerified(superadmin.id);
    const adminLogin = await request(app).post('/api/auth/login')
      .send({ email: 'journeyadmin@saiuniversity.edu.in', password: 'secret123' });
    check('journey: the administrator signs in', adminLogin.status === 200);

    const approveRes = await request(app)
      .patch(`/api/admin/users/${journeyRow.id}/approve`)
      .set({ Authorization: `Bearer ${adminLogin.body.token}` })
      .send({ approved: true });
    check('journey: the administrator approves through the API', approveRes.status === 200,
      `got ${approveRes.status}`);

    const journeyLogin = await request(app).post('/api/auth/login')
      .send({ email: 'journey@saiuniversity.edu.in', password: 'secret123' });
    check('journey: the approved professor can sign in',
      journeyLogin.status === 200 && Boolean(journeyLogin.body.token), `got ${journeyLogin.status}`);

    const journeyNotes = await many(
      'select type from notifications where user_id = $1', [journeyRow.id]);
    check('journey: the applicant is told the outcome',
      journeyNotes.some((n) => n.type === 'account_approved'),
      JSON.stringify(journeyNotes.map((n) => n.type)));

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

    // ---------- badges ----------
    const badges = require('../src/repositories/badges');
    const u3 = await users.create({
      name: 'Badge Test', email: 'badge@scds.saiuniversity.edu.in',
      password: await bcrypt.hash('secret123', 4)
    });

    let fresh = await badges.forUser(u3.id);
    check('a new account has no badges', fresh.every((b) => b.earned === false));
    check('the catalogue lists all five badges', fresh.length === 5);

    // Posting a listing earns nothing: only a verified one counts.
    await many(
      `insert into items (title, description, category, location, date, type, reported_by, status)
       values ('Badge Item', 'x', 'Bags', 'Library', '2026-11-01', 'found', $1, 'open')`, [u3.id]);
    let earned = await badges.evaluate(null, u3.id);
    check('an unverified listing earns no badge', earned.length === 0);

    await many(
      `update items set verified_at = now() where reported_by = $1`, [u3.id]);
    earned = await badges.evaluate(null, u3.id);
    check('verifying the first found listing earns first_found', earned.includes('first_found'));
    check('one verified listing does not earn helpful_finder',
      !earned.includes('helpful_finder'));

    // Two more verified found listings reach the Helpful Finder threshold.
    await many(
      `insert into items (title, description, category, location, date, type, reported_by, status, verified_at)
       values ('Badge Item 2','x','Bags','Library','2026-11-01','found',$1,'open', now()),
              ('Badge Item 3','x','Bags','Library','2026-11-01','found',$1,'open', now())`, [u3.id]);
    const third = await badges.evaluate(null, u3.id);
    check('three verified found listings earns helpful_finder', third.includes('helpful_finder'));

    const again = await badges.evaluate(null, u3.id);
    check('evaluating twice awards nothing new', again.length === 0);

    await many('update users set returns = 10 where id = $1', [u3.id]);
    const all = await badges.evaluate(null, u3.id);
    check('ten returns earns every return badge',
      ['first_return', 'community_helper', 'trusted_member'].every((b) => all.includes(b)));

    fresh = await badges.forUser(u3.id);
    check('forUser reports all five as earned', fresh.every((b) => b.earned === true));

    await many('truncate users, items, claims, notifications, point_events, reports, campus_locations, user_badges restart identity cascade');
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
