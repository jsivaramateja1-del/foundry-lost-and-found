/**
 * Automated API tests.
 * Uses an in-memory MongoDB so nothing touches your real database.
 * Run with:  npm test
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';

const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../src/app');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

let passed = 0;
let failed = 0;
const results = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed++;
    results.push(`  PASS  ${name}`);
  } else {
    failed++;
    results.push(`  FAIL  ${name} ${detail}`);
  }
};

(async () => {
  // Use MONGO_URI if you already have MongoDB running locally, otherwise
  // start a throwaway in-memory database. Nothing touches your real data.
  let mongod = null;
  let uri = process.env.MONGO_URI;
  if (!uri) {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  } else {
    console.log(`Using MongoDB at ${uri}`);
  }
  await connectDB(uri);

  try {
    // ---------- 1. Authentication ----------
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Student', email: 'test@sai.edu', password: 'secret123' });
    check('POST /api/auth/register returns 201', reg.status === 201, `got ${reg.status}`);
    check('register response contains a token', !!reg.body.token);

    const dupe = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Student', email: 'test@sai.edu', password: 'secret123' });
    check('duplicate email returns 400', dupe.status === 400, `got ${dupe.status}`);

    const badReg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: '123' });
    check('invalid registration input returns 400', badReg.status === 400, `got ${badReg.status}`);

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@sai.edu', password: 'wrongpass' });
    check('wrong password returns 401', badLogin.status === 401, `got ${badLogin.status}`);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@sai.edu', password: 'secret123' });
    check('POST /api/auth/login returns 200', login.status === 200, `got ${login.status}`);

    const token = login.body.token;
    const auth = { Authorization: `Bearer ${token}` };

    // Second user, who will be the "other" party for permission tests
    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other Student', email: 'other@sai.edu', password: 'secret123' });
    const token2 = reg2.body.token;
    const auth2 = { Authorization: `Bearer ${token2}` };

    const me = await request(app).get('/api/auth/me').set(auth);
    check('GET /api/auth/me returns 200 with token', me.status === 200, `got ${me.status}`);
    check('me does not leak the password hash', me.body.user && me.body.user.password === undefined);

    const noToken = await request(app).get('/api/auth/me');
    check('GET /api/auth/me without token returns 401', noToken.status === 401, `got ${noToken.status}`);

    // ---------- 2. Items: create + validation ----------
    const noAuthCreate = await request(app)
      .post('/api/items')
      .send({ title: 'X', description: 'Y', category: 'Bags', location: 'Library', date: new Date(), type: 'lost' });
    check('POST /api/items without token returns 401', noAuthCreate.status === 401, `got ${noAuthCreate.status}`);

    const badItem = await request(app).post('/api/items').set(auth).send({ title: 'Only a title' });
    check('POST /api/items with missing fields returns 400', badItem.status === 400, `got ${badItem.status}`);

    const badCategory = await request(app).post('/api/items').set(auth).send({
      title: 'Thing', description: 'Desc', category: 'Spaceships',
      location: 'Library', date: new Date().toISOString(), type: 'lost'
    });
    check('POST /api/items with invalid category returns 400', badCategory.status === 400, `got ${badCategory.status}`);

    const otherNoName = await request(app).post('/api/items').set(auth).send({
      title: 'Thing', description: 'Desc', category: 'Other',
      location: 'Library', date: new Date().toISOString(), type: 'lost'
    });
    check('category Other without customCategory returns 400', otherNoName.status === 400, `got ${otherNoName.status}`);

    const create = await request(app).post('/api/items').set(auth).send({
      title: 'Blue Water Bottle',
      description: 'A blue steel bottle with a dented base.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    check('POST /api/items returns 201', create.status === 201, `got ${create.status}`);
    const itemId = create.body.item && create.body.item.id;
    check('created item has an id', !!itemId);

    // ---------- 3. Items: read, search, filter ----------
    await request(app).post('/api/items').set(auth2).send({
      title: 'Lost Blue Bottle',
      description: 'I lost a blue steel bottle near the canteen.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'lost'
    });

    const list = await request(app).get('/api/items');
    check('GET /api/items returns 200', list.status === 200, `got ${list.status}`);
    check('listing count is correct', list.body.total === 2, `got ${list.body.total}`);

    const search = await request(app).get('/api/items?q=bottle');
    check('keyword search returns matching items', search.body.total === 2, `got ${search.body.total}`);

    const noMatch = await request(app).get('/api/items?q=zzzznothing');
    check('search with no match returns an empty list', noMatch.body.total === 0, `got ${noMatch.body.total}`);

    const filterType = await request(app).get('/api/items?type=found');
    check('filter by type=found returns only found items',
      filterType.body.items.every((i) => i.type === 'found'), JSON.stringify(filterType.body.items.map((i) => i.type)));

    const filterBoth = await request(app).get('/api/items?type=lost&category=Bottles&location=Canteen');
    check('combined filters return the right item', filterBoth.body.total === 1, `got ${filterBoth.body.total}`);

    const sortOldest = await request(app).get('/api/items?sort=oldest');
    check('sort=oldest returns 200', sortOldest.status === 200);

    const detail = await request(app).get(`/api/items/${itemId}`);
    check('GET /api/items/:id returns 200', detail.status === 200, `got ${detail.status}`);
    check('item detail does not leak reporter email',
      detail.body.item.reportedBy && detail.body.item.reportedBy.email === undefined);

    const badId = await request(app).get('/api/items/not-a-valid-id');
    check('invalid item id returns 400', badId.status === 400, `got ${badId.status}`);

    const missing = await request(app).get('/api/items/64d2f1f1f1f1f1f1f1f1f1f1');
    check('missing item returns 404', missing.status === 404, `got ${missing.status}`);

    const similar = await request(app).get(`/api/items/${itemId}/similar`);
    check('GET /api/items/:id/similar returns matches', similar.status === 200 && similar.body.count >= 1,
      `status ${similar.status} count ${similar.body.count}`);

    // ---------- 4. Update + authorization ----------
    const otherUpdate = await request(app).put(`/api/items/${itemId}`).set(auth2).send({ title: 'Hijacked' });
    check('updating someone else\'s item returns 403', otherUpdate.status === 403, `got ${otherUpdate.status}`);

    const ownerUpdate = await request(app).put(`/api/items/${itemId}`).set(auth).send({ title: 'Blue Steel Bottle' });
    check('owner can update their item (200)', ownerUpdate.status === 200, `got ${ownerUpdate.status}`);

    // ---------- 5. Claims ----------
    const selfClaim = await request(app).post('/api/claims').set(auth).send({ itemId, message: 'Mine' });
    check('claiming your own item returns 400', selfClaim.status === 400, `got ${selfClaim.status}`);

    const claim = await request(app).post('/api/claims').set(auth2).send({
      itemId, message: 'This is mine, it has a dent on the base.'
    });
    check('POST /api/claims returns 201', claim.status === 201, `got ${claim.status}`);
    const claimId = claim.body.claim && claim.body.claim.id;

    const dupeClaim = await request(app).post('/api/claims').set(auth2).send({
      itemId, message: 'Trying again'
    });
    check('duplicate claim returns 409', dupeClaim.status === 409, `got ${dupeClaim.status}`);

    const claimNoAuth = await request(app).post('/api/claims').send({ itemId, message: 'x' });
    check('claim without token returns 401', claimNoAuth.status === 401, `got ${claimNoAuth.status}`);

    const claimsMine = await request(app).get('/api/claims/mine').set(auth2);
    check('GET /api/claims/mine returns 200', claimsMine.status === 200, `got ${claimsMine.status}`);

    const claimsOnItem = await request(app).get(`/api/claims/item/${itemId}`).set(auth);
    check('item owner can view claims on it', claimsOnItem.body.count === 1, `got ${claimsOnItem.body.count}`);

    const claimsForbidden = await request(app).get(`/api/claims/item/${itemId}`).set(auth2);
    check('non-owner cannot view claims on the item', claimsForbidden.status === 403, `got ${claimsForbidden.status}`);

    const approveForbidden = await request(app).patch(`/api/claims/${claimId}`).set(auth2).send({ status: 'approved' });
    check('claimant cannot approve their own claim (403)', approveForbidden.status === 403, `got ${approveForbidden.status}`);

    const approve = await request(app).patch(`/api/claims/${claimId}`).set(auth).send({ status: 'approved' });
    check('item owner can approve a claim (200)', approve.status === 200, `got ${approve.status}`);

    const afterApprove = await request(app).get(`/api/items/${itemId}`);
    check('approving a claim moves the item to claimed', afterApprove.body.item.status === 'claimed',
      `got ${afterApprove.body.item.status}`);

    // ---------- 6. Dashboards ----------
    const dash = await request(app).get('/api/dashboard/me').set(auth);
    check('GET /api/dashboard/me returns 200', dash.status === 200, `got ${dash.status}`);
    check('dashboard counts the user\'s listings', dash.body.stats.listings === 1, `got ${dash.body.stats.listings}`);

    const studentStats = await request(app).get('/api/admin/stats').set(auth);
    check('student cannot read admin stats (403)', studentStats.status === 403, `got ${studentStats.status}`);

    await User.findByIdAndUpdate(login.body.user.id, { role: 'admin' });
    const relogin = await request(app).post('/api/auth/login').send({ email: 'test@sai.edu', password: 'secret123' });
    const adminAuth = { Authorization: `Bearer ${relogin.body.token}` };

    const adminStats = await request(app).get('/api/admin/stats').set(adminAuth);
    check('admin can read /api/admin/stats', adminStats.status === 200, `got ${adminStats.status}`);
    check('admin stats include chart groupings',
      Array.isArray(adminStats.body.byCategory) && Array.isArray(adminStats.body.perDay));

    const adminItems = await request(app).get('/api/admin/items').set(adminAuth);
    check('admin can list all items', adminItems.status === 200 && adminItems.body.count === 2, `got ${adminItems.body.count}`);

    const adminClaims = await request(app).get('/api/admin/claims').set(adminAuth);
    check('admin can list all claims', adminClaims.status === 200 && adminClaims.body.count === 1, `got ${adminClaims.body.count}`);

    const markReturned = await request(app).patch(`/api/items/${itemId}/status`).set(auth).send({ status: 'returned' });
    check('owner can mark an item returned', markReturned.status === 200, `got ${markReturned.status}`);

    const board = await request(app).get('/api/leaderboard');
    check('GET /api/leaderboard returns 200', board.status === 200, `got ${board.status}`);

    // ---------- 7. Housekeeping ----------
    const health = await request(app).get('/api/health');
    check('GET /api/health returns 200', health.status === 200, `got ${health.status}`);

    const unknown = await request(app).get('/api/does-not-exist');
    check('unknown route returns JSON 404', unknown.status === 404 && !!unknown.body.message, `got ${unknown.status}`);

    const meta = await request(app).get('/api/items/meta');
    check('GET /api/items/meta returns categories', meta.status === 200 && meta.body.categories.length > 0);

    const delOther = await request(app).delete(`/api/items/${itemId}`).set(auth2);
    check('non-owner cannot delete an item (403)', delOther.status === 403, `got ${delOther.status}`);

    const delOwner = await request(app).delete(`/api/items/${itemId}`).set(auth);
    check('owner can delete their item (200)', delOwner.status === 200, `got ${delOwner.status}`);
  } catch (err) {
    failed++;
    results.push(`  FAIL  unexpected error: ${err.message}`);
    console.error(err);
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);

  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
})();
