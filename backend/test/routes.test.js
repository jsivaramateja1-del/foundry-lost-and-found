/**
 * Route-level tests that need NO database.
 *
 * Every case below is decided before the first Mongoose query runs: input
 * validation, the university email rule, and the authentication gate. That
 * makes them runnable anywhere, including CI without MongoDB.
 *
 * Run with:  npm run test:routes
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');

let passed = 0;
let failed = 0;
const results = [];

const check = (name, cond, detail = '') => {
  if (cond) {
    passed++;
    results.push(`  PASS  ${name}`);
  } else {
    failed++;
    results.push(`  FAIL  ${name} ${detail}`);
  }
};

(async () => {
  const UNI = 'student@scds.saiuniversity.edu.in';

  // ---------- 1. Health and public config ----------
  const health = await request(app).get('/api/health');
  check('GET /api/health returns 200', health.status === 200, `got ${health.status}`);
  check('health is JSON with a status field', health.body.status === 'ok');

  check('liveness reports the database state without changing the status code',
    health.body.db && typeof health.body.db.ok === 'boolean' && health.body.status === 'ok',
    JSON.stringify(health.body.db));

  const ready = await request(app).get('/api/health/ready');
  check('readiness returns 503 when the database is not connected',
    ready.status === 503 && ready.body.status === 'not-ready', `got ${ready.status}`);
  check('readiness names the database state',
    ['disconnected', 'connecting', 'disconnecting', 'unknown'].includes(ready.body.db.state),
    JSON.stringify(ready.body.db));

  const config = await request(app).get('/api/auth/config');
  check('GET /api/auth/config returns 200', config.status === 200, `got ${config.status}`);
  check('config lists all four student domains',
    Array.isArray(config.body.allowedEmailDomains) && config.body.allowedEmailDomains.length === 4,
    JSON.stringify(config.body.allowedEmailDomains));
  check('config lists the scds domain',
    (config.body.allowedEmailDomains || []).includes('scds.saiuniversity.edu.in'));

  // ---------- 2. The university email rule, enforced by the route ----------
  const gmail = await request(app).post('/api/auth/register')
    .send({ name: 'Test', email: 'student@gmail.com', password: 'secret123' });
  check('registration with Gmail is refused (400)', gmail.status === 400, `got ${gmail.status}`);
  check('the refusal explains the domain rule',
    /Sai University addresses/.test(gmail.body.message || ''), gmail.body.message);

  // This is the exact address that broke the API suite: it is not a university domain
  const oldFixture = await request(app).post('/api/auth/register')
    .send({ name: 'Test', email: 'test@sai.edu', password: 'secret123' });
  check('registration with @sai.edu is refused (400) — regression', oldFixture.status === 400, `got ${oldFixture.status}`);

  const suffix = await request(app).post('/api/auth/register')
    .send({ name: 'Test', email: 'student@scds.saiuniversity.edu.in.evil.com', password: 'secret123' });
  check('a domain-suffix trick is refused (400)', suffix.status === 400, `got ${suffix.status}`);

  const subdomain = await request(app).post('/api/auth/register')
    .send({ name: 'Test', email: 'student@sub.scds.saiuniversity.edu.in', password: 'secret123' });
  check('a subdomain is refused (400)', subdomain.status === 400, `got ${subdomain.status}`);

  // ---------- 3. Input validation happens before any query ----------
  const missing = await request(app).post('/api/auth/register').send({ email: UNI });
  check('missing name and password returns 400', missing.status === 400, `got ${missing.status}`);

  const shortPassword = await request(app).post('/api/auth/register')
    .send({ name: 'Test', email: UNI, password: '12345' });
  check('a short password returns 400 before the duplicate check',
    shortPassword.status === 400 && /at least 6/.test(shortPassword.body.message || ''),
    `got ${shortPassword.status}: ${shortPassword.body.message}`);

  const noLoginBody = await request(app).post('/api/auth/login').send({});
  check('login with no credentials returns 400', noLoginBody.status === 400, `got ${noLoginBody.status}`);

  // ---------- 4. The authentication gate ----------
  const meNoToken = await request(app).get('/api/auth/me');
  check('GET /api/auth/me without a token returns 401', meNoToken.status === 401, `got ${meNoToken.status}`);
  check('the 401 is JSON with a message', /Not authorized/.test(meNoToken.body.message || ''), meNoToken.body.message);

  const createNoToken = await request(app).post('/api/items').send({ title: 'x' });
  check('POST /api/items without a token returns 401', createNoToken.status === 401, `got ${createNoToken.status}`);

  const junkToken = await request(app).get('/api/auth/me').set({ Authorization: 'Bearer not-a-real-token' });
  check('a junk token returns 401', junkToken.status === 401, `got ${junkToken.status}`);

  const wrongScheme = await request(app).get('/api/auth/me').set({ Authorization: 'Token abc' });
  check('a non-Bearer Authorization header returns 401', wrongScheme.status === 401, `got ${wrongScheme.status}`);

  const adminNoToken = await request(app).get('/api/admin/stats');
  check('GET /api/admin/stats without a token returns 401', adminNoToken.status === 401, `got ${adminNoToken.status}`);

  const reportsNoToken = await request(app).get('/api/admin/reports');
  check('GET /api/admin/reports without a token returns 401', reportsNoToken.status === 401, `got ${reportsNoToken.status}`);

  const reportNoToken = await request(app).post('/api/items/64d2f1f1f1f1f1f1f1f1f1f1/report').send({ reason: 'spam' });
  check('reporting a listing without a token returns 401', reportNoToken.status === 401, `got ${reportNoToken.status}`);

  const notifNoToken = await request(app).patch('/api/notifications/read-all');
  check('marking notifications read without a token returns 401', notifNoToken.status === 401, `got ${notifNoToken.status}`);

  // ---------- 5. Id and query validation ----------
  const badId = await request(app).get('/api/items/not-an-id');
  check('GET /api/items/not-an-id returns 400', badId.status === 400, `got ${badId.status}`);

  const badSimilar = await request(app).get('/api/items/not-an-id/similar');
  check('GET /api/items/:id/similar with a bad id returns 400', badSimilar.status === 400, `got ${badSimilar.status}`);

  const badDate = await request(app).get('/api/items?from=not-a-date');
  check('GET /api/items?from=not-a-date returns 400', badDate.status === 400, `got ${badDate.status}`);

  const badTo = await request(app).get('/api/items?to=also-not-a-date');
  check('GET /api/items?to=also-not-a-date returns 400', badTo.status === 400, `got ${badTo.status}`);

  // ---------- 6. Every error is JSON, including 404s ----------
  const unknown = await request(app).get('/api/nope');
  check('an unknown route returns 404', unknown.status === 404, `got ${unknown.status}`);
  check('the 404 body is JSON, not HTML',
    unknown.headers['content-type'] && unknown.headers['content-type'].includes('application/json'),
    unknown.headers['content-type']);
  check('the 404 names the route', /Route not found/.test(unknown.body.message || ''), unknown.body.message);

  const badJson = await request(app).post('/api/auth/login')
    .set('Content-Type', 'application/json').send('{"email": ');
  check('malformed JSON returns 400 as JSON', badJson.status === 400, `got ${badJson.status}`);

  // ---------- 7. Pages must not rely on inline scripts ----------
  // The app sends `script-src 'self'` (helmet's default), so an inline <script>
  // is silently blocked by the browser. That is exactly what stopped the
  // dashboard from ever running its own code.
  for (const page of ['index.html', 'auth.html', 'dashboard.html', 'admin.html', 'forgot-password.html', 'reset-password.html']) {
    const res = await request(app).get(`/${page}`);
    check(`GET /${page} returns 200`, res.status === 200, `got ${res.status}`);

    const csp = res.headers['content-security-policy'] || '';
    check(`/${page} is served with a Content-Security-Policy`, csp.includes("script-src 'self'"), csp || '(none)');

    const inline = (res.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []);
    check(`/${page} has no inline <script> that the CSP would block`,
      inline.length === 0, `found ${inline.length}`);
  }

  // ---------- 8. Account recovery: validation that runs before any query ----------
  // These paths answer without touching MongoDB, so they are verifiable here.
  const forgotNoEmail = await request(app).post('/api/auth/forgot-password').send({});
  check('forgot-password without an address returns 400',
    forgotNoEmail.status === 400, `got ${forgotNoEmail.status}`);
  check('forgot-password error is JSON with a message',
    Boolean(forgotNoEmail.body && forgotNoEmail.body.message));

  const resetNoToken = await request(app).post('/api/auth/reset-password').send({ password: 'abcdef' });
  check('reset-password without a token returns 400',
    resetNoToken.status === 400, `got ${resetNoToken.status}`);

  const resetNoPassword = await request(app).post('/api/auth/reset-password').send({ token: 'abc' });
  check('reset-password without a password returns 400',
    resetNoPassword.status === 400, `got ${resetNoPassword.status}`);

  const resetShort = await request(app).post('/api/auth/reset-password')
    .send({ token: 'abc', password: 'abc' });
  check('reset-password refuses a too-short password',
    resetShort.status === 400, `got ${resetShort.status}`);

  const resetMismatch = await request(app).post('/api/auth/reset-password')
    .send({ token: 'abc', password: 'abcdef', confirmPassword: 'different' });
  check('reset-password refuses a mismatched confirmation',
    resetMismatch.status === 400, `got ${resetMismatch.status}`);

  const badPeriod = await request(app).get('/api/leaderboard?period=fortnight');
  check('leaderboard rejects an unknown period (400)',
    badPeriod.status === 400, `got ${badPeriod.status}`);

  // ---------- 9. The recovery pages actually offer the flow ----------
  const forgotPage = await request(app).get('/forgot-password.html');
  check('forgot-password.html contains the email form',
    forgotPage.status === 200 && /id="forgot-form"/.test(forgotPage.text));
  check('forgot-password.html explains the no-mailbox route',
    /administrator or university IT/i.test(forgotPage.text));

  const resetPage = await request(app).get('/reset-password.html');
  check('reset-password.html contains the new-password form',
    resetPage.status === 200 && /id="reset-form"/.test(resetPage.text));

  const authPage = await request(app).get('/auth.html');
  check('auth.html links to the recovery page',
    /forgot-password\.html/.test(authPage.text));

  // ---- Faculty domain regression (no database needed: the domain rule runs
  // before the first query) ----
  const reg = (email) => request(app).post('/api/auth/register')
    .send({ name: 'Domain Test', email, password: 'secret123' });

  // Accepted domains are asserted through the same rule the route uses. Sending
  // a full registration for each one would reach Mongoose with no connection
  // and stall on buffering; the refusal cases below still exercise the route
  // itself, because a bad domain is rejected before any query runs.
  const { isAllowedEmail } = require('../src/utils/email');
  for (const domain of ['scds.saiuniversity.edu.in', 'sas.saiuniversity.edu.in',
    'sol.saiuniversity.edu.in', 'sahs.saiuniversity.edu.in', 'saiuniversity.edu.in']) {
    check(`the accepted domain @${domain} passes domain validation`,
      isAllowedEmail(`student.${domain.split('.')[0]}@${domain}`) === true,
      'the server would refuse this address');
  }

  for (const [email, label] of [
    ['someone@gmail.com', 'an external domain'],
    ['someone@sai.edu', 'a lookalike domain'],
    ['someone@scds.saiuniversity.edu.in.evil.com', 'a suffix trick'],
    ['someone@sub.saiuniversity.edu.in', 'a subdomain of the faculty domain'],
    ['someone@sub.scds.saiuniversity.edu.in', 'a subdomain of a school domain']
  ]) {
    const res = await reg(email);
    check(`${label} is refused (400)`, res.status === 400, `got ${res.status}`);
  }

  {
    const cfg = await request(app).get('/api/auth/config');
    check('the config lists the faculty domain separately',
      Array.isArray(cfg.body.facultyDomains)
      && cfg.body.facultyDomains.includes('saiuniversity.edu.in'),
      JSON.stringify(cfg.body.facultyDomains));
    check('the config still lists all four student domains',
      Array.isArray(cfg.body.allowedEmailDomains) && cfg.body.allowedEmailDomains.length === 4,
      JSON.stringify(cfg.body.allowedEmailDomains));
    const msg = await reg('someone@gmail.com');
    check('the refusal message names the faculty domain too',
      /saiuniversity\.edu\.in/.test(msg.body.message || ''), msg.body.message || '');
  }

  // ---- The browser fallback must mirror the server's domain rule ----
  {
    const authJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'auth.js'), 'utf8');
    const fallback = authJs.slice(authJs.indexOf('let authConfig'), authJs.indexOf('})();'));
    check('the fallback config includes the faculty domain',
      /facultyDomains:\s*\['saiuniversity\.edu\.in'\]/.test(fallback),
      'faculty domain missing from the fallback');
    check('the fallback still lists all four student domains',
      (fallback.match(/saiuniversity\.edu\.in'/g) || []).length >= 5,
      'student domains missing from the fallback');

    const cfg = await request(app).get('/api/auth/config');
    check('the server accepts exactly the domains the fallback offers',
      cfg.body.facultyDomains.includes('saiuniversity.edu.in')
      && cfg.body.allowedEmailDomains.length === 4);
  }

  // ---- Registration feedback: the bug that made the button do nothing ----
  {
    const authJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'auth.js'), 'utf8');
    const handler = authJs.slice(authJs.indexOf("document.getElementById('form-register')"));

    check('registration validation accepts the faculty domain',
      /function acceptedDomains\(\)/.test(authJs) && /facultyDomains/.test(authJs),
      'the client still only knows the student domains');
    check('the refusal message does not reference an out-of-scope variable',
      !/\$\{domains\.map/.test(handler), 'a ReferenceError here is what made the click do nothing');
    check('a pending faculty registration is reported, not navigated past',
      /data\.pendingApproval/.test(handler));
    check('a verification-required registration is reported',
      /data\.verificationRequired/.test(handler));
    check('the submit button is restored on the pending path',
      (handler.match(/btn\.disabled = false/g) || []).length >= 2);
    check('the API error message is surfaced', /err\.message/.test(handler));
    check('the password is never logged', !/console\.(log|error|warn)\([^)]*password/i.test(authJs));
  }

  // ---- Query-parameter injection: an object must never reach Mongoose ----
  for (const qs of ['category[$ne]=x', 'location[$ne]=x', 'type[$ne]=x',
    'subcategory[$ne]=x', 'category[$regex]=.*', 'location[$regex]=.*']) {
    const res = await request(app).get(`/api/items?${qs}`);
    check(`the filter ${qs.split('=')[0]} is refused (400)`, res.status === 400, `got ${res.status}`);
  }
  for (const qs of ['category=Bottles&category=Bags', 'location=Canteen&location=Library',
    'type=found&type=lost', 'subcategory=Flask&subcategory=Tumbler']) {
    const res = await request(app).get(`/api/items?${qs}`);
    check(`a repeated parameter (${qs.split('&')[0].split('=')[0]}) is refused (400)`,
      res.status === 400, `got ${res.status}`);
  }
  for (const qs of ['category=Spaceships', 'location=Atlantis', 'type=sideways']) {
    const res = await request(app).get(`/api/items?${qs}`);
    check(`an unknown filter value ${qs} is refused (400)`, res.status === 400, `got ${res.status}`);
  }
  // ---- Database outage: answer 503 immediately, not 500 after a 10s buffer ----
  {
    const started = Date.now();
    const listNoDb = await request(app).get('/api/items?type=found');
    const elapsed = Date.now() - started;
    check('the listing route answers 503 when the database is down',
      listNoDb.status === 503, `got ${listNoDb.status}`);
    check('and it answers without buffering', elapsed < 2000, `${elapsed}ms`);

    const statsNoDb = await request(app).get('/api/items/stats');
    check('the stats route answers 503 when the database is down',
      statsNoDb.status === 503, `got ${statsNoDb.status}`);
    check('the 503 body is JSON with a message',
      Boolean(statsNoDb.body && statsNoDb.body.message), JSON.stringify(statsNoDb.body));
  }

  // ---- Production CORS must not reflect arbitrary origins ----
  {
    const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
    check('production CORS does not fall back to reflecting any origin',
      /NODE_ENV === 'production' \? \(origins\.length \? origins : false\) : true/.test(appSrc),
      'the permissive fallback is still present');
  }

  console.log('\n' + results.join('\n'));
  // Close the handle so the process exits without waiting on Mongoose
  try { await require('mongoose').connection.close(); } catch { /* never connected */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Route suite crashed:', err.message);
  console.log(results.join('\n'));
  process.exit(1);
});
