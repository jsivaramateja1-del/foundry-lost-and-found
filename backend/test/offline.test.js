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
    'GET /api/leaderboard',
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

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
