/**
 * Runs the exact command Render runs, and fails if it does not serve traffic.
 *
 * This exists because CI tested the code and never the deployment. Twice that
 * cost a real outage: once a startup crash, once a deleted `start:pg` script
 * that Render's Start Command still referenced. Neither could fail a pipeline
 * that only ran `npm ci` and the test suites.
 *
 *   Render Start Command:  cd backend && npm run start:pg
 *
 * So this spawns `npm run start:pg` with backend as the working directory —
 * the same thing — and insists on a live /api/health.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:deploy
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL = process.env.TEST_DATABASE_URL;
let passed = 0, failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const BACKEND = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
const PORT = 5177;
const base = `http://127.0.0.1:${PORT}`;

(async () => {
  // 1. The scripts a deployment depends on must exist. A missing one is a
  //    production outage, not a lint error. These checks need no database, so
  //    they run even when the live boot below is skipped.
  check('package.json defines start:pg (Render runs it)', typeof pkg.scripts['start:pg'] === 'string',
    JSON.stringify(pkg.scripts));
  check('start:pg points at the Postgres entry point',
    (pkg.scripts['start:pg'] || '').includes('server.v2.js'), pkg.scripts['start:pg']);
  check('npm start points at the same entry point',
    (pkg.scripts.start || '').includes('server.v2.js'), pkg.scripts.start);
  check('the entry point file exists', fs.existsSync(path.join(BACKEND, 'server.v2.js')));
  check('the schema file a deploy needs exists', fs.existsSync(path.join(BACKEND, 'db', 'schema.sql')));
  check('db:init exists to apply the schema', typeof pkg.scripts['db:init'] === 'string');

  // 2. Run it for real — only possible with a database.
  if (!URL) {
    console.log('\n' + results.join('\n'));
    console.log('\n  SKIPPED the live boot — TEST_DATABASE_URL is not set.');
    if (failed > 0) { console.log(`\n${passed} passed, ${failed} failed\n`); process.exit(1); }
    if (process.env.CI === 'true') {
      console.error('  Refusing to skip in CI: the deploy command must be proven.\n');
      process.exit(1);
    }
    console.log(`\n${passed} passed, 0 failed (static checks only)\n`);
    process.exit(0);
  }

  const child = spawn('npm', ['run', 'start:pg'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: URL,
      PG_NO_SSL: 'true',
      JWT_SECRET: 'deploy_check_secret_only',
      NODE_ENV: 'production',
      APP_URL: base,
      CLIENT_ORIGIN: base
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });

  let out = '';
  let exited = false;
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('exit', (code) => { exited = true; out += `\n[exited ${code}]`; });

  let health = null;
  for (let i = 0; i < 60; i += 1) {
    if (exited) break;
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) { health = await res.json(); break; }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }

  check('`npm run start:pg` serves /api/health', Boolean(health),
    exited ? `process exited. Output:\n${out.slice(0, 800)}` : 'no response within 30s');
  if (health) {
    check('/api/health reports the database connected', health.db && health.db.ok === true,
      JSON.stringify(health.db));
    const ready = await fetch(`${base}/api/health/ready`);
    check('/api/health/ready returns 200', ready.status === 200, `status ${ready.status}`);
    const items = await fetch(`${base}/api/items`);
    check('/api/items answers 200 (schema applied)', items.status === 200, `status ${items.status}`);
  }

  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  if (!exited) child.kill('SIGKILL');

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
