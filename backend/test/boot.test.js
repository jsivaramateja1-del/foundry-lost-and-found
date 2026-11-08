/**
 * Boot test.
 *
 * Starts an isolated in-memory MongoDB, launches the real server against it, and
 * checks that it answers. This is the only way to prove the production start
 * command works without touching a real database.
 *
 * Run with:  npm run test:boot
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// Ask the OS for a free port instead of hardcoding one: a fixed port collides
// with whatever else happens to be listening (another checkout, a local dev
// server), and the failure looks like a broken app rather than a busy port.
const net = require('net');
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const get = (url) => new Promise((resolve) => {
  const req = http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', () => resolve({ status: 0, body: '' }));
  req.setTimeout(3000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
});

(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  let mongod;
  let server;
  const PORT = await freePort();

  try {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri('foundry-boot-test');

    server = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MONGO_URI: uri,
        JWT_SECRET: 'boot_test_secret_used_only_here',
        PORT: String(PORT)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let log = '';
    server.stdout.on('data', (d) => { log += d.toString(); });
    server.stderr.on('data', (d) => { log += d.toString(); });

    // Wait for the port to answer, up to 30s
    let health = { status: 0 };
    for (let i = 0; i < 60; i += 1) {
      health = await get(`http://127.0.0.1:${PORT}/api/health`);
      if (health.status === 200) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    check('the server starts and answers /api/health', health.status === 200,
      `status ${health.status}; log tail: ${log.slice(-200)}`);

    const ready = await get(`http://127.0.0.1:${PORT}/api/health/ready`);
    check('the readiness endpoint reports the database as reachable', ready.status === 200,
      `status ${ready.status}`);

    const home = await get(`http://127.0.0.1:${PORT}/`);
    check('the server serves the frontend', home.status === 200 && /<html/i.test(home.body),
      `status ${home.status}`);

    const config = await get(`http://127.0.0.1:${PORT}/api/auth/config`);
    check('the config endpoint answers', config.status === 200, `status ${config.status}`);

    const items = await get(`http://127.0.0.1:${PORT}/api/items`);
    check('the listing endpoint answers', items.status === 200, `status ${items.status}`);
  } catch (err) {
    check('the boot test ran', false, err.message);
  } finally {
    // Stop the server first and WAIT for it to exit: mongod must not be shut
    // down underneath a live process, and a hung child would otherwise keep the
    // job running until the runner's timeout.
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill('SIGTERM');
      const timer = setTimeout(() => {
        results.push('  note  the server ignored SIGTERM; sending SIGKILL');
        server.kill('SIGKILL');
      }, 10000);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 15000))]);
      clearTimeout(timer);
    }
    if (mongod) await mongod.stop().catch(() => {});
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
