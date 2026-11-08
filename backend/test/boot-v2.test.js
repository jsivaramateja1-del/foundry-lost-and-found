/**
 * Boots server.v2.js against a real Postgres and proves it serves traffic.
 *
 * This is the test whose absence let a temporal-dead-zone error in
 * src/config/pg.js reach production: every other check passed while the
 * server could not start at all. It asserts the process reaches app.listen(),
 * that /api/health reports a connected database, and that a real query through
 * /api/items works end to end.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:boot-v2
 */
const { spawn } = require('child_process');
const path = require('path');

const URL = process.env.TEST_DATABASE_URL;
let passed = 0, failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

if (!URL) {
  const msg = 'TEST_DATABASE_URL is not set — the Postgres boot test cannot run.';
  console.log(`\n  SKIPPED — ${msg}\n`);
  if (process.env.CI === 'true') {
    console.error('  Refusing to skip in CI: a green run must mean the server boots.\n');
    process.exit(1);
  }
  process.exit(0);
}

const PORT = 5123;
const base = `http://127.0.0.1:${PORT}`;

const waitFor = async (url, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 503) return res;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.v2.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: URL,
      PG_NO_SSL: 'true',
      JWT_SECRET: 'boot_v2_test_secret_only',
      NODE_ENV: 'test',
      APP_URL: base
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  let exited = false;
  child.on('exit', () => { exited = true; });

  try {
    const health = await waitFor(`${base}/api/health`);
    check('the server reaches app.listen()', Boolean(health),
      exited ? `process exited. Output:\n${out.slice(0, 600)}` : 'no response');

    if (health) {
      const body = await health.json();
      check('/api/health reports the database connected', body.db && body.db.ok === true,
        JSON.stringify(body.db));

      const ready = await fetch(`${base}/api/health/ready`);
      const readyBody = await ready.json();
      check('/api/health/ready returns 200 with a live database', ready.status === 200,
        `status ${ready.status} ${JSON.stringify(readyBody.db || {})}`);

      const items = await fetch(`${base}/api/items`);
      check('/api/items answers 200 (the schema is applied)', items.status === 200,
        `status ${items.status}`);
      const itemsBody = await items.json().catch(() => ({}));
      check('/api/items returns a page shape', typeof itemsBody.total === 'number');

      const cfg = await fetch(`${base}/api/auth/config`);
      const cfgBody = await cfg.json().catch(() => ({}));
      check('/api/auth/config advertises the university domain',
        cfgBody.universityDomain === 'saiuniversity.edu.in', JSON.stringify(cfgBody));

      check('the startup log names PostgreSQL', /\(PostgreSQL\)/.test(out), out.slice(0, 300));
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!exited) child.kill('SIGKILL');
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
