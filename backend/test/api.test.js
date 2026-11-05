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
const Item = require('../src/models/Item');
const Claim = require('../src/models/Claim');
const Notification = require('../src/models/Notification');

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
      .send({ name: 'Test Student', email: 'test@scds.saiuniversity.edu.in', password: 'secret123' });
    check('POST /api/auth/register returns 201', reg.status === 201, `got ${reg.status}`);
    check('register response contains a token', !!reg.body.token);

    const dupe = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Student', email: 'test@scds.saiuniversity.edu.in', password: 'secret123' });
    check('duplicate email returns 400', dupe.status === 400, `got ${dupe.status}`);

    const badReg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: '123' });
    check('invalid registration input returns 400', badReg.status === 400, `got ${badReg.status}`);

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@scds.saiuniversity.edu.in', password: 'wrongpass' });
    check('wrong password returns 401', badLogin.status === 401, `got ${badLogin.status}`);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@scds.saiuniversity.edu.in', password: 'secret123' });
    check('POST /api/auth/login returns 200', login.status === 200, `got ${login.status}`);

    const token = login.body.token;
    const auth = { Authorization: `Bearer ${token}` };

    // Second user, who will be the "other" party for permission tests
    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other Student', email: 'other@scds.saiuniversity.edu.in', password: 'secret123' });
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
    const relogin = await request(app).post('/api/auth/login').send({ email: 'test@scds.saiuniversity.edu.in', password: 'secret123' });
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

    // ---------- 6b. Claim conflict: one approval per listing ----------
    // A third student claims the same item. Approving both must be impossible,
    // and the second attempt must be refused rather than overwriting the first.
    const third = await request(app).post('/api/auth/register')
      .send({ name: 'Third Student', email: 'third@scds.saiuniversity.edu.in', password: 'secret123' });
    const thirdAuth = { Authorization: `Bearer ${third.body.token}` };

    const foundItem = await request(app).post('/api/items').set(auth).send({
      title: 'Conflict Test Earbuds',
      description: 'Used to prove only one claim can be approved.',
      category: 'Electronics',
      subcategory: 'Earphones',
      location: 'Library',
      date: new Date().toISOString(),
      type: 'found'
    });
    const conflictItemId = foundItem.body.item.id;

    const claimB = await request(app).post('/api/claims').set(thirdAuth)
      .send({ itemId: conflictItemId, message: 'I lost these on Tuesday.' });
    const claimC = await request(app).post('/api/claims').set(auth2)
      .send({ itemId: conflictItemId, message: 'They are mine, dented case.' });
    check('two different students can claim the same listing',
      claimB.status === 201 && claimC.status === 201, `${claimB.status}/${claimC.status}`);

    const approveFirst = await request(app).patch(`/api/claims/${claimB.body.claim.id}`)
      .set(auth).send({ status: 'approved' });
    check('the first approval succeeds', approveFirst.status === 200, `got ${approveFirst.status}`);
    check('approving one claim rejects the siblings',
      approveFirst.body.rejectedSiblings === 1, `got ${approveFirst.body.rejectedSiblings}`);

    const siblingAfter = await Claim.findById(claimC.body.claim.id);
    check('the sibling claim is now rejected', siblingAfter.status === 'rejected', siblingAfter.status);
    check('the sibling carries the required note',
      siblingAfter.reviewNote === 'Another claim was approved for this listing.', siblingAfter.reviewNote);

    const approveSecond = await request(app).patch(`/api/claims/${claimC.body.claim.id}`)
      .set(auth).send({ status: 'approved' });
    check('a second approval on the same listing is refused (409)',
      approveSecond.status === 409, `got ${approveSecond.status}`);

    const itemAfter = await Item.findById(conflictItemId);
    check('the listing is claimed exactly once', itemAfter.status === 'claimed', itemAfter.status);

    // Notifications must go to the right party: the sibling claimant hears a
    // rejection that names their own claim, and the approved claimant never
    // receives a rejection.
    const siblingUser = await User.findOne({ email: 'other@scds.saiuniversity.edu.in' });
    const approvedUser = await User.findOne({ email: 'third@scds.saiuniversity.edu.in' });
    const siblingNotes = await Notification.find({ user: siblingUser._id });
    const approvedNotes = await Notification.find({ user: approvedUser._id });

    check('the sibling claimant (claimC) was notified',
      siblingNotes.length > 0, `${siblingNotes.length} notifications`);

    check('the sibling notification is a rejection',
      siblingNotes.some((n) => n.type === 'claim_rejected'),
      siblingNotes.map((n) => n.type).join(','));

    check('the rejection points at the sibling claim, not another one',
      siblingNotes.some((n) => n.type === 'claim_rejected'
        && String(n.relatedId) === String(claimC.body.claim.id)),
      siblingNotes.filter((n) => n.type === 'claim_rejected').map((n) => String(n.relatedId)).join(','));

    check('the approved claimant (claimB) got an approval and no rejection',
      approvedNotes.some((n) => n.type === 'claim_approved')
      && !approvedNotes.some((n) => n.type === 'claim_rejected'),
      approvedNotes.map((n) => n.type).join(','));

    // ---------- 7. Housekeeping ----------
    const health = await request(app).get('/api/health');
    check('GET /api/health returns 200', health.status === 200, `got ${health.status}`);

    const unknown = await request(app).get('/api/does-not-exist');
    check('unknown route returns JSON 404', unknown.status === 404 && !!unknown.body.message, `got ${unknown.status}`);

    const ready = await request(app).get('/api/health/ready');
    check('readiness is 200 while the database is connected',
      ready.status === 200 && ready.body.db.ok === true, `got ${ready.status}`);

    const meta = await request(app).get('/api/items/meta');
    check('GET /api/items/meta returns categories', meta.status === 200 && meta.body.categories.length > 0);

    // ---------- 7. Stage 1 / E1: a hidden listing is not public ----------
    const hiddenCreate = await request(app).post('/api/items').set(auth2).send({
      title: 'Taken Down Item',
      description: 'A listing a moderator will hide.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const hiddenId = hiddenCreate.body.item && hiddenCreate.body.item.id;
    check('E1 setup: the listing to be hidden was created', !!hiddenId);

    // A moderator hides it through the admin surface; here we set the field
    // directly so this suite does not depend on the admin routes
    await Item.updateOne({ _id: hiddenId }, { $set: { status: 'hidden' } });

    const publicList = await request(app).get('/api/items?limit=100');
    check('E1: a hidden listing is absent from the public list',
      publicList.status === 200 && !publicList.body.items.some((i) => i.id === hiddenId),
      `found ${publicList.body.items.filter((i) => i.id === hiddenId).length}`);

    const statusHidden = await request(app).get('/api/items?status=hidden');
    check('E1: the public list refuses status=hidden (400)',
      statusHidden.status === 400, `got ${statusHidden.status}`);

    const anonDetail = await request(app).get(`/api/items/${hiddenId}`);
    check('E1: a hidden listing is 404 to an anonymous visitor',
      anonDetail.status === 404, `got ${anonDetail.status}`);

    const anonSimilar = await request(app).get(`/api/items/${hiddenId}/similar`);
    check('E1: the duplicate-alert route also refuses a hidden listing',
      anonSimilar.status === 404, `got ${anonSimilar.status}`);

    const ownerDetail = await request(app).get(`/api/items/${hiddenId}`).set(auth2);
    check('E1: the owner can still open their own hidden listing',
      ownerDetail.status === 200, `got ${ownerDetail.status}`);

    // ---------- 8. Stage 1 / E2: admin AND superadmin may moderate ----------
    const staff = await request(app).post('/api/auth/register').send({
      name: 'Staff Member', email: 'staff@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const authStaff = { Authorization: `Bearer ${staff.body.token}` };
    const staffId = staff.body.user && staff.body.user.id;

    const mod = await request(app).post('/api/auth/register').send({
      name: 'Mod Member', email: 'mod@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const authMod = { Authorization: `Bearer ${mod.body.token}` };

    // promote in the database: protect() reloads the user on every request, so
    // the existing token immediately carries the new role
    await User.updateOne({ _id: staffId }, { $set: { role: 'superadmin' } });
    await User.updateOne({ _id: mod.body.user.id }, { $set: { role: 'moderator' } });

    const modDetail = await request(app).get(`/api/items/${hiddenId}`).set(authMod);
    check('E2: a moderator can open a hidden listing', modDetail.status === 200, `got ${modDetail.status}`);

    const adminCreate = await request(app).post('/api/items').set(auth).send({
      title: 'Superadmin Edit Target',
      description: 'A listing another account will moderate.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'lost'
    });
    const adminItemId = adminCreate.body.item && adminCreate.body.item.id;

    const superEdit = await request(app).put(`/api/items/${adminItemId}`).set(authStaff)
      .send({ title: 'Edited by a superadmin' });
    check('E2: a superadmin can edit someone else\'s listing',
      superEdit.status === 200, `got ${superEdit.status}`);

    const superStatus = await request(app).patch(`/api/items/${adminItemId}/status`).set(authStaff)
      .send({ status: 'claimed' });
    check('E2: a superadmin can change the status of someone else\'s listing',
      superStatus.status === 200, `got ${superStatus.status}`);

    const modEdit = await request(app).put(`/api/items/${adminItemId}`).set(authMod)
      .send({ title: 'Edited by a moderator' });
    check('E2: a moderator still cannot edit someone else\'s listing (403)',
      modEdit.status === 403, `got ${modEdit.status}`);

    const studentEdit = await request(app).put(`/api/items/${adminItemId}`).set(auth2)
      .send({ title: 'Edited by a student' });
    check('E2: a student still cannot edit someone else\'s listing (403)',
      studentEdit.status === 403, `got ${studentEdit.status}`);

    // ---------- 9. Stage 1 / E3: status is only changed by its own endpoint ----------
    const editWithStatus = await request(app).put(`/api/items/${adminItemId}`).set(auth)
      .send({ title: 'Renamed', status: 'returned' });
    check('E3: an edit that carries a status is refused (400)',
      editWithStatus.status === 400, `got ${editWithStatus.status}`);

    const afterEdit = await Item.findById(adminItemId);
    check('E3: the refused edit changed nothing',
      afterEdit.title === 'Edited by a superadmin' && afterEdit.status === 'claimed',
      `${afterEdit.title} / ${afterEdit.status}`);

    const ownerReturn = await request(app).patch(`/api/items/${adminItemId}/status`).set(auth)
      .send({ status: 'returned' });
    check('E3: the dedicated status endpoint still works (200)',
      ownerReturn.status === 200 && ownerReturn.body.item.status === 'returned',
      `got ${ownerReturn.status}`);

    const ownerUnhide = await request(app).patch(`/api/items/${hiddenId}/status`).set(auth2)
      .send({ status: 'open' });
    check('E1: an owner cannot un-hide their own listing (403)',
      ownerUnhide.status === 403, `got ${ownerUnhide.status}`);

    const staffUnhide = await request(app).patch(`/api/items/${hiddenId}/status`).set(authStaff)
      .send({ status: 'open' });
    check('E1: staff can restore a hidden listing (200)',
      staffUnhide.status === 200, `got ${staffUnhide.status}`);

    const superDelete = await request(app).delete(`/api/items/${adminItemId}`).set(authStaff);
    check('E2: a superadmin can delete someone else\'s listing',
      superDelete.status === 200, `got ${superDelete.status}`);

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
