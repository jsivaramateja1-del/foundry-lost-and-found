/**
 * Offline checks that need no database.
 * Verifies the app loads, every route is registered, and the schemas
 * reject bad data. Run with:  node test/offline.test.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';

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

/** Convert an Express mount regexp such as ^\/api\/auth\/?(?=\/|$) into /api/auth */
const mountPrefix = (src) => {
  if (!src) return '';
  let out = src.replace(/^\^/, '');
  const cut = out.split('\\/?');
  out = cut[0];
  out = out.split('\\/').join('/');
  return out;
};

(async () => {
  // 1. The whole app must load without throwing
  let app;
  try {
    app = require('../src/app');
    check('src/app.js loads without errors', true);
  } catch (err) {
    check('src/app.js loads without errors', false, err.message);
    console.log(results.join('\n'));
    process.exit(1);
  }

  // 2. Every expected route is registered
  const routes = [];
  const walk = (stack, prefix = '') => {
    stack.forEach((layer) => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((m) => {
          routes.push(`${m.toUpperCase()} ${prefix}${layer.route.path}`.replace(/\/+$/, ''));
        });
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountPrefix(layer.regexp && layer.regexp.source));
      }
    });
  };
  walk(app._router.stack);

  check(`router exposes at least 20 endpoints (found ${routes.length})`, routes.length >= 20);

  const required = [
    'POST /api/auth/register',
    'POST /api/auth/login',
    'GET /api/auth/me',
    'POST /api/auth/logout',
    'GET /api/items',
    'GET /api/items/:id',
    'GET /api/items/:id/similar',
    'POST /api/items',
    'PUT /api/items/:id',
    'PATCH /api/items/:id/status',
    'DELETE /api/items/:id',
    'POST /api/claims',
    'GET /api/claims/mine',
    'GET /api/claims/item/:itemId',
    'PATCH /api/claims/:id',
    'GET /api/dashboard/me',
    'GET /api/admin/stats',
    'GET /api/admin/items',
    'GET /api/admin/claims',
    'GET /api/admin/users',
    'DELETE /api/admin/items/:id',
    'PATCH /api/admin/users/:id/role',
    'GET /api/leaderboard',
    'GET /api/items/stats',
    'GET /api/notifications',
    'PATCH /api/notifications/read-all',
    'PATCH /api/notifications/:id/read',
    'GET /api/health'
  ];
  const missing = required.filter((r) => !routes.includes(r));
  check(`all ${required.length} required routes are registered`, missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : '');

  // 3. Schema validation catches bad input
  const Item = require('../src/models/Item');
  const User = require('../src/models/User');
  const Claim = require('../src/models/Claim');

  const badItem = new Item({ title: '', description: '', category: 'Nonsense', location: 'Nowhere', type: 'borrowed' });
  const badErr = badItem.validateSync();
  check('Item schema rejects a completely invalid item',
    !!badErr && Object.keys(badErr.errors).length >= 5,
    badErr ? Object.keys(badErr.errors).join(',') : 'no error');

  const goodItem = new Item({
    title: 'Blue Bottle',
    description: 'A blue steel bottle.',
    category: 'Bottles',
    location: 'Canteen',
    type: 'found',
    date: new Date(),
    reportedBy: '64d2f1f1f1f1f1f1f1f1f1f1'
  });
  check('Item schema accepts a valid item', goodItem.validateSync() === undefined);

  const badUser = new User({ name: 'A', email: 'nope', password: '123' });
  const userErr = badUser.validateSync();
  check('User schema rejects an invalid email', !!userErr && !!userErr.errors.email);
  check('User schema rejects a short password', !!userErr && !!userErr.errors.password);

  const badClaim = new Claim({ message: 'x' });
  check('Claim schema requires an item and a claimant', !!badClaim.validateSync());

  // 4. Password hashing helper behaves correctly
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('secret123', 10);
  check('bcrypt hash verifies against the right password', await bcrypt.compare('secret123', hash));
  check('bcrypt rejects the wrong password', !(await bcrypt.compare('wrong', hash)));

  // 5. Token signing and verification round-trips
  const jwt = require('jsonwebtoken');
  const { signToken } = require('../src/middleware/auth');
  const token = signToken('64d2f1f1f1f1f1f1f1f1f1f1');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  check('signToken produces a verifiable JWT', decoded.id === '64d2f1f1f1f1f1f1f1f1f1f1');

  // 6. No default credentials and no fallback secret anywhere in the source
  const fs = require('fs');
  const path = require('path');
  const backendDir = path.join(__dirname, '..');
  const authSource = fs.readFileSync(path.join(backendDir, 'src/middleware/auth.js'), 'utf8');

  check('auth.js contains no fallback JWT secret',
    !authSource.includes('dev_only_secret') && !/\|\|\s*'[^']*secret/i.test(authSource));

  const savedSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  let threwWithoutSecret = false;
  try {
    signToken('64d2f1f1f1f1f1f1f1f1f1f1');
  } catch (err) {
    threwWithoutSecret = true;
  }
  process.env.JWT_SECRET = savedSecret;
  check('signToken refuses to run without JWT_SECRET', threwWithoutSecret);

  const pkg = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
  check('no npm script seeds demo data',
    !pkg.scripts.seed && !fs.existsSync(path.join(backendDir, 'seed.js')));
  check('create-admin and cleanup:demo scripts exist',
    !!pkg.scripts['create-admin'] && !!pkg.scripts['cleanup:demo'] &&
    fs.existsSync(path.join(backendDir, 'scripts/create-admin.js')) &&
    fs.existsSync(path.join(backendDir, 'scripts/cleanup-demo.js')));

  // No known demo password may appear anywhere in the tracked source
  // Built at runtime so this file does not itself contain the strings it bans
  const demoPasswords = ['admin' + '123', 'student' + '123', 'priya' + '123'];
  const walkDir = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkDir(full) : [full];
  });
  const projectRoot = path.join(backendDir, '..');
  const offenders = [];
  walkDir(projectRoot).forEach((file) => {
    if (!/\.(js|html|json|md)$/.test(file) || file.endsWith('package-lock.json')) return;
    const body = fs.readFileSync(file, 'utf8');
    demoPasswords.forEach((pw) => {
      if (body.includes(pw)) offenders.push(`${path.relative(projectRoot, file)} -> ${pw}`);
    });
  });
  check('no demo password appears in the repository',
    offenders.length === 0, offenders.join('; '));

  // 7. The promises the UI makes have to match the code
  const itemSource = fs.readFileSync(path.join(backendDir, 'src/routes/item.routes.js'), 'utf8');
  check('keyword search covers the location fields',
    /location: rx/.test(itemSource) && /customLocation: rx/.test(itemSource));

  const frontendDir = path.join(projectRoot, 'frontend');
  const misleading = [];
  ['index.html', 'auth.html'].forEach((page) => {
    const body = fs.readFileSync(path.join(frontendDir, page), 'utf8');
    ['seeded sample listings', 'Demo deployment', 'demo accounts'].forEach((phrase) => {
      if (body.toLowerCase().includes(phrase.toLowerCase())) misleading.push(`${page}: "${phrase}"`);
    });
  });
  check('no misleading demo wording is left in the UI', misleading.length === 0, misleading.join('; '));

  const Notification = require('../src/models/Notification');
  check('Notification schema requires a user, type and message',
    !!new Notification({}).validateSync());

  const statsSource = fs.readFileSync(path.join(backendDir, 'src/routes/dashboard.routes.js'), 'utf8');
  check('dashboard stats report claimed listings',
    /claimed: items\.filter/.test(statsSource));

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
