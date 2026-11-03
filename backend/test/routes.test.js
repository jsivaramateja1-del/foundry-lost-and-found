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
  for (const page of ['index.html', 'auth.html', 'dashboard.html', 'admin.html']) {
    const res = await request(app).get(`/${page}`);
    check(`GET /${page} returns 200`, res.status === 200, `got ${res.status}`);

    const csp = res.headers['content-security-policy'] || '';
    check(`/${page} is served with a Content-Security-Policy`, csp.includes("script-src 'self'"), csp || '(none)');

    const inline = (res.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []);
    check(`/${page} has no inline <script> that the CSP would block`,
      inline.length === 0, `found ${inline.length}`);
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Route suite crashed:', err.message);
  console.log(results.join('\n'));
  process.exit(1);
});
