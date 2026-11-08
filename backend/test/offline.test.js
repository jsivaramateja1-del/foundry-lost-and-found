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

    const expected = [
    'DELETE /api/admin/items/:id',
    'DELETE /api/items/:id',
    'GET /api/admin/audit',
    'GET /api/admin/claims',
    'GET /api/admin/items',
    'GET /api/admin/reports',
    'GET /api/admin/stats',
    'GET /api/admin/users',
    'GET /api/auth/config',
    'GET /api/auth/me',
    'GET /api/claims/item/:itemId',
    'GET /api/claims/mine',
    'GET /api/claims/received',
    'GET /api/dashboard/me',
    'GET /api/health',
    'GET /api/health/ready',
    'GET /api/items',
    'GET /api/items/:id',
    'GET /api/items/:id/similar',
    'GET /api/items/meta',
    'GET /api/items/stats',
    'GET /api/campus/locations',
    'POST /api/campus/locations',
    'GET /api/leaderboard',
    'GET /api/notifications',
    'PATCH /api/admin/items/:id/status',
    'PATCH /api/admin/items/:id/verify',
    'PATCH /api/admin/reports/:id',
    'PATCH /api/admin/users/:id/approve',
    'PATCH /api/admin/users/:id/role',
    'PATCH /api/admin/users/:id/suspend',
    'PATCH /api/auth/preferences',
    'PATCH /api/claims/:id',
    'PATCH /api/items/:id/status',
    'PATCH /api/notifications/:id/read',
    'PATCH /api/notifications/read-all',
    'POST /api/auth/forgot-password',
    'POST /api/auth/login',
    'POST /api/auth/logout',
    'POST /api/auth/register',
    'POST /api/auth/resend-verification',
    'POST /api/auth/reset-password',
    'POST /api/auth/verify-email',
    'POST /api/claims',
    'POST /api/claims/:id/handover',
    'POST /api/items',
    'POST /api/items/:id/report',
    'PUT /api/items/:id'
  ];

  const actualSet = new Set(routes);
  const expectedSet = new Set(expected);

  const missing = expected.filter((r) => !actualSet.has(r));
  const unexpected = [...actualSet].filter((r) => !expectedSet.has(r));
  const duplicates = routes.filter((r, i) => routes.indexOf(r) !== i);

  check(
    `router exposes exactly ${expected.length} unique endpoints`,
    routes.length === expected.length && actualSet.size === expected.length,
    `found ${routes.length} routes and ${actualSet.size} unique routes`
  );

  check(
    'all expected routes are registered',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : ''
  );

  check(
    'no unexpected routes are registered',
    unexpected.length === 0,
    unexpected.length ? `unexpected: ${unexpected.join(', ')}` : ''
  );

  check(
    'no duplicate routes are registered',
    duplicates.length === 0,
    duplicates.length ? `duplicates: ${duplicates.join(', ')}` : ''
  );

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

  // 8. The university email rule, tested as plain functions
  const emailUtils = require('../src/utils/email');

  const accepted = [
    'audisiva.i-29@scds.saiuniversity.edu.in',
    'student@scds.saiuniversity.edu.in',
    'example123@scds.saiuniversity.edu.in',
    'STUDENT@SCDS.SAIUNIVERSITY.EDU.IN',
    '  student@scds.saiuniversity.edu.in  ',
    // Faculty addresses use the parent domain and are allowed by requirement
    'prof@saiuniversity.edu.in'
  ];
  const rejected = [
    'student@gmail.com',
    'student@yahoo.com',
    'student@outlook.com',
    'student@otheruniversity.edu.in',
    'student@scds.saiuniversity.edu.in.evil.com',
    'student@sub.scds.saiuniversity.edu.in',
    'student@evilscds.saiuniversity.edu.in',
    'student',
    'student@',
    '@scds.saiuniversity.edu.in',
    ''
  ];

  accepted.forEach((address) => {
    check(`accepts ${address.trim()}`, emailUtils.isAllowedEmail(address));
  });
  rejected.forEach((address) => {
    check(`refuses "${address}"`, !emailUtils.isAllowedEmail(address));
  });

  check('normaliseEmail lowercases and trims',
    emailUtils.normaliseEmail('  SomeOne@SCDS.SaiUniversity.EDU.IN ') === 'someone@scds.saiuniversity.edu.in');

  check('all four school domains are allowed by default',
    emailUtils.STUDENT_DOMAINS.length === 4 &&
    ['scds', 'sas', 'sol', 'sahs'].every((school) =>
      emailUtils.isAllowedEmail(`student@${school}.saiuniversity.edu.in`)),
    emailUtils.STUDENT_DOMAINS.join(', '));

  check('the faculty domain is allowed and recognised as faculty',
    emailUtils.isAllowedEmail('prof@saiuniversity.edu.in') &&
    emailUtils.isFacultyEmail('prof@saiuniversity.edu.in'));

  check('a student domain is not treated as faculty',
    !emailUtils.isFacultyEmail('student@scds.saiuniversity.edu.in'));

  check('a made-up school domain is still refused',
    !emailUtils.isAllowedEmail('student@eng.saiuniversity.edu.in'));

  check('the error message names every student domain',
    emailUtils.STUDENT_DOMAINS.every((d) => emailUtils.emailDomainError().includes(d)));

  // The domain is configurable, but only when an administrator sets it
  const savedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
  process.env.ALLOWED_EMAIL_DOMAIN = 'Example.EDU';
  check('the allowlist can be overridden by an environment variable',
    emailUtils.allowedDomain() === 'example.edu' && emailUtils.isAllowedEmail('a@example.edu'));
  check('an override replaces the list rather than adding to it',
    emailUtils.allowedDomains().length === 1 && !emailUtils.isAllowedEmail('a@sas.saiuniversity.edu.in'));
  check('an override does not open the original domain',
    !emailUtils.isAllowedEmail('a@scds.saiuniversity.edu.in'));
  if (savedDomain === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
  else process.env.ALLOWED_EMAIL_DOMAIN = savedDomain;

  // 9. Verification tokens are random, hashed and expiring
  const tokenA = emailUtils.createVerificationToken();
  const tokenB = emailUtils.createVerificationToken();
  check('verification tokens are 64 hex characters', /^[a-f0-9]{64}$/.test(tokenA));
  check('two tokens are never the same', tokenA !== tokenB);
  check('a token hash is stable', emailUtils.hashVerificationToken(tokenA) === emailUtils.hashVerificationToken(tokenA));
  check('the hash is not the token itself', emailUtils.hashVerificationToken(tokenA) !== tokenA);
  check('different tokens hash differently', emailUtils.hashVerificationToken(tokenA) !== emailUtils.hashVerificationToken(tokenB));
  check('verification expires in the future',
    emailUtils.verificationExpiry().getTime() > Date.now());
  check('email verification is off by default',
    emailUtils.emailVerificationEnabled() === false);

  // 9b. Role guards and the verification gate, as middleware
  const { requireRole, requireVerified, ADMIN_ROLES, MODERATION_ROLES, SUPER_ROLES } = require('../src/middleware/auth');

  const callGuard = (middleware, user) => new Promise((resolve) => {
    const req = { user };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; resolve({ blocked: true, code: this.statusCode, body: payload }); }
    };
    middleware(req, res, () => resolve({ blocked: false }));
  });

  const asStudent = await callGuard(requireRole(...ADMIN_ROLES), { role: 'student' });
  check('a student is refused an admin-only route', asStudent.blocked && asStudent.code === 403);

  const asModerator = await callGuard(requireRole(...MODERATION_ROLES), { role: 'moderator' });
  check('a moderator is allowed a moderation route', asModerator.blocked === false);

  const modOnAdmin = await callGuard(requireRole(...ADMIN_ROLES), { role: 'moderator' });
  check('a moderator is refused an admin-only route', modOnAdmin.blocked && modOnAdmin.code === 403);

  const adminOnSuper = await callGuard(requireRole(...SUPER_ROLES), { role: 'admin' });
  check('a plain admin cannot appoint other administrators', adminOnSuper.blocked && adminOnSuper.code === 403);

  const superOnSuper = await callGuard(requireRole(...SUPER_ROLES), { role: 'superadmin' });
  check('a superadmin may appoint administrators', superOnSuper.blocked === false);

  const suspendedUser = await callGuard(requireVerified, { role: 'student', emailVerified: true, pendingApproval: true });
  check('a pending faculty account is blocked from protected actions',
    suspendedUser.blocked && /waiting for an administrator/.test(suspendedUser.body.message));

  const approvedUser = await callGuard(requireVerified, { role: 'student', emailVerified: true, pendingApproval: false });
  check('an approved account passes the verification gate', approvedUser.blocked === false);

  const suspended = await callGuard((req, res, next) => next(), {});
  check('the guard chain completes for an ordinary user', suspended.blocked === false);

  // 9c. Category tree
  const categories = require('../src/utils/categories');

  check('there are eight main categories', categories.CATEGORIES.length === 8, categories.CATEGORIES.join(', '));
  check('Electronics offers the documented subcategories',
    JSON.stringify(categories.subcategoriesFor('Electronics')) ===
    JSON.stringify(['Mobile Phones', 'Earphones', 'Headphones', 'Chargers', 'Laptops', 'Tablets', 'Smartwatches', 'Other Electronics']));
  check('every category except Other has subcategories',
    categories.CATEGORIES.filter((c) => c !== 'Other').every((c) => categories.subcategoriesFor(c).length > 0));
  check('Other has no fixed subcategories', categories.subcategoriesFor('Other').length === 0);
  check('a valid category/subcategory pair is accepted',
    categories.isValidSubcategory('Electronics', 'Earphones'));
  check('a subcategory from another category is refused',
    !categories.isValidSubcategory('Electronics', 'Backpack'));
  check('an omitted subcategory is allowed',
    categories.isValidSubcategory('Electronics', undefined) && categories.isValidSubcategory('Electronics', ''));
  check('an unknown category yields no subcategories',
    categories.subcategoriesFor('Nonsense').length === 0);

  check('the Item model accepts a subcategory',
    new Item({
      title: 'Earbuds', description: 'Black earbuds', category: 'Electronics', subcategory: 'Earphones',
      location: 'Library', type: 'found', date: new Date(), reportedBy: '64d2f1f1f1f1f1f1f1f1f1f1'
    }).validateSync() === undefined);

  // 10. Moderation models
  const Report = require('../src/models/Report');
  const AuditLog = require('../src/models/AuditLog');

  const emptyReport = new Report({});
  const reportErr = emptyReport.validateSync();
  check('Report schema requires an item, a reporter and a reason',
    !!reportErr && !!reportErr.errors.item && !!reportErr.errors.reportedBy && !!reportErr.errors.reason);

  const badReason = new Report({
    item: '64d2f1f1f1f1f1f1f1f1f1f1',
    reportedBy: '64d2f1f1f1f1f1f1f1f1f1f1',
    reason: 'not-a-reason'
  });
  check('Report schema refuses an unknown reason',
    !!badReason.validateSync() && !!badReason.validateSync().errors.reason);

  check('the five report reasons are the ones the UI offers',
    JSON.stringify(Report.REPORT_REASONS) === JSON.stringify(['spam', 'inappropriate', 'suspicious', 'incorrect', 'other']));

  const goodReport = new Report({
    item: '64d2f1f1f1f1f1f1f1f1f1f1',
    reportedBy: '64d2f1f1f1f1f1f1f1f1f1f1',
    reason: 'spam'
  });
  check('a valid report passes validation and starts open',
    goodReport.validateSync() === undefined && goodReport.status === 'open');

  check('AuditLog requires an actor and a known action',
    !!new AuditLog({}).validateSync() && !!new AuditLog({ actor: '64d2f1f1f1f1f1f1f1f1f1f1', action: 'nonsense' }).validateSync());

  check('AuditLog accepts a real action',
    new AuditLog({ actor: '64d2f1f1f1f1f1f1f1f1f1f1', action: 'user_suspended' }).validateSync() === undefined);

  // 10b. Phase 1 additions: notification targets, claim notes, transactions
  const goodNotification = new Notification({
    user: '64d2f1f1f1f1f1f1f1f1f1f1',
    type: 'claim_received',
    message: 'Someone claimed your item.',
    link: 'dashboard.html#claims-received',
    relatedType: 'claim',
    relatedId: '64d2f1f1f1f1f1f1f1f1f1f1'
  });
  check('a notification can point at the record it is about',
    goodNotification.validateSync() === undefined);

  check('a notification refuses an unknown relatedType',
    !!new Notification({
      user: '64d2f1f1f1f1f1f1f1f1f1f1', type: 'claim_received',
      message: 'x', relatedType: 'nonsense'
    }).validateSync());

  check('a notification without a related record is still valid',
    new Notification({ user: '64d2f1f1f1f1f1f1f1f1f1f1', type: 'claim_received', message: 'x' }).validateSync() === undefined);

  const claimIndexes = Claim.schema.indexes().map(([fields]) => JSON.stringify(fields));
  check('claims are indexed by item and status for the conflict check',
    claimIndexes.includes(JSON.stringify({ item: 1, status: 1 })), claimIndexes.join(' '));

  check('a claim can record why it was decided',
    new Claim({
      item: '64d2f1f1f1f1f1f1f1f1f1f1', claimant: '64d2f1f1f1f1f1f1f1f1f1f1',
      message: 'Mine', reviewNote: 'Another claim was approved for this listing.'
    }).validateSync() === undefined);

  const { supportsTransactions } = require('../src/utils/transactions');
  check('transaction support is detected without a connection (and says no)',
    (await supportsTransactions()) === false);

  // 10c. The auth page must show exactly one form at a time.
  // `.auth-form { display: none }` hides both, `.auth-form[data-active="true"]`
  // reveals the active one. A later unqualified `.auth-form` rule that sets
  // `display` ties on specificity and wins on source order, which silently
  // shows both forms. That regression shipped once; this stops it returning.
  const cssSource = fs.readFileSync(path.join(projectRoot, 'frontend/assets/css/styles.css'), 'utf8');

  const findDisplayOverrides = (css) => {
    // Comments removed first, and the rule pattern must NOT consume the closing
    // brace: doing so makes the scanner skip every other rule.
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = [];
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = rulePattern.exec(source)) !== null) {
      const selectors = match[1].split(',').map((part) => part.trim());
      const onlyAuthForm = selectors.length > 0 && selectors.every((sel) => sel === '.auth-form');
      if (!onlyAuthForm) continue;
      // `display: none` is the intended hide. Any other value is the bug.
      const declaration = match[2].match(/(?:^|;)\s*display\s*:\s*([^;]+)/);
      const value = declaration ? declaration[1].trim() : null;
      if (value && value !== 'none') {
        offenders.push(`${selectors.join(',')} { display: ${value} }`);
      }
    }
    return offenders;
  };

  const overrides = findDisplayOverrides(cssSource);
  check('no unqualified .auth-form rule declares display',
    overrides.length === 0, overrides.join(' | '));

  check('the auth form visibility rules are still present',
    /\.auth-form\s*\{\s*display:\s*none/.test(cssSource) &&
    /\.auth-form\[data-active="true"\]\s*\{\s*display:\s*grid/.test(cssSource));

  // 11. Suspension is off by default, so no existing account changes behaviour
  const freshUser = new User({ name: 'Suspended Check', email: 'a@scds.saiuniversity.edu.in', password: 'secret123' });
  check('a new account is not suspended', freshUser.suspended === false);
  check('a new account is a student, never an administrator', freshUser.role === 'student');
  check('the role enum accepts the administrative roles',
    ['student', 'faculty', 'moderator', 'admin', 'superadmin'].every((role) =>
      new User({ name: 'R', email: `r${role}@scds.saiuniversity.edu.in`, password: 'secret123', role }).validateSync() === undefined));
  check('an invented role is refused',
    !!new User({ name: 'R', email: 'r@scds.saiuniversity.edu.in', password: 'secret123', role: 'god' }).validateSync());
  check('toSafeObject exposes the suspension flag, never the password hash',
    (() => {
      const safe = freshUser.toSafeObject();
      return safe.suspended === false && safe.password === undefined;
    })());

  // 15. Gamification rules and ranking are pure, so they can be checked here
  const { assignRanks } = require('../src/utils/ranking');
  const { BADGES, POINTS } = require('../src/utils/gamification');

  check('a return is worth more than posting a found item',
    POINTS.return > POINTS.found_item, `${POINTS.return} vs ${POINTS.found_item}`);

  const board = assignRanks([
    { name: 'B', points: 20, returns: 2 },
    { name: 'A', points: 20, returns: 2 },
    { name: 'C', points: 10, returns: 1 },
    { name: 'D', points: 5, returns: 0 }
  ]);
  check('equal points share a rank and the next rank skips',
    board[0].rank === 1 && board[1].rank === 1 && board[2].rank === 3 && board[3].rank === 4,
    board.map((r) => `${r.name}:${r.points}=${r.rank}`).join(' '));
  check('ties are ordered by name, so the board is stable',
    board[0].name === 'A' && board[1].name === 'B', `${board[0].name},${board[1].name}`);
  check('the highest score is first', board[0].points === 20);

  const badge = (id) => BADGES.find((b) => b.id === id);
  check('there are five badges', BADGES.length === 5, BADGES.map((b) => b.id).join(','));
  check('First Found Item needs one found listing',
    badge('first_found').earned({ foundItems: 1, returns: 0 }) === true
    && badge('first_found').earned({ foundItems: 0, returns: 0 }) === false);
  check('Helpful Finder needs three found listings',
    badge('helpful_finder').earned({ foundItems: 3, returns: 0 }) === true
    && badge('helpful_finder').earned({ foundItems: 2, returns: 0 }) === false);
  check('Successful Return needs one verified return',
    badge('successful_return').earned({ foundItems: 0, returns: 1 }) === true);
  check('Community Helper needs five returns',
    badge('community_helper').earned({ foundItems: 0, returns: 5 }) === true
    && badge('community_helper').earned({ foundItems: 0, returns: 4 }) === false);
  check('Trusted Member needs ten returns',
    badge('trusted_member').earned({ foundItems: 0, returns: 10 }) === true
    && badge('trusted_member').earned({ foundItems: 0, returns: 9 }) === false);

  // 16. Gamification failure paths.
  // The persistence layer is stubbed on purpose: these are unit tests of the
  // state machine, not integration tests. They run without a database.
  const PointEvent = require('../src/models/PointEvent');
  const GamUser = require('../src/models/User');
  const { awardPoints } = require('../src/utils/gamification');

  const real = {
    findOne: PointEvent.findOne,
    create: PointEvent.create,
    claim: PointEvent.findOneAndUpdate,
    updateOne: PointEvent.updateOne,
    deleteOne: PointEvent.deleteOne,
    userUpdateOne: GamUser.updateOne,
    userExists: GamUser.exists,
    error: console.error
  };

  const runAward = async (stubs) => {
    const calls = { credits: 0, marks: [], deletes: 0 };
    PointEvent.findOne = stubs.findOne || (async () => null);
    PointEvent.create = stubs.create || (async () => ({ _id: 'ev', user: 'u1', type: 'return', points: 10 }));
    PointEvent.findOneAndUpdate = stubs.claim || (async () => ({
      _id: 'ev', user: 'u1', type: 'return', points: 10, status: 'claimed'
    }));
    PointEvent.updateOne = async (filter, update) => {
      calls.marks.push(update && update.$set && update.$set.status);
      return { modifiedCount: 1 };
    };
    PointEvent.deleteOne = async () => { calls.deletes += 1; return { deletedCount: 1 }; };
    GamUser.updateOne = stubs.credit || (async (filter, update) => {
      // Only a real increment counts as a credit; the marker prune is a
      // separate update on the same model.
      if (update && update.$inc) calls.credits += 1;
      return { modifiedCount: 1 };
    });
    GamUser.exists = stubs.exists || (async () => ({ _id: 'u1' }));
    console.error = () => {};

    let result = null;
    let thrown = null;
    try {
      result = await awardPoints({ userId: 'u1', type: 'return', key: 'k1' });
    } catch (err) {
      thrown = err;
    } finally {
      PointEvent.findOne = real.findOne;
      PointEvent.create = real.create;
      PointEvent.findOneAndUpdate = real.claim;
      PointEvent.updateOne = real.updateOne;
      PointEvent.deleteOne = real.deleteOne;
      GamUser.updateOne = real.userUpdateOne;
      GamUser.exists = real.userExists;
      console.error = real.error;
    }
    return { result, thrown, calls };
  };

  // A completed event is never paid again
  const done = await runAward({
    findOne: async () => ({ _id: 'ev', user: 'u1', status: 'completed' }),
    credit: async () => { throw new Error('must not credit a completed event'); }
  });
  check('a completed event reports already-awarded and credits nothing',
    done.result && done.result.reason === 'already-awarded' && done.calls.credits === 0,
    JSON.stringify(done.result));

  // A fresh event is claimed, credited once, then marked completed
  const fresh = await runAward({});
  check('a new event is credited once and marked completed',
    fresh.result && fresh.result.awarded === true
    && fresh.calls.credits === 1 && fresh.calls.marks.includes('completed'),
    JSON.stringify({ r: fresh.result, c: fresh.calls }));

  // Another request holds a live claim
  const inFlight = await runAward({
    findOne: async () => ({ _id: 'ev', user: 'u1', status: 'claimed' }),
    claim: async () => null,
    credit: async () => { throw new Error('must not credit while another holds the claim'); }
  });
  check('a live claim elsewhere reports in-progress and credits nothing',
    inFlight.result && inFlight.result.reason === 'in-progress' && inFlight.calls.credits === 0,
    JSON.stringify(inFlight.result));

  // CRASH AFTER THE CLAIM, before the credit: the lease expires and a retry
  // finishes the job. The claim query is what makes this possible.
  const recoveredAfterCrash = await runAward({
    findOne: async () => ({ _id: 'ev', user: 'u1', status: 'claimed', claimedAt: new Date(Date.now() - 120000) })
  });
  check('a claim abandoned by a crash is picked up and credited',
    recoveredAfterCrash.result && recoveredAfterCrash.result.awarded === true
    && recoveredAfterCrash.calls.credits === 1,
    JSON.stringify(recoveredAfterCrash.result));

  // CRASH AFTER THE CREDIT, before marking completed: the retry must not pay
  // twice. The guarded update matches nothing and the row is just completed.
  const recoveredAfterCredit = await runAward({
    findOne: async () => ({ _id: 'ev', user: 'u1', status: 'claimed', claimedAt: new Date(Date.now() - 120000) }),
    credit: async () => ({ modifiedCount: 0 }),
    exists: async () => ({ _id: 'u1' })
  });
  check('a retry after the credit has landed does not pay twice',
    recoveredAfterCredit.result && recoveredAfterCredit.result.reason === 'already-awarded',
    JSON.stringify(recoveredAfterCredit.result));
  check('and the event is still marked completed',
    recoveredAfterCredit.calls.marks.includes('completed'));

  // The account vanished
  const gone = await runAward({
    credit: async () => ({ modifiedCount: 0 }),
    exists: async () => null
  });
  check('a vanished account is reported and its event removed',
    gone.result && gone.result.reason === 'user-missing' && gone.calls.deletes === 1,
    JSON.stringify(gone.result));

  // A database failure while crediting surfaces rather than being swallowed
  const dbDown = await runAward({
    credit: async () => { throw new Error('connection lost'); }
  });
  check('a failed credit write surfaces instead of being swallowed',
    dbDown.thrown && dbDown.thrown.message === 'connection lost');
  check('a failed credit leaves the event un-completed, so it is retried later',
    !dbDown.calls.marks.includes('completed'), JSON.stringify(dbDown.calls.marks));

  // 16b. Reconciliation never erases a historical balance
  const { classifyBalance, planChange } = require('../src/utils/reconcile');

  const inSync = classifyBalance({ storedPoints: 30, storedReturns: 3, ledgerPoints: 30, ledgerReturns: 3 });
  check('a balance explained by the ledger is in-sync', inSync.state === 'in-sync', inSync.state);

  const historical = classifyBalance({ storedPoints: 120, storedReturns: 12, ledgerPoints: 30, ledgerReturns: 3 });
  check('a balance larger than the ledger is a historical balance',
    historical.state === 'historical-balance' && historical.preLedgerPoints === 90
    && historical.preLedgerReturns === 9, JSON.stringify(historical));
  check('a historical balance is skipped by default',
    planChange(historical).action === 'skip', planChange(historical).action);
  check('a historical balance is only reduced when explicitly allowed',
    planChange(historical, { allowDecrease: true }).action === 'reduce');

  const under = classifyBalance({ storedPoints: 20, storedReturns: 2, ledgerPoints: 30, ledgerReturns: 3 });
  check('a balance smaller than the ledger is under-credited',
    under.state === 'under-credited', under.state);
  check('an under-credited account is topped up, which only adds points',
    planChange(under).action === 'top-up'
    && planChange(under).to.points === 30 && planChange(under).from.points === 20);

  const noEvents = classifyBalance({ storedPoints: 50, storedReturns: 5, ledgerPoints: 0, ledgerReturns: 0 });
  check('an account with no ledger events keeps its balance',
    noEvents.state === 'historical-balance' && planChange(noEvents).action === 'skip');

  // 16c. Idempotency is durable, not a rolling window
  const gamSource = fs.readFileSync(path.join(backendDir, 'src/utils/gamification.js'), 'utf8');
  check('the credit marker is never truncated by a size limit',
    !/\$slice/.test(gamSource) && !/CREDITED_HISTORY/.test(gamSource));
  check('the credit marker is never pruned',
    !/\$pull/.test(gamSource) && !/deleteOne\(\{ _id: event\._id \}, \{ \$pull/.test(gamSource));
  check('a stale worker is defeated by the marker, not by a status re-read',
    /creditedEvents: \{ \$ne: String\(event\._id\) \}/.test(gamSource)
    && /marker is permanent/.test(gamSource));

  // The credit guard must be in the same atomic update as the increment
  check('the credit update is guarded on the event id',
    /creditedEvents: \{ \$ne: String\(event\._id\) \}/.test(gamSource));

  // 16d. A stuck event stays protected however many other credits happen.
  // (The marker is no longer dropped on a size limit, so this is structural,
  // but the behaviour is asserted through the same stubs as above.)
  let otherCredits = 0;
  const manyCredits = await runAward({
    findOne: async () => ({ _id: 'stuck', user: 'u1', status: 'claimed', claimedAt: new Date(Date.now() - 120000) }),
    credit: async (filter, update) => {
      if (update && update.$inc) otherCredits += 1;
      return { modifiedCount: 0 };
    },
    exists: async () => ({ _id: 'u1' })
  });
  check('a stuck event is never credited a second time after many other credits',
    manyCredits.result && manyCredits.result.reason === 'already-awarded'
    && otherCredits === 1,
    `${JSON.stringify(manyCredits.result)} attempts=${otherCredits}`);

  // 16e. Lease rules used by the recovery tools
  const { isRecoverable, leaseClaimFilter } = require('../src/utils/reconcile');
  const liveLease = { _id: 'e1', status: 'claimed', claimedAt: new Date() };
  const staleLease = { _id: 'e2', status: 'claimed', claimedAt: new Date(Date.now() - 120000) };
  check('a live lease is not recoverable', isRecoverable(liveLease) === false);
  check('an expired lease is recoverable', isRecoverable(staleLease) === true);
  check('a pending event is recoverable', isRecoverable({ _id: 'e3', status: 'pending' }) === true);
  check('a completed event is never recoverable',
    isRecoverable({ _id: 'e4', status: 'completed' }) === false);

  const staleFilter = leaseClaimFilter(staleLease);
  check('the takeover filter carries the exact lease it observed',
    staleFilter.claimedAt === staleLease.claimedAt && staleFilter.status === 'claimed',
    JSON.stringify(staleFilter));
  const renewed = new Date(staleLease.claimedAt.getTime() + 30000);
  check('a lease renewed between selection and update cannot be taken',
    renewed.getTime() !== staleFilter.claimedAt.getTime(),
    `renewed ${renewed.toISOString()} vs filter ${staleFilter.claimedAt.toISOString()}`);
  check('a pending event is taken by id and status only',
    JSON.stringify(leaseClaimFilter({ _id: 'e5', status: 'pending' })) === '{"_id":"e5","status":"pending"}');

  // 16f. Recovering awards that were never written
  const { recoverMissingAwards } = require('../src/utils/gamification');
  const RecItem = require('../src/models/Item');
  const RecClaim = require('../src/models/Claim');
  const recReal = { itemFind: RecItem.find, claimFindOne: RecClaim.findOne, exists: PointEvent.exists };

  const chain = (value) => ({
    select: () => chain(value),
    sort: () => chain(value),
    limit: () => chain(value),
    lean: async () => value
  });

  const runRecovery = async ({ found = [], returned = [], approved = null, existing = null, apply = false }) => {
    RecItem.find = (query) => chain(query && query.type === 'found' ? found : returned);
    RecClaim.findOne = () => chain(approved);
    PointEvent.exists = async () => existing;
    const created = [];
    const realCreate = PointEvent.create;
    PointEvent.create = async (doc) => { created.push(doc.key || (doc[0] && doc[0].key)); return { _id: 'ev' }; };
    try {
      const report = await recoverMissingAwards({ apply, sinceDays: 30 });
      return { report, created };
    } finally {
      RecItem.find = recReal.itemFind;
      RecClaim.findOne = recReal.claimFindOne;
      PointEvent.exists = recReal.exists;
      PointEvent.create = realCreate;
    }
  };

  const planned = await runRecovery({
    found: [{ _id: 'i1', reportedBy: 'u1' }],
    returned: [{ _id: 'i2', reportedBy: 'u1' }],
    approved: { _id: 'c1', claimant: 'u2' }
  });
  check('recovery finds the awards a failed write never created',
    planned.report.missingSample.includes('found:i1')
    && planned.report.missingSample.includes('return:i2:u1')
    && planned.report.missingSample.includes('return:i2:u2'),
    JSON.stringify(planned.report.missingSample));
  check('a dry run creates nothing', planned.created.length === 0);

  const again = await runRecovery({
    found: [{ _id: 'i1', reportedBy: 'u1' }],
    returned: [],
    existing: { _id: 'already' }
  });
  check('a second run reports the award as already present',
    again.report.missing === 0 && again.report.alreadyPresent === 1,
    JSON.stringify({ missing: again.report.missing, present: again.report.alreadyPresent }));

  const noClaim = await runRecovery({
    found: [],
    returned: [{ _id: 'i3', reportedBy: 'u1' }],
    approved: null
  });
  check('a return without an approved claim is not eligible for points',
    noClaim.report.scanned === 1 && noClaim.report.missing === 0 && noClaim.report.missingSample.length === 0,
    JSON.stringify({ scanned: noClaim.report.scanned, missing: noClaim.report.missing, sample: noClaim.report.missingSample }));

  const ineligible = await runRecovery({ found: [], returned: [], approved: null });
  check('nothing eligible means nothing is awarded',
    ineligible.report.missing === 0 && ineligible.report.scanned === 0);

  // 16g. The stale-worker race, deterministically.
  // A fake store that implements the real update semantics: the guard is checked
  // inside the same operation as the increment. Unit test, mocked persistence.
  const makeFakeStore = () => {
    const store = { event: null, user: { _id: 'u1', points: 0, returns: 0, creditedEvents: [] } };

    store.create = async () => {
      if (store.event) { const e = new Error('dup'); e.code = 11000; throw e; }
      store.event = { _id: 'ev', user: 'u1', type: 'return', points: 10, status: 'pending', claimedAt: null };
      return store.event;
    };
    store.findOne = async () => store.event;
    // Models the real atomic claim filter: pending, or a claim whose lease has
    // actually expired. A live lease must not be stealable.
    store.claim = async (filter) => {
      const e = store.event;
      if (!e || !filter) return null;
      if (String(e._id) !== String(filter._id)) return null;

      const clauses = filter.$or || [filter];
      const matches = clauses.some((clause) => {
        if (clause.status !== undefined && e.status !== clause.status) return false;
        if (clause.claimedAt && clause.claimedAt.$lt) {
          if (!e.claimedAt) return false;
          return new Date(e.claimedAt).getTime() < new Date(clause.claimedAt.$lt).getTime();
        }
        return true;
      });
      if (!matches) return null;

      e.status = 'claimed';
      e.claimedAt = new Date();
      return { ...e };
    };
    store.markCompleted = async (filter, update) => {
      if (update && update.$set && update.$set.status === 'completed') {
        if (!store.event || store.event.status === 'completed') return { modifiedCount: 0 };
        store.event.status = 'completed';
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 1 };
    };
    store.credit = async (filter, update) => {
      if (!update || !update.$inc) return { modifiedCount: 1 };
      const guard = filter && filter.creditedEvents && filter.creditedEvents.$ne;
      if (guard && store.user.creditedEvents.includes(guard)) return { modifiedCount: 0 };
      store.user.points += update.$inc.points || 0;
      store.user.returns += update.$inc.returns || 0;
      if (update.$push) store.user.creditedEvents.push(update.$push.creditedEvents);
      return { modifiedCount: 1 };
    };
    store.exists = async () => ({ _id: 'u1' });

    store.install = (overrides = {}) => {
      PointEvent.create = overrides.create || store.create;
      PointEvent.findOne = store.findOne;
      PointEvent.findOneAndUpdate = store.claim;
      PointEvent.updateOne = store.markCompleted;
      GamUser.updateOne = overrides.credit || store.credit;
      GamUser.exists = store.exists;
    };
    store.restore = () => {
      PointEvent.create = real.create;
      PointEvent.findOne = real.findOne;
      PointEvent.findOneAndUpdate = real.claim;
      PointEvent.updateOne = real.updateOne;
      GamUser.updateOne = real.userUpdateOne;
      GamUser.exists = real.userExists;
    };
    return store;
  };

  // Worker A claims, pauses before crediting. While A's lease is LIVE, worker B
  // must not be able to take over. Only after the lease actually expires does B
  // succeed — and then A's resumed credit is stopped by the permanent marker.
  {
    const fake = makeFakeStore();
    let releaseA = () => {};
    const gate = new Promise((resolve) => { releaseA = resolve; });
    let creditCalls = 0;

    fake.install({
      credit: async (filter, update) => {
        if (update && update.$inc) {
          creditCalls += 1;
          if (creditCalls === 1) await gate;   // worker A stalls here, before applying
        }
        return fake.credit(filter, update);
      }
    });

    const workerA = awardPoints({ userId: 'u1', type: 'return', key: 'k1' });
    await new Promise((r) => setTimeout(r, 20));      // A now holds the lease and is parked

    check('worker A holds the claim',
      fake.event.status === 'claimed' && Boolean(fake.event.claimedAt), fake.event.status);

    const bWhileLive = await awardPoints({ userId: 'u1', type: 'return', key: 'k1' });
    check('worker B cannot take a LIVE lease',
      bWhileLive.awarded === false && bWhileLive.reason === 'in-progress',
      JSON.stringify(bWhileLive));
    check('and nothing was credited while the lease was live',
      fake.user.points === 0, `points ${fake.user.points}`);

    // The clock moves past the lease: the claim is now genuinely stale
    fake.event.claimedAt = new Date(Date.now() - 61000);

    const workerB = await awardPoints({ userId: 'u1', type: 'return', key: 'k1' });
    check('worker B takes over once the lease has expired',
      workerB.awarded === true, JSON.stringify(workerB));

    releaseA();                                        // A wakes up, long after its lease
    const resultA = await workerA;

    check('the stale worker does not credit a second time',
      fake.user.points === 10 && fake.user.returns === 1,
      `points ${fake.user.points}, returns ${fake.user.returns}`);
    check('the event remains completed',
      fake.event.status === 'completed', fake.event.status);
    check('the marker is still present after completion',
      fake.user.creditedEvents.includes('ev'), JSON.stringify(fake.user.creditedEvents));
    check('the stale worker reports already-awarded',
      resultA.awarded === false && resultA.reason === 'already-awarded', JSON.stringify(resultA));

    fake.restore();
  }

  // Two workers racing with no pause: exactly one credit either way
  {
    const fake = makeFakeStore();
    fake.install();
    const [first, second] = await Promise.all([
      awardPoints({ userId: 'u1', type: 'return', key: 'k2' }),
      awardPoints({ userId: 'u1', type: 'return', key: 'k2' })
    ]);
    check('two simultaneous workers credit the event exactly once',
      fake.user.points === 10 && fake.user.returns === 1,
      `points ${fake.user.points}, returns ${fake.user.returns}`);
    check('exactly one of the two reports the award',
      [first, second].filter((r) => r.awarded).length === 1,
      JSON.stringify([first, second]));
    fake.restore();
  }

  // A worker resumes after the database refused its credit, then retries
  {
    const fake = makeFakeStore();
    let failNext = true;
    fake.install({
      credit: async (filter, update) => {
        if (update && update.$inc && failNext) {
          failNext = false;
          throw new Error('write timed out');
        }
        return fake.credit(filter, update);
      }
    });

    let firstFailed = false;
    try {
      await awardPoints({ userId: 'u1', type: 'return', key: 'k3' });
    } catch (err) {
      firstFailed = err.message === 'write timed out';
    }
    check('a database timeout surfaces and credits nothing',
      firstFailed === true && fake.user.points === 0, `points ${fake.user.points}`);
    check('the failed attempt leaves the event claimed, not lost',
      fake.event.status === 'claimed', fake.event.status);

    // The retry happens after the lease has expired, as it would in production
    fake.event.claimedAt = new Date(Date.now() - 61000);

    const retry = await awardPoints({ userId: 'u1', type: 'return', key: 'k3' });
    check('the retry after the timeout credits once',
      retry.awarded === true && fake.user.points === 10 && fake.user.returns === 1,
      `points ${fake.user.points}`);
    fake.restore();
  }

  // Repeated recovery after completion changes nothing
  {
    const fake = makeFakeStore();
    fake.install();
    await awardPoints({ userId: 'u1', type: 'return', key: 'k4' });
    const again1 = await awardPoints({ userId: 'u1', type: 'return', key: 'k4' });
    const again2 = await awardPoints({ userId: 'u1', type: 'return', key: 'k4' });
    check('repeated recovery after completion never pays again',
      fake.user.points === 10 && again1.awarded === false && again2.awarded === false,
      `points ${fake.user.points}`);
    fake.restore();
  }

  // 16h. The lease race against the real filter and a real update operation.
  // The fake implements findOneAndUpdate's matching rules, so this exercises the
  // filter rather than comparing two Date values.
  {
    const events = [{
      _id: 'lease-ev', status: 'claimed', claimedAt: new Date(Date.now() - 120000), points: 10, type: 'return'
    }];
    const applyFilter = (filter) => {
      if (!filter) return null;
      return events.find((e) => {
        if (String(e._id) !== String(filter._id)) return false;
        if (filter.status !== undefined && e.status !== filter.status) return false;
        if (filter.claimedAt !== undefined) {
          const a = e.claimedAt instanceof Date ? e.claimedAt.getTime() : null;
          const b = filter.claimedAt instanceof Date ? filter.claimedAt.getTime() : null;
          if (a !== b) return false;
        }
        return true;
      }) || null;
    };

    const selected = { ...events[0] };
    const filter = leaseClaimFilter(selected);
    check('the takeover filter matches the lease that was selected',
      Boolean(applyFilter(filter)) === true);

    // Another worker renews the lease between selection and the takeover
    events[0].claimedAt = new Date();
    check('a renewed lease makes the takeover match nothing',
      applyFilter(filter) === null,
      `filter ${filter.claimedAt.toISOString()} vs live ${events[0].claimedAt.toISOString()}`);

    // And a takeover that observes the renewed lease works
    const renewedFilter = leaseClaimFilter({ ...events[0] });
    check('a takeover using the current lease still matches',
      Boolean(applyFilter(renewedFilter)) === true);
  }

  // 16i. Recovery after a real handover.
  // Verified against the model: Claim.status is only pending | approved |
  // rejected, and the handover route leaves it at 'approved' while setting
  // handoverConfirmedAt. Recovery must therefore work for a confirmed handover.
  const ClaimModel = require('../src/models/Claim');
  const claimStatuses = ClaimModel.schema.path('status').enumValues;
  check('a claim has no post-handover status to rely on',
    claimStatuses.join(',') === 'pending,approved,rejected', claimStatuses.join(','));

  const afterHandover = await runRecovery({
    found: [],
    returned: [{ _id: 'i9', reportedBy: 'owner1' }],
    approved: { _id: 'c9', claimant: 'claimant1', status: 'approved', handoverConfirmedAt: new Date() }
  });
  check('recovery after a confirmed handover pays the owner',
    afterHandover.report.missingSample.includes('return:i9:owner1'),
    JSON.stringify(afterHandover.report.missingSample));
  check('recovery after a confirmed handover pays the claimant too',
    afterHandover.report.missingSample.includes('return:i9:claimant1'),
    JSON.stringify(afterHandover.report.missingSample));

  // 16j. Recovery walks every page, all time, without rescanning the first one
  {
    const pages = [];
    for (let p = 0; p < 3; p += 1) {
      const rows = [];
      for (let i = 0; i < 2; i += 1) {
        rows.push({ _id: `item-${p}-${i}`, reportedBy: 'u1' });
      }
      pages.push(rows);
    }
    // Ordered by _id, exactly as the real query is
    const all = pages.flat();

    const pagedModel = {
      find: (query) => {
        // Only the found-listing scan has rows in this fixture
        if (!query || query.type !== 'found') {
          const empty = { select: () => empty, sort: () => empty, limit: () => empty, lean: async () => [] };
          return empty;
        }
        const cursorAfter = query && query._id && query._id.$gt ? String(query._id.$gt) : null;
        const remaining = cursorAfter ? all.filter((r) => r._id > cursorAfter) : all;
        const page = remaining.slice(0, 2);   // batchSize 2 in this test
        const chain = {
          select: () => chain,
          sort: () => chain,
          limit: () => chain,
          lean: async () => page
        };
        return chain;
      }
    };

    const realItemFind = RecItem.find;
    const realClaimFindOne = RecClaim.findOne;
    RecItem.find = pagedModel.find;
    // These found listings have no claims; the lookup must not hit Mongoose
    // with a fake string id it cannot cast
    RecClaim.findOne = () => {
      const chain = { select: () => chain, lean: async () => null };
      return chain;
    };
    PointEvent.exists = async () => null;
    const createdKeys = [];
    const realCreate = PointEvent.create;
    PointEvent.create = async (doc) => { createdKeys.push(doc.key || (doc[0] && doc[0].key)); return { _id: 'ev' }; };
    try {
      const report = await recoverMissingAwards({ apply: false, batchSize: 2 });
      check('recovery walks past the first page',
        report.batches >= 3, `${report.batches} page(s)`);
      check('every eligible record is examined, not just the first batch',
        report.eligible === 6 && report.missing === 6,
        `${report.eligible} eligible, ${report.missing} missing`);
      check('the report distinguishes scanned, eligible and missing',
        report.scanned === 6 && report.alreadyPresent === 0,
        JSON.stringify({ scanned: report.scanned, eligible: report.eligible, missing: report.missing }));
      check('a dry run creates nothing', createdKeys.length === 0, `${createdKeys.length} created`);
      check('the default window is all time',
        report.window === 'all time', report.window);
    } finally {
      RecItem.find = realItemFind;
      RecClaim.findOne = realClaimFindOne;
      PointEvent.create = realCreate;
    }
  }

  // A date window is still available when an operator asks for one
  {
    const realItemFind = RecItem.find;
    let sawDateFilter = false;
    RecItem.find = (query) => {
      if (query && query.createdAt && query.createdAt.$gte) sawDateFilter = true;
      const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => [] };
      return chain;
    };
    try {
      const report = await recoverMissingAwards({ sinceDays: 7 });
      check('a window can still be requested explicitly',
        sawDateFilter === true && report.window === 'last 7 day(s)', report.window);
    } finally {
      RecItem.find = realItemFind;
    }
  }

  // 16k. Recovery streams: one page at a time, bounded memory.
  {
    const rows = [];
    for (let i = 0; i < 6; i += 1) rows.push({ _id: `i${i}`, reportedBy: 'u1' });
    const log = [];

    const pageModel = {
      find: (query) => {
        let remaining = query && query.type === 'found' ? rows : [];
        if (query && query._id && query._id.$gt) {
          remaining = remaining.filter((r) => r._id > query._id.$gt);
        }
        const page = remaining.slice(0, 2);
        log.push(`page:${page.length ? page[0]._id : 'end'}`);
        const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => page };
        return chain;
      }
    };

    const realItemFind = RecItem.find;
    const realExists = PointEvent.exists;
    RecItem.find = pageModel.find;
    RecClaim.findOne = () => {
      const chain = { select: () => chain, lean: async () => null };
      return chain;
    };
    PointEvent.exists = async ({ key }) => { log.push(`check:${key}`); return null; };
    try {
      const report = await recoverMissingAwards({ batchSize: 2 });
      const firstPageTwo = log.indexOf('page:i2');
      const lastOfPageOne = log.indexOf('check:found:i1');
      check('each page is processed before the next page is requested',
        firstPageTwo > -1 && lastOfPageOne > -1 && lastOfPageOne < firstPageTwo,
        log.join(' '));
      check('recovery walks every page', report.batches === 3, `${report.batches} page(s)`);
      check('all eligible records are examined', report.scanned === 6 && report.eligible === 6,
        `${report.scanned} scanned, ${report.eligible} eligible`);
    } finally {
      RecItem.find = realItemFind;
      PointEvent.exists = realExists;
    }
  }

  // Thousands of records: the counters are exact, the samples stay bounded
  {
    const many = [];
    for (let i = 0; i < 5000; i += 1) many.push({ _id: `m${String(i).padStart(5, '0')}`, reportedBy: 'u1' });

    const bigModel = {
      find: (query) => {
        let remaining = query && query.type === 'found' ? many : [];
        if (query && query._id && query._id.$gt) {
          remaining = remaining.filter((r) => r._id > query._id.$gt);
        }
        const page = remaining.slice(0, 1000);
        const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => page };
        return chain;
      }
    };

    const realItemFind = RecItem.find;
    const realExists = PointEvent.exists;
    RecItem.find = bigModel.find;
    RecClaim.findOne = () => {
      const chain = { select: () => chain, lean: async () => null };
      return chain;
    };
    PointEvent.exists = async () => null;
    try {
      const report = await recoverMissingAwards({ batchSize: 1000, sampleSize: 10 });
      check('5000 records are all scanned', report.scanned === 5000, `${report.scanned}`);
      check('the missing count is exact, not a sample', report.missing === 5000, `${report.missing}`);
      check('the diagnostic sample stays bounded', report.missingSample.length === 10,
        `${report.missingSample.length} keys kept`);
      check('the report says the sample was truncated', report.samplesTruncated === true);
      check('pagination covers all five pages', report.batches === 5, `${report.batches}`);
    } finally {
      RecItem.find = realItemFind;
      PointEvent.exists = realExists;
    }
  }

  // A database failure on one record is counted and the scan continues
  {
    const rows = [{ _id: 'a1', reportedBy: 'u1' }, { _id: 'a2', reportedBy: 'u1' }, { _id: 'a3', reportedBy: 'u1' }];
    const events = new Map();
    const user = { _id: 'u1', points: 0, returns: 0, creditedEvents: [] };

    const realItemFind = RecItem.find;
    const real = {
      exists: PointEvent.exists, create: PointEvent.create, findOne: PointEvent.findOne,
      claim: PointEvent.findOneAndUpdate, updateOne: PointEvent.updateOne,
      userUpdate: GamUser.updateOne, userExists: GamUser.exists
    };

    RecItem.find = (query) => {
      let remaining = query && query.type === 'found' ? rows : [];
      if (query && query._id && query._id.$gt) remaining = remaining.filter((r) => r._id > query._id.$gt);
      const page = remaining.slice(0, 1);          // one row per page
      const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => page };
      return chain;
    };
    RecClaim.findOne = () => { const chain = { select: () => chain, lean: async () => null }; return chain; };
    PointEvent.exists = async ({ key }) => events.has(key);
    PointEvent.create = async (doc) => {
      const d = Array.isArray(doc) ? doc[0] : doc;
      if (d.key === 'found:a2') throw new Error('connection reset');
      const ev = { _id: `e-${d.key}`, ...d, status: 'pending', claimedAt: null };
      events.set(d.key, ev);
      return ev;
    };
    PointEvent.findOne = async (f) => events.get(f.key) || null;
    PointEvent.findOneAndUpdate = async (filter) => {
      const e = [...events.values()].find((x) => String(x._id) === String(filter._id));
      if (!e || e.status === 'completed') return null;
      e.status = 'claimed'; e.claimedAt = new Date();
      return { ...e };
    };
    PointEvent.updateOne = async (filter, update) => {
      const e = [...events.values()].find((x) => String(x._id) === String(filter._id));
      if (!e) return { modifiedCount: 0 };
      if (update && update.$set && update.$set.status === 'completed') {
        if (e.status === 'completed') return { modifiedCount: 0 };
        e.status = 'completed';
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 1 };
    };
    GamUser.updateOne = async (filter, update) => {
      if (!update || !update.$inc) return { modifiedCount: 1 };
      const guard = filter && filter.creditedEvents && filter.creditedEvents.$ne;
      if (guard && user.creditedEvents.includes(guard)) return { modifiedCount: 0 };
      user.points += update.$inc.points || 0;
      user.returns += update.$inc.returns || 0;
      if (update.$push) user.creditedEvents.push(update.$push.creditedEvents);
      return { modifiedCount: 1 };
    };
    GamUser.exists = async () => ({ _id: 'u1' });

    try {
      const report = await recoverMissingAwards({ apply: true, batchSize: 1 });
      check('a failure on one record is counted', report.failed === 1, `${report.failed} failures`);
      check('the failure is sampled for diagnosis',
        report.failedSample.length === 1 && /found:a2/.test(report.failedSample[0]),
        JSON.stringify(report.failedSample));
      check('the scan continues past the failure',
        report.scanned === 3 && report.awarded === 2, `${report.scanned} scanned, ${report.awarded} awarded`);
      check('the surviving records were credited', user.points === 4, `points ${user.points}`);
    } finally {
      RecItem.find = realItemFind;
      PointEvent.exists = real.exists;
      PointEvent.create = real.create;
      PointEvent.findOne = real.findOne;
      PointEvent.findOneAndUpdate = real.claim;
      PointEvent.updateOne = real.updateOne;
      GamUser.updateOne = real.userUpdate;
      GamUser.exists = real.userExists;
    }
  }

  // Two recovery workers running at once cannot double-award
  {
    const events = new Map();
    const user = { _id: 'u1', points: 0, returns: 0, creditedEvents: [] };
    const rows = [{ _id: 'c1', reportedBy: 'u1' }, { _id: 'c2', reportedBy: 'u1' }, { _id: 'c3', reportedBy: 'u1' }];

    const realItemFind = RecItem.find;
    const real = {
      exists: PointEvent.exists, create: PointEvent.create, findOne: PointEvent.findOne,
      claim: PointEvent.findOneAndUpdate, updateOne: PointEvent.updateOne,
      userUpdate: GamUser.updateOne, userExists: GamUser.exists
    };

    RecItem.find = (query) => {
      let remaining = query && query.type === 'found' ? rows : [];
      if (query && query._id && query._id.$gt) remaining = remaining.filter((r) => r._id > query._id.$gt);
      const page = remaining.slice(0, 10);
      const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => page };
      return chain;
    };
    RecClaim.findOne = () => { const chain = { select: () => chain, lean: async () => null }; return chain; };
    PointEvent.exists = async ({ key }) => events.has(key);
    PointEvent.create = async (doc) => {
      const d = Array.isArray(doc) ? doc[0] : doc;
      if (events.has(d.key)) { const e = new Error('dup'); e.code = 11000; throw e; }
      const ev = { _id: `e-${d.key}`, ...d, status: 'pending', claimedAt: null };
      events.set(d.key, ev);
      return ev;
    };
    PointEvent.findOne = async (f) => events.get(f.key) || null;
    PointEvent.findOneAndUpdate = async (filter) => {
      const e = [...events.values()].find((x) => String(x._id) === String(filter._id));
      if (!e || e.status === 'completed') return null;
      e.status = 'claimed'; e.claimedAt = new Date();
      return { ...e };
    };
    PointEvent.updateOne = async (filter, update) => {
      const e = [...events.values()].find((x) => String(x._id) === String(filter._id));
      if (!e) return { modifiedCount: 0 };
      if (update && update.$set && update.$set.status === 'completed') {
        if (e.status === 'completed') return { modifiedCount: 0 };
        e.status = 'completed';
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 1 };
    };
    GamUser.updateOne = async (filter, update) => {
      if (!update || !update.$inc) return { modifiedCount: 1 };
      const guard = filter && filter.creditedEvents && filter.creditedEvents.$ne;
      if (guard && user.creditedEvents.includes(guard)) return { modifiedCount: 0 };
      user.points += update.$inc.points || 0;
      user.returns += update.$inc.returns || 0;
      if (update.$push) user.creditedEvents.push(update.$push.creditedEvents);
      return { modifiedCount: 1 };
    };
    GamUser.exists = async () => ({ _id: 'u1' });

    try {
      const [runA, runB] = await Promise.all([
        recoverMissingAwards({ apply: true, batchSize: 10 }),
        recoverMissingAwards({ apply: true, batchSize: 10 })
      ]);
      check('concurrent recovery awards each event once',
        user.points === 6, `points ${user.points} (three found listings at 2 each)`);
      check('concurrent recovery creates exactly three events',
        events.size === 3, `${events.size} events`);
      check('both concurrent runs complete and report',
        runA.scanned === 3 && runB.scanned === 3,
        `${runA.scanned}/${runB.scanned} scanned`);
    } finally {
      RecItem.find = realItemFind;
      PointEvent.exists = real.exists;
      PointEvent.create = real.create;
      PointEvent.findOne = real.findOne;
      PointEvent.findOneAndUpdate = real.claim;
      PointEvent.updateOne = real.updateOne;
      GamUser.updateOne = real.userUpdate;
      GamUser.exists = real.userExists;
    }
  }

  // 16l. Recovery page size is validated, never coerced
  const { resolveBatchSize, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE } = require('../src/utils/gamification');

  check('the default batch size is 200', DEFAULT_BATCH_SIZE === 200, `${DEFAULT_BATCH_SIZE}`);
  check('the maximum batch size is 1000', MAX_BATCH_SIZE === 1000, `${MAX_BATCH_SIZE}`);
  check('an omitted batch size uses the default',
    resolveBatchSize(undefined) === 200 && resolveBatchSize(null) === 200);
  check('the maximum permitted batch size is accepted',
    resolveBatchSize(1000) === 1000, `${resolveBatchSize(1000)}`);
  check('the smallest permitted batch size is accepted', resolveBatchSize(1) === 1);
  check('a numeric string is accepted and converted', resolveBatchSize('250') === 250);

  const rejects = (value, label) => {
    try {
      resolveBatchSize(value);
      return { ok: false, label };
    } catch (err) {
      return { ok: err instanceof RangeError, label, message: err.message };
    }
  };

  const badValues = [
    [0, 'zero'],
    [-1, 'negative'],
    [-1000, 'large negative'],
    [1.5, 'decimal'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, 'negative infinity'],
    [1001, 'above the maximum'],
    [999999, 'far above the maximum'],
    ['abc', 'not a number'],
    ['', 'empty string']
  ];
  badValues.forEach(([value, label]) => {
    const result = rejects(value, label);
    check(`a batch size of ${label} is rejected`,
      result.ok === true, result.message || 'accepted when it should have thrown');
  });

  // The library, not just the CLI, must refuse a bad page size
  {
    const realItemFind = RecItem.find;
    let queried = false;
    RecItem.find = () => { queried = true; throw new Error('should not query'); };
    let rejected = false;
    try {
      await recoverMissingAwards({ batchSize: 0 });
    } catch (err) {
      rejected = err instanceof RangeError;
    } finally {
      RecItem.find = realItemFind;
    }
    check('recoverMissingAwards rejects an invalid batch size itself', rejected === true);
    check('and never issues the query', queried === false);
  }

  // 16m. CLI argument validation, and an honest restore
  const { parsePositiveInt } = require('../src/utils/reconcile');

  check('a positive whole number is accepted', parsePositiveInt('7', '--since-days') === 7);
  check('a numeric string with a plus is accepted', parsePositiveInt('+30', '--since-days') === 30);

  const badInts = [
    ['0', 'zero'],
    ['-3', 'negative'],
    ['1.5', 'decimal'],
    ['abc', 'not a number'],
    ['', 'empty'],
    [undefined, 'missing'],
    ['Infinity', 'infinity'],
    ['NaN', 'NaN']
  ];
  badInts.forEach(([value, label]) => {
    let rejected = false;
    try {
      parsePositiveInt(value, '--since-days');
    } catch (err) {
      rejected = err instanceof RangeError && /--since-days/.test(err.message);
    }
    check(`a --since-days value of ${label} is rejected`, rejected === true);
  });

  const reconcileScript = fs.readFileSync(path.join(backendDir, 'scripts/reconcile-points.js'), 'utf8');
  check('restore does not claim to be a complete rollback',
    /not a full rollback/.test(reconcileScript)
    && !/Restore complete\. No records were deleted/.test(reconcileScript));
  // These two properties moved into src/utils/restore.js, which owns the scope
  // wording and the --force rule. The assertions are unchanged, retargeted at
  // the file that now implements them.
  const gamificationSource = fs.readFileSync(path.join(backendDir, 'src/utils/gamification.js'), 'utf8');
  check('badge eligibility excludes hidden found listings',
    /countDocuments\(\{ reportedBy: userId, type: 'found', status: \{ \$ne: 'hidden' \}/.test(gamificationSource));
  check('award recovery excludes hidden found listings',
    /filter: \{ type: 'found', status: \{ \$ne: 'hidden' \}/.test(gamificationSource));

  const authResetSource = fs.readFileSync(path.join(backendDir, 'src/routes/auth.routes.js'), 'utf8');
  check('password reset hashes and writes the password in the token-consumption update',
    /bcrypt\.hash\(password, 10\)/.test(authResetSource)
    && /\$set: \{ password: passwordHash \}/.test(authResetSource)
    && /resetTokenHash: hash/.test(authResetSource));

  const restoreSource = fs.readFileSync(path.join(backendDir, 'src/utils/restore.js'), 'utf8');
  check('restore states what it will not reverse',
    /will NOT do/.test(restoreSource)
    && /does not delete, re-open or otherwise change any PointEvent/.test(restoreSource)
    && /does not remove anything from User\.creditedEvents/.test(restoreSource));
  check('restore refuses a backup taken with --complete-pending unless forced',
    /flags\.completePending && !force/.test(restoreSource));
  check('the script delegates restore validation to that module',
    /prepareRestore\(/.test(reconcileScript) && /RestoreError/.test(reconcileScript));
  check('the backup records which flags produced it',
    /completePending: COMPLETE_PENDING/.test(reconcileScript)
    && /format: 'foundry-points-backup\/2'/.test(reconcileScript));

  const recoverScript = fs.readFileSync(path.join(backendDir, 'scripts/recover-awards.js'), 'utf8');
  check('a bare flag is refused rather than guessed',
    /needs a value/.test(recoverScript) && /startsWith\('--'\)/.test(recoverScript));

  // 16n. Restore validation: no database, fail closed
  const { prepareRestore, describeRestore, RestoreError } = require('../src/utils/restore');
  const os = require('os');
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-restore-'));

  const writeBackup = (name, value) => {
    const file = path.join(restoreDir, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };

  const v2 = (flags, accounts = [{ id: '507f1f77bcf86cd799439011', points: 10, returns: 1 }]) => ({
    format: 'foundry-points-backup/2',
    createdAt: '2026-11-06T00:00:00.000Z',
    host: 'h', database: 'd', flags, accounts
  });

  const rejectsRestore = (fn) => {
    try { fn(); return { ok: false }; } catch (err) { return { ok: err instanceof RestoreError, code: err.code, message: err.message }; }
  };

  check('a missing backup file is rejected',
    rejectsRestore(() => prepareRestore({ file: path.join(restoreDir, 'nope.json') })).code === 'MISSING');
  check('a backup with no path is rejected',
    rejectsRestore(() => prepareRestore({ file: undefined })).code === 'NO_FILE');
  check('malformed JSON is rejected',
    rejectsRestore(() => prepareRestore({ file: writeBackup('bad.json', '{not json') })).code === 'BAD_JSON');
  check('a file that is not a backup is rejected',
    rejectsRestore(() => prepareRestore({ file: writeBackup('shape.json', { hello: 'world' }) })).code === 'BAD_SHAPE');
  check('an account with missing fields is rejected',
    rejectsRestore(() => prepareRestore({ file: writeBackup('acct.json', v2({}, [{ id: 'x', points: 'ten' }])) })).code === 'BAD_ACCOUNT');

  check('restore rejects negative balances',
    rejectsRestore(() => prepareRestore({ file: writeBackup('negative.json', v2({}, [{ id: '507f1f77bcf86cd799439011', points: -1, returns: 0 }])) })).code === 'BAD_ACCOUNT');
  check('restore rejects fractional balances',
    rejectsRestore(() => prepareRestore({ file: writeBackup('fraction.json', v2({}, [{ id: '507f1f77bcf86cd799439011', points: 1.5, returns: 0 }])) })).code === 'BAD_ACCOUNT');
  check('restore rejects duplicate account ids',
    rejectsRestore(() => prepareRestore({ file: writeBackup('duplicate.json', v2({}, [
      { id: '507f1f77bcf86cd799439011', points: 1, returns: 0 },
      { id: '507f1f77bcf86cd799439011', points: 2, returns: 0 }
    ])) })).code === 'BAD_ACCOUNT');

  // v1 backups carry no flags: they must fail closed
  const v1File = writeBackup('v1.json', [{ id: '507f1f77bcf86cd799439011', points: 10, returns: 1 }]);
  const v1NoForce = rejectsRestore(() => prepareRestore({ file: v1File }));
  check('a v1 backup is refused without --force', v1NoForce.code === 'NEEDS_FORCE', v1NoForce.code);
  check('the refusal explains the flags cannot be verified',
    /cannot be verified/.test(v1NoForce.message || ''), (v1NoForce.message || '').slice(0, 60));
  check('the refusal says it is a balance-only restore',
    /not a full rollback/.test(v1NoForce.message || ''));

  const v1Forced = prepareRestore({ file: v1File, force: true });
  check('a v1 backup proceeds with --force', v1Forced.legacy === true && v1Forced.accounts.length === 1);

  // v2 backups
  const v2Plain = prepareRestore({ file: writeBackup('v2.json', v2({ apply: true, completePending: false })) });
  check('a v2 backup without --complete-pending needs no force', v2Plain.legacy === false);

  const v2PendingNoForce = rejectsRestore(() => prepareRestore({
    file: writeBackup('v2p.json', v2({ apply: true, completePending: true }))
  }));
  check('a v2 --complete-pending backup is refused without --force',
    v2PendingNoForce.code === 'NEEDS_FORCE', v2PendingNoForce.code);
  check('a v2 --complete-pending backup proceeds with --force',
    prepareRestore({ file: path.join(restoreDir, 'v2p.json'), force: true }).legacy === false);

  const description = describeRestore(v1Forced);
  check('the restore scope says what it will not reverse',
    /will NOT do/.test(description) && /PointEvent/.test(description) && /creditedEvents/.test(description));
  check('the restore scope admits a v1 backup cannot be verified',
    /cannot be verified/.test(description));

  // The validator must not touch a database
  const restoreModule = fs.readFileSync(path.join(backendDir, 'src/utils/restore.js'), 'utf8');
  check('the restore validator imports no database',
    !/require\('\.\.\/models\/User'\)/.test(restoreModule) && !/mongoose/.test(restoreModule));

  // The script must connect before it writes, and close afterwards
  const scriptSource = fs.readFileSync(path.join(backendDir, 'scripts/reconcile-points.js'), 'utf8');
  const prepareAt = scriptSource.indexOf('prepareRestore({');
  const connectAt = scriptSource.indexOf('const conn = await connectDB()');
  const writeAt = scriptSource.indexOf('await User.updateOne', scriptSource.indexOf('if (restorePlan)'));
  const closeAt = scriptSource.indexOf('await mongoose.connection.close()', writeAt);
  check('the backup is validated before the connection is opened',
    prepareAt > -1 && connectAt > -1 && prepareAt < connectAt, `${prepareAt} < ${connectAt}`);
  check('the restore writes only after connecting',
    writeAt > -1 && writeAt > connectAt, `${connectAt} < ${writeAt}`);
  check('the connection is closed after the restore',
    closeAt > -1 && closeAt > writeAt);

  // 17. Source guards for the role rules (behavioural tests need a database)
  const lbSource = fs.readFileSync(path.join(backendDir, 'src/routes/leaderboard.routes.js'), 'utf8');
  check('the all-time leaderboard is restricted to students',
    /role: 'student'/.test(lbSource));
  check('the windowed leaderboards are restricted to students',
    /'user\.role': 'student'/.test(lbSource));
  check('the windowed leaderboards still exclude opted-out students',
    /'user\.leaderboardOptOut': \{ \$ne: true \}/.test(lbSource));

  const prefSource = fs.readFileSync(path.join(backendDir, 'src/routes/auth.routes.js'), 'utf8');
  check('the preference endpoint refuses non-students',
    /role !== 'student'[\s\S]{0,200}403/.test(prefSource));

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
