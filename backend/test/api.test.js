/**
 * Automated API tests.
 * Uses an in-memory MongoDB so nothing touches your real database.
 * Run with:  npm test
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';

// Higher limits for automated tests only.
process.env.RATE_LIMIT_ITEMS_IP_MAX = '1000';
process.env.RATE_LIMIT_ITEMS_MAX = '1000';
process.env.RATE_LIMIT_CLAIMS_IP_MAX = '1000';
process.env.RATE_LIMIT_CLAIMS_MAX = '1000';
process.env.RATE_LIMIT_REPORTS_IP_MAX = '1000';
process.env.RATE_LIMIT_REPORTS_MAX = '1000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../src/app');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Item = require('../src/models/Item');
const Claim = require('../src/models/Claim');
const Notification = require('../src/models/Notification');
const PointEvent = require('../src/models/PointEvent');
const mailer = require('../src/utils/mailer');

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

    await User.findByIdAndUpdate(login.body.user.id, { role: 'student' });

    const markReturned = await request(app).patch(`/api/items/${itemId}/status`).set(auth).send({ status: 'returned' });
    check('owner cannot manually mark an item returned', markReturned.status === 400, `got ${markReturned.status}`);

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

    // ---------- 6c. Compensation after partial approval failure ----------
    const rollbackItem = await request(app).post('/api/items').set(auth).send({
      title: 'Approval Rollback Item',
      description: 'Used to test compensation after sibling update failure.',
      category: 'Electronics',
      subcategory: 'Earphones',
      location: 'Library',
      date: new Date().toISOString(),
      type: 'found'
    });
    const rollbackItemId = rollbackItem.body.item.id;
    const rollbackClaim = await request(app).post('/api/claims').set(auth2)
      .send({ itemId: rollbackItemId, message: 'I lost this item.' });
    const rollbackSibling = await request(app).post('/api/claims').set(thirdAuth)
      .send({ itemId: rollbackItemId, message: 'This belongs to me.' });

    const realClaimUpdateMany = Claim.updateMany;
    let failSiblingUpdate = true;
    Claim.updateMany = function (...args) {
      if (failSiblingUpdate) {
        failSiblingUpdate = false;
        return Promise.reject(new Error('simulated sibling update failure'));
      }
      return realClaimUpdateMany.apply(this, args);
    };
    let failedApproval;
    try {
      failedApproval = await request(app).patch(`/api/claims/${rollbackClaim.body.claim.id}`)
        .set(auth).send({ status: 'approved' });
    } finally {
      Claim.updateMany = realClaimUpdateMany;
    }

    const rollbackItemAfter = await Item.findById(rollbackItemId);
    const rollbackClaimAfter = await Claim.findById(rollbackClaim.body.claim.id);
    const rollbackSiblingAfter = await Claim.findById(rollbackSibling.body.claim.id);
    check('APPROVAL ROLLBACK: injected sibling update failure is reported',
      failedApproval.status === 500, `got ${failedApproval.status}`);
    check('APPROVAL ROLLBACK: item is reopened after claims are restored',
      rollbackItemAfter.status === 'open', rollbackItemAfter.status);
    check('APPROVAL ROLLBACK: winning claim returns to pending',
      rollbackClaimAfter.status === 'pending', rollbackClaimAfter.status);
    check('APPROVAL ROLLBACK: sibling claim returns to pending',
      rollbackSiblingAfter.status === 'pending', rollbackSiblingAfter.status);

    // ---------- 6d. Compensation after a failed handover item transition ----------
    const handoverRollbackItem = await request(app).post('/api/items').set(auth).send({
      title: 'Handover Rollback Item',
      description: 'Used to test compensation when the item update fails.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const handoverRollbackItemId = handoverRollbackItem.body.item.id;
    const handoverRollbackClaim = await request(app).post('/api/claims').set(auth2)
      .send({ itemId: handoverRollbackItemId, message: 'This is mine.' });
    const handoverRollbackClaimId = handoverRollbackClaim.body.claim.id;
    const handoverRollbackApproval = await request(app).patch(`/api/claims/${handoverRollbackClaimId}`)
      .set(auth).send({ status: 'approved' });
    check('HANDOVER ROLLBACK: test claim is approved',
      handoverRollbackApproval.status === 200, `got ${handoverRollbackApproval.status}`);

    const realItemFindOneAndUpdate = Item.findOneAndUpdate;
    let failReturnedTransition = true;
    Item.findOneAndUpdate = function (filter, update, ...args) {
      if (failReturnedTransition && filter && filter.status === 'claimed'
          && update && update.$set && update.$set.status === 'returned') {
        failReturnedTransition = false;
        return Promise.reject(new Error('simulated item return update failure'));
      }
      return realItemFindOneAndUpdate.call(this, filter, update, ...args);
    };
    let failedConsistencyHandover;
    try {
      failedConsistencyHandover = await request(app)
        .post(`/api/claims/${handoverRollbackClaimId}/handover`).set(auth).send({});
    } finally {
      Item.findOneAndUpdate = realItemFindOneAndUpdate;
    }

    const handoverItemAfterFailure = await Item.findById(handoverRollbackItemId);
    const handoverClaimAfterFailure = await Claim.findById(handoverRollbackClaimId);
    check('HANDOVER ROLLBACK: injected item update failure is reported',
      failedConsistencyHandover.status === 500, `got ${failedConsistencyHandover.status}`);
    check('HANDOVER ROLLBACK: item remains claimed after failed transition',
      handoverItemAfterFailure.status === 'claimed', handoverItemAfterFailure.status);
    check('HANDOVER ROLLBACK: claim confirmation is cleared after failed transition',
      !handoverClaimAfterFailure.handoverConfirmedAt && !handoverClaimAfterFailure.handoverConfirmedBy,
      String(handoverClaimAfterFailure.handoverConfirmedAt || 'no confirmation'));

    const retriedHandover = await request(app)
      .post(`/api/claims/${handoverRollbackClaimId}/handover`).set(auth).send({});
    const handoverItemAfterRetry = await Item.findById(handoverRollbackItemId);
    const handoverClaimAfterRetry = await Claim.findById(handoverRollbackClaimId);
    check('HANDOVER ROLLBACK: retry succeeds after compensation',
      retriedHandover.status === 200, `got ${retriedHandover.status}`);
    check('HANDOVER ROLLBACK: retry leaves item and claim consistently returned',
      handoverItemAfterRetry.status === 'returned' && Boolean(handoverClaimAfterRetry.handoverConfirmedAt),
      `${handoverItemAfterRetry.status} / ${handoverClaimAfterRetry.handoverConfirmedAt}`);


    // ---------- 6e. Recovery when both handover update and compensation fail ----------
    const strandedItem = await request(app).post('/api/items').set(auth).send({
      title: 'Stranded Handover Item',
      description: 'Tests recovery when compensation also fails.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const strandedItemId = strandedItem.body.item.id;
    const strandedClaim = await request(app).post('/api/claims').set(auth2)
      .send({ itemId: strandedItemId, message: 'This is mine.' });
    const strandedClaimId = strandedClaim.body.claim.id;
    const strandedApproval = await request(app).patch(`/api/claims/${strandedClaimId}`)
      .set(auth).send({ status: 'approved' });
    check('HANDOVER RECOVERY: test claim is approved',
      strandedApproval.status === 200, `got ${strandedApproval.status}`);

    const realStrandedItemUpdate = Item.findOneAndUpdate;
    const realClaimCollectionUpdate = Claim.collection.updateOne;
    let failStrandedItem = true;
    let failStrandedCleanup = true;

    Item.findOneAndUpdate = function (filter, update, ...args) {
      if (failStrandedItem && filter && filter.status === 'claimed'
          && update && update.$set && update.$set.status === 'returned') {
        failStrandedItem = false;
        return Promise.reject(new Error('simulated stranded item update failure'));
      }
      return realStrandedItemUpdate.call(this, filter, update, ...args);
    };
    Claim.collection.updateOne = function (filter, update, ...args) {
      if (failStrandedCleanup && update && update.$unset
          && update.$unset.handoverConfirmedAt !== undefined) {
        failStrandedCleanup = false;
        return Promise.reject(new Error('simulated confirmation cleanup failure'));
      }
      return realClaimCollectionUpdate.call(this, filter, update, ...args);
    };

    let strandedFailure;
    try {
      strandedFailure = await request(app)
        .post(`/api/claims/${strandedClaimId}/handover`).set(auth).send({});
    } finally {
      Item.findOneAndUpdate = realStrandedItemUpdate;
      Claim.collection.updateOne = realClaimCollectionUpdate;
    }

    const strandedItemAfterFailure = await Item.findById(strandedItemId);
    const strandedClaimAfterFailure = await Claim.findById(strandedClaimId);
    const originalHandoverAt = strandedClaimAfterFailure.handoverConfirmedAt;
    const originalHandoverBy = String(strandedClaimAfterFailure.handoverConfirmedBy || '');
    check('HANDOVER RECOVERY: both injected failures are reported',
      strandedFailure.status === 500 && !failStrandedItem && !failStrandedCleanup,
      `got ${strandedFailure.status}`);
    check('HANDOVER RECOVERY: item remains claimed after both failures',
      strandedItemAfterFailure.status === 'claimed', strandedItemAfterFailure.status);
    check('HANDOVER RECOVERY: stranded confirmation marker remains available',
      Boolean(originalHandoverAt && originalHandoverBy),
      `${originalHandoverAt || 'no timestamp'} / ${originalHandoverBy || 'no actor'}`);

    const strandedRetry = await request(app)
      .post(`/api/claims/${strandedClaimId}/handover`).set(auth).send({});
    const strandedItemAfterRetry = await Item.findById(strandedItemId);
    const strandedClaimAfterRetry = await Claim.findById(strandedClaimId);
    check('HANDOVER RECOVERY: retry resumes the stranded handover',
      strandedRetry.status === 200, `got ${strandedRetry.status}`);
    check('HANDOVER RECOVERY: retry preserves original confirmation details',
      strandedItemAfterRetry.status === 'returned'
      && String(strandedClaimAfterRetry.handoverConfirmedBy) === originalHandoverBy
      && new Date(strandedClaimAfterRetry.handoverConfirmedAt).getTime() === new Date(originalHandoverAt).getTime(),
      `${strandedItemAfterRetry.status} / ${strandedClaimAfterRetry.handoverConfirmedAt}`);

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
    check('E3: the owner status endpoint cannot bypass handover (400)',
      ownerReturn.status === 400,
      `got ${ownerReturn.status}`);
    const adminReturn = await request(app).patch("/api/admin/items/" + adminItemId + "/status").set(authStaff).send({ status: "returned" });
    check("E3: admin cannot bypass confirmed handover (400)", adminReturn.status === 400, "got " + adminReturn.status);

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

    // ---------- 10. Who may move a listing's status ----------
    // An 'admin' account, distinct from the superadmin and moderator above
    const adminUser = await request(app).post('/api/auth/register').send({
      name: 'Admin Member', email: 'admin2@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const authAdmin = { Authorization: `Bearer ${adminUser.body.token}` };
    await User.updateOne({ _id: adminUser.body.user.id }, { $set: { role: 'admin' } });
    // ---------- 10A. Account suspension permissions and lifecycle ----------
    const suspensionStudent = await request(app).post('/api/auth/register').send({
      name: 'Suspension Student',
      email: 'suspension-student@scds.saiuniversity.edu.in',
      password: 'secret123'
    });

    const suspensionStudentId = suspensionStudent.body.user && suspensionStudent.body.user.id;

    const suspendStudent = await request(app)
      .patch(`/api/admin/users/${suspensionStudentId}/suspend`)
      .set(authAdmin)
      .send({ suspended: true, reason: 'Test suspension', durationDays: 7 });

    const suspendedStudent = await User.findById(suspensionStudentId);

    check(
      'SUSPEND-1: an admin can temporarily suspend a student (200)',
      suspendStudent.status === 200 && suspendedStudent && suspendedStudent.suspended === true,
      `status ${suspendStudent.status}`
    );

    check(
      'SUSPEND-1: reason and expiry are saved',
      suspendedStudent &&
      suspendedStudent.suspendedReason === 'Test suspension' &&
      suspendedStudent.suspendedUntil instanceof Date &&
      suspendedStudent.suspendedUntil > new Date() &&
      suspendedStudent.suspendedUntil <= new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      suspendedStudent && `${suspendedStudent.suspendedReason} / ${suspendedStudent.suspendedUntil}`
    );

    const reinstateStudent = await request(app)
      .patch(`/api/admin/users/${suspensionStudentId}/suspend`)
      .set(authAdmin)
      .send({ suspended: false });

    const reinstatedStudent = await User.findById(suspensionStudentId);

    check(
      'SUSPEND-2: an admin can reinstate a suspended student (200)',
      reinstateStudent.status === 200 && reinstatedStudent && !reinstatedStudent.suspended,
      `status ${reinstateStudent.status}`
    );

    check(
      'SUSPEND-2: reinstatement clears suspension metadata',
      reinstatedStudent &&
      !reinstatedStudent.suspendedReason &&
      !reinstatedStudent.suspendedAt &&
      !reinstatedStudent.suspendedUntil
    );

    const selfSuspend = await request(app)
      .patch(`/api/admin/users/${adminUser.body.user.id}/suspend`)
      .set(authAdmin)
      .send({ suspended: true, reason: 'Self test' });

    check(
      'SUSPEND-3: an admin cannot suspend their own account (400)',
      selfSuspend.status === 400,
      `got ${selfSuspend.status}`
    );

    const secondAdmin = await request(app).post('/api/auth/register').send({
      name: 'Second Admin',
      email: 'suspension-admin@scds.saiuniversity.edu.in',
      password: 'secret123'
    });

    await User.updateOne(
      { _id: secondAdmin.body.user.id },
      { $set: { role: 'admin' } }
    );

    const adminSuspendAdmin = await request(app)
      .patch(`/api/admin/users/${secondAdmin.body.user.id}/suspend`)
      .set(authAdmin)
      .send({ suspended: true, reason: 'Role protection test' });

    check(
      'SUSPEND-4: an admin cannot suspend another admin (400)',
      adminSuspendAdmin.status === 400,
      `got ${adminSuspendAdmin.status}`
    );

    const suspensionSuperTarget = await request(app).post('/api/auth/register').send({
      name: 'Suspension Superadmin',
      email: 'suspension-superadmin@scds.saiuniversity.edu.in',
      password: 'secret123'
    });

    await User.updateOne(
      { _id: suspensionSuperTarget.body.user.id },
      { $set: { role: 'superadmin' } }
    );

    const adminSuspendSuper = await request(app)
      .patch(`/api/admin/users/${suspensionSuperTarget.body.user.id}/suspend`)
      .set(authAdmin)
      .send({ suspended: true, reason: 'Role protection test' });

    check(
      'SUSPEND-5: an admin cannot suspend a superadmin (400)',
      adminSuspendSuper.status === 400,
      `got ${adminSuspendSuper.status}`
    );

    const superSuspendAdmin = await request(app)
      .patch(`/api/admin/users/${secondAdmin.body.user.id}/suspend`)
      .set(authStaff)
      .send({ suspended: true, reason: 'Role protection test' });

    check(
      'SUSPEND-6: a superadmin cannot suspend an admin (400)',
      superSuspendAdmin.status === 400,
      `got ${superSuspendAdmin.status}`
    );


    // A hidden listing per attempt, because a successful restore changes it
    const hiddenItemFor = async (label) => {
      const created = await request(app).post('/api/items').set(auth).send({
        title: `Hidden For ${label}`,
        description: 'A listing hidden by a moderator for a restore test.',
        category: 'Bottles',
        location: 'Canteen',
        date: new Date().toISOString(),
        type: 'found'
      });
      const id = created.body.item && created.body.item.id;
      await Item.updateOne({ _id: id }, { $set: { status: 'hidden' } });
      return id;
    };

    // A moderator may restore another user's takedown
    const moderatorTarget = await hiddenItemFor('Moderator');
    const moderatorRestore = await request(app)
      .patch(`/api/items/${moderatorTarget}/status`).set(authMod).send({ status: 'open' });
    check('R1: a moderator can restore another user\'s hidden listing (200)',
      moderatorRestore.status === 200, `got ${moderatorRestore.status}`);
    check('R1: the listing really became open again',
      (await Item.findById(moderatorTarget)).status === 'open');

    // A plain student cannot
    const studentTarget = await hiddenItemFor('Student');
    const studentRestore = await request(app)
      .patch(`/api/items/${studentTarget}/status`).set(auth2).send({ status: 'open' });
    check('R2: a normal student cannot restore someone else\'s hidden listing (403)',
      studentRestore.status === 403, `got ${studentRestore.status}`);
    check('R2: the listing is still hidden',
      (await Item.findById(studentTarget)).status === 'hidden');

    // Neither can the owner
    const ownerTarget = await request(app).post('/api/items').set(auth2).send({
      title: 'Hidden For Owner',
      description: 'A listing hidden by a moderator for a restore test.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const ownerTargetId = ownerTarget.body.item.id;
    await Item.updateOne({ _id: ownerTargetId }, { $set: { status: 'hidden' } });

    const ownerRestore = await request(app)
      .patch(`/api/items/${ownerTargetId}/status`).set(auth2).send({ status: 'open' });

    check('R3: the owner cannot restore their own hidden listing (403)',
      ownerRestore.status === 403, `got ${ownerRestore.status}`);
    check('R3: the listing is still hidden',
      (await Item.findById(ownerTargetId)).status === 'hidden');

    // Administrators keep their full status power
    const adminTarget = await hiddenItemFor('Admin');
    const adminRestore = await request(app)
      .patch(`/api/items/${adminTarget}/status`).set(authAdmin).send({ status: 'open' });
    check('R4: an admin can restore a hidden listing (200)',
      adminRestore.status === 200, `got ${adminRestore.status}`);

    const superTarget = await hiddenItemFor('Superadmin');
    const superRestore = await request(app)
      .patch(`/api/items/${superTarget}/status`).set(authStaff).send({ status: 'open' });
    check('R5: a superadmin can restore a hidden listing (200)',
      superRestore.status === 200, `got ${superRestore.status}`);

    // A moderator has NO general power over someone else's visible listing
    const visibleTarget = await request(app).post('/api/items').set(auth).send({
      title: 'Visible Moderator Target',
      description: 'A visible listing a moderator must not be able to move.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'lost'
    });
    const visibleId = visibleTarget.body.item && visibleTarget.body.item.id;
    const moderatorOnVisible = await request(app)
      .patch(`/api/items/${visibleId}/status`).set(authMod).send({ status: 'claimed' });
    check('R6: a moderator cannot change another user\'s visible listing (403)',
      moderatorOnVisible.status === 403, `got ${moderatorOnVisible.status}`);
    check('R6: that listing is unchanged', (await Item.findById(visibleId)).status === 'open');

    // Restoring is the only move a moderator may make on a hidden listing
    const claimHiddenTarget = await hiddenItemFor('ClaimInstead');
    const moderatorClaimsHidden = await request(app)
      .patch(`/api/items/${claimHiddenTarget}/status`).set(authMod).send({ status: 'claimed' });
    check('R7: a moderator cannot mark a hidden listing claimed instead of restoring it (403)',
      moderatorClaimsHidden.status === 403, `got ${moderatorClaimsHidden.status}`);
    check('R7: the listing stays hidden',
      (await Item.findById(claimHiddenTarget)).status === 'hidden');

    // The owner keeps their normal power over their own visible listing
    const ownerOwnVisible = await request(app)
      .patch(`/api/items/${visibleId}/status`).set(auth).send({ status: 'claimed' });
    check('R8: the owner can still change their own visible listing (200)',
      ownerOwnVisible.status === 200, `got ${ownerOwnVisible.status}`);

    // A moderator cannot undo their own takedown — but another one can
    const modOwnItem = await request(app).post('/api/items').set(authMod).send({
      title: 'Moderator Own Hidden',
      description: 'A listing owned by a moderator and then hidden.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const modOwnId = modOwnItem.body.item && modOwnItem.body.item.id;
    await Item.updateOne({ _id: modOwnId }, { $set: { status: 'hidden' } });

    const modSelfRestore = await request(app)
      .patch(`/api/items/${modOwnId}/status`).set(authMod).send({ status: 'open' });
    check('R9: a moderator cannot restore their OWN hidden listing (403)',
      modSelfRestore.status === 403, `got ${modSelfRestore.status}`);
    check('R9: the listing stays hidden',
      (await Item.findById(modOwnId)).status === 'hidden');

    // A different moderator may restore it, which is the point of the rule
    const mod2 = await request(app).post('/api/auth/register').send({
      name: 'Second Moderator', email: 'mod2@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const authMod2 = { Authorization: `Bearer ${mod2.body.token}` };
    await User.updateOne({ _id: mod2.body.user.id }, { $set: { role: 'moderator' } });

    const otherModRestore = await request(app)
      .patch(`/api/items/${modOwnId}/status`).set(authMod2).send({ status: 'open' });
    check('R10: another moderator can restore it (200)',
      otherModRestore.status === 200, `got ${otherModRestore.status}`);
    check('R10: and it becomes open',
      (await Item.findById(modOwnId)).status === 'open');

    // ---------- 11. Discovery, statistics and leaderboard preferences ----------
    // A known returned listing and a known open one, so the filter cannot pass
    // by returning nothing
    const filterTarget = await request(app).post('/api/items').set(auth).send({
      title: 'Status Filter Target',
      description: 'A listing used to prove the status filter really filters.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const filterId = filterTarget.body.item && filterTarget.body.item.id;
    await Item.updateOne({ _id: filterId }, { $set: { status: 'returned' } });

    const statusReturned = await request(app).get('/api/items?status=returned');
    check('S1: the public status filter returns only that status',
      statusReturned.status === 200
      && statusReturned.body.items.every((i) => i.status === 'returned'),
      `got ${statusReturned.status} with ${statusReturned.body.items.length} items`);
    check('S1: the returned listing is in the result and an open one is not',
      statusReturned.body.items.some((i) => i.id === filterId)
      && !statusReturned.body.items.some((i) => i.status === 'open'),
      `${statusReturned.body.items.length} items`);

    const statusInvalid = await request(app).get('/api/items?status=invalid');
    check('S1: invalid status filter is rejected (400)',
      statusInvalid.status === 400,
      `got ${statusInvalid.status}`);

    const beforeStats = await request(app).get('/api/items/stats');
    const statsTarget = await request(app).post('/api/items').set(auth).send({
      title: 'Stats Hidden Target',
      description: 'A listing hidden to prove the counters ignore it.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'lost'
    });
    const statsId = statsTarget.body.item && statsTarget.body.item.id;
    const midStats = await request(app).get('/api/items/stats');
    check('S2: a new listing raises the public total by one',
      midStats.body.total === beforeStats.body.total + 1,
      `${beforeStats.body.total} -> ${midStats.body.total}`);

    await Item.updateOne({ _id: statsId }, { $set: { status: 'hidden' } });
    const afterStats = await request(app).get('/api/items/stats');
    check('S2: a hidden listing is not counted publicly',
      afterStats.body.total === beforeStats.body.total,
      `${afterStats.body.total} vs ${beforeStats.body.total}`);

    // Preferences: authentication, validation, and no privilege escalation
    const prefNoAuth = await request(app).patch('/api/auth/preferences').send({ leaderboardOptOut: true });
    check('S3: preferences require a token (401)', prefNoAuth.status === 401, `got ${prefNoAuth.status}`);

    const prefBadType = await request(app).patch('/api/auth/preferences').set(auth2)
      .send({ leaderboardOptOut: 'yes' });
    check('S3: a non-boolean preference is refused (400)', prefBadType.status === 400, `got ${prefBadType.status}`);

    const prefEscalate = await request(app).patch('/api/auth/preferences').set(auth2)
      .send({ leaderboardOptOut: true, points: 9999, role: 'superadmin' });
    check('S4: unexpected preference fields are rejected (400)', prefEscalate.status === 400, 'got ' + prefEscalate.status);

    const prefValid = await request(app).patch('/api/auth/preferences').set(auth2)
      .send({ leaderboardOptOut: true });
    check('S4: a valid leaderboard preference is saved',
      prefValid.status === 200 && prefValid.body.user.leaderboardOptOut === true,
      'got ' + prefValid.status);

    // Leaderboard: points are required to appear, and an opt-out hides the name
    await User.updateOne({ _id: reg2.body.user.id }, { $set: { points: 50, returns: 5, leaderboardOptOut: false } });
    const boardBefore = await request(app).get('/api/leaderboard');
    check('S5: a student with points appears on the leaderboard',
      boardBefore.body.leaderboard.some((r) => r.points === 50), JSON.stringify(boardBefore.body.leaderboard));

    await User.updateOne({ _id: reg2.body.user.id }, { $set: { leaderboardOptOut: true } });
    const boardAfter = await request(app).get('/api/leaderboard');
    check('S5: an opted-out student is left off the leaderboard',
      !boardAfter.body.leaderboard.some((r) => r.points === 50), JSON.stringify(boardAfter.body.leaderboard));
    check('S5: the leaderboard never exposes an email address',
      boardAfter.body.leaderboard.every((r) => r.email === undefined));

    // Restore the account so the remaining assertions see the original state
    await User.updateOne({ _id: reg2.body.user.id }, { $set: { leaderboardOptOut: false, points: 0, returns: 0 } });

    // ---------- 12. Password reset ----------
    const resetUser = await request(app).post('/api/auth/register').send({
      name: 'Reset Student', email: 'reset@scds.saiuniversity.edu.in', password: 'oldsecret123'
    });
    const resetAuth = { Authorization: `Bearer ${resetUser.body.token}` };

    const forgotUnknown = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'nobody@scds.saiuniversity.edu.in' });
    check('P1: forgot-password answers the same way for an unknown address',
      forgotUnknown.status === 200 && /If that address/.test(forgotUnknown.body.message),
      `${forgotUnknown.status} ${forgotUnknown.body && forgotUnknown.body.message}`);

    const forgotNoEmail = await request(app).post('/api/auth/forgot-password').send({});
    check('P2: forgot-password without an address returns 400',
      forgotNoEmail.status === 400, `got ${forgotNoEmail.status}`);

    const invalidForgot = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    check('P2a: invalid email format returns 400', invalidForgot.status === 400, 'got '+invalidForgot.status);

    const originalResetMailer = mailer.sendPasswordResetEmail;
    mailer.sendPasswordResetEmail = async () => { throw new Error('simulated SMTP failure'); };
    let failedMailResponse;
    try {
      failedMailResponse = await request(app).post('/api/auth/forgot-password').send({ email: 'reset@scds.saiuniversity.edu.in' });
    } finally {
      mailer.sendPasswordResetEmail = originalResetMailer;
    }
    const rawResetUser = await User.collection.findOne({ email: 'reset@scds.saiuniversity.edu.in' });
    check('P7: SMTP failure returns generic success without leaking mail details', failedMailResponse.status === 200 && !/SMTP|simulated/i.test(JSON.stringify(failedMailResponse.body)), JSON.stringify(failedMailResponse.body));
    check('P7: reset token is cleared when email delivery fails', !rawResetUser.resetTokenHash && !rawResetUser.resetTokenExpires, 'reset token fields remain');

    const bogusReset = await request(app).post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'newsecret123' });
    check('P3: a bogus reset token is refused (400)', bogusReset.status === 400, `got ${bogusReset.status}`);

    // Plant a known token exactly as the route would, so the flow can be tested
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { email: 'reset@scds.saiuniversity.edu.in' },
      {
        $set: {
          resetTokenHash: crypto.createHash('sha256').update(resetToken).digest('hex'),
          resetTokenExpires: new Date(Date.now() + 15 * 60 * 1000)
        }
      }
    );

    const doReset = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, password: 'newsecret123', confirmPassword: 'newsecret123' });
    check('P4: a valid token changes the password (200)', doReset.status === 200, `got ${doReset.status}`);

    const oldLogin = await request(app).post('/api/auth/login')
      .send({ email: 'reset@scds.saiuniversity.edu.in', password: 'oldsecret123' });
    check('P4: the old password no longer works (401)', oldLogin.status === 401, `got ${oldLogin.status}`);

    const newLogin = await request(app).post('/api/auth/login')
      .send({ email: 'reset@scds.saiuniversity.edu.in', password: 'newsecret123' });
    check('P4: the new password works (200)', newLogin.status === 200, `got ${newLogin.status}`);

    const reuse = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, password: 'another123', confirmPassword: 'another123' });
    check('P5: the same token cannot be used twice (400)', reuse.status === 400, `got ${reuse.status}`);

    const staleSession = await request(app).get('/api/auth/me').set(resetAuth);
    check('P6: sessions issued before the reset are rejected (401)',
      staleSession.status === 401, `got ${staleSession.status}`);

    // ---------- 13. Gamification ledger and badges ----------
    const pointsBefore = await User.findById(reg.body.user.id).then((u) => u.points);
    const foundListing = await request(app).post('/api/items').set(auth).send({
      title: 'Gamification Found Item',
      description: 'A found item created to prove the ledger pays once.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const foundId = foundListing.body.item && foundListing.body.item.id;
    const pointsAfterPosting = await User.findById(reg.body.user.id).then((u) => u.points);
    const eventsBeforeVerification = await PointEvent.countDocuments({ user: reg.body.user.id, key: 'found:' + foundId });
    check('G1: posting alone awards no points', pointsAfterPosting === pointsBefore && eventsBeforeVerification === 0, pointsBefore + ' -> ' + pointsAfterPosting + '; events: ' + eventsBeforeVerification);
    const studentVerify = await request(app).patch('/api/admin/items/' + foundId + '/verify').set(auth);
    check('G1: a student cannot verify a found listing', studentVerify.status === 403, 'status ' + studentVerify.status);
    const lostGuard = await request(app).post('/api/items').set(auth2).send({title:'Lost guard test',description:'Test',category:'Bags',location:'Library',date:new Date().toISOString(),type:'lost'});
    const lostGuardId = lostGuard.body.item && lostGuard.body.item.id;
    const lostGuardResult = await request(app).patch('/api/admin/items/' + lostGuardId + '/verify').set(authMod);
    check('G1: moderators cannot verify lost listings', !!lostGuardId && lostGuardResult.status === 400, 'status ' + lostGuardResult.status);
    const hiddenGuard = await request(app).post('/api/items').set(auth2).send({title:'Hidden guard test',description:'Test',category:'Bags',location:'Library',date:new Date().toISOString(),type:'found'});
    const hiddenGuardId = hiddenGuard.body.item && hiddenGuard.body.item.id;
    if(hiddenGuardId) await Item.updateOne({_id:hiddenGuardId},{$set:{status:'hidden'}});
    const hiddenGuardResult = await request(app).patch('/api/admin/items/' + hiddenGuardId + '/verify').set(authMod);
    check('G1: moderators cannot verify hidden found listings', !!hiddenGuardId && hiddenGuardResult.status === 400, 'status ' + hiddenGuardResult.status);

    const moderatorVerify = await request(app).patch('/api/admin/items/' + foundId + '/verify').set(authMod);
    check('G1: moderator verification succeeds', moderatorVerify.status === 200, 'status ' + moderatorVerify.status);
    const repeatVerify = await request(app).patch('/api/admin/items/' + foundId + '/verify').set(authMod);
    check('G1: repeated verification is idempotent', repeatVerify.status === 200 && repeatVerify.body.alreadyVerified === true, JSON.stringify(repeatVerify.body));
    const pointsAfter = await User.findById(reg.body.user.id).then((u) => u.points);
    check('G1: verified found item awards points exactly once', pointsAfter === pointsBefore + 2, pointsBefore + ' -> ' + pointsAfter);
    const eventCount = await PointEvent.countDocuments({ user: reg.body.user.id, key: 'found:' + foundId });
    check('G1: the award is recorded exactly once', eventCount === 1, eventCount + ' events');

    const dupeAward = await PointEvent.create({
      user: reg.body.user.id, type: 'found_item', points: 2, key: `found:${foundId}`
    }).then(() => false).catch((err) => err.code === 11000);
    check('G1: the unique index refuses a second award for the same event', dupeAward === true);

    const impactDash = await request(app).get('/api/dashboard/me').set(auth);
    check('G2: the dashboard reports the personal impact summary',
      impactDash.body.impact && typeof impactDash.body.impact.contributions === 'number'
      && impactDash.body.impact.points === pointsAfter,
      JSON.stringify(impactDash.body.impact));
    check('G2: the First Found Item badge is earned and dated',
      Array.isArray(impactDash.body.badges)
      && impactDash.body.badges.some((b) => b.id === 'first_found' && b.earned && b.earnedAt),
      JSON.stringify(impactDash.body.badges && impactDash.body.badges.map((b) => `${b.id}:${b.earned}`)));

    // ---------- 14. Leaderboard periods ----------
    const badPeriod = await request(app).get('/api/leaderboard?period=fortnight');
    check('L1: an unknown leaderboard period is refused (400)', badPeriod.status === 400, `got ${badPeriod.status}`);

    const weekBoard = await request(app).get('/api/leaderboard?period=week');
    check('L1: the weekly board answers with the period it used',
      weekBoard.status === 200 && weekBoard.body.period === 'week', `got ${weekBoard.status}`);
    check('L1: the board never exposes an email address',
      weekBoard.body.leaderboard.every((r) => r.email === undefined));

    // ---------- 15. The leaderboard is a student board ----------
    // One account per role, all with points, so the filter is the only thing
    // that can decide who appears.
    const roleAccounts = {};
    for (const role of ['faculty', 'moderator', 'admin', 'superadmin']) {
      const created = await request(app).post('/api/auth/register').send({
        name: `Board ${role}`,
        email: `board-${role}@scds.saiuniversity.edu.in`,
        password: 'secret123'
      });
      const id = created.body.user && created.body.user.id;
      await User.updateOne({ _id: id }, { $set: { role, points: 500, returns: 50 } });
      roleAccounts[role] = created.body.token;
    }
    // A dedicated account for ranking. Its balance is set directly on purpose,
    // so the shared student account keeps a balance that is fully explained by
    // the ledger for the consistency check further down.
    const boardStudent = await request(app).post('/api/auth/register').send({
      name: 'Board Student', email: 'board-student@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const boardStudentId = boardStudent.body.user && boardStudent.body.user.id;
    await User.updateOne({ _id: boardStudentId }, { $set: { points: 400, returns: 40 } });
    await PointEvent.create({ user: boardStudentId, type: 'found_item', points: 400, key: 'leaderboard-period-test:' + boardStudentId, status: 'completed' });

    for (const period of ['all', 'week', 'month']) {
      const board = await request(app).get(`/api/leaderboard?period=${period}`);
      const names = board.body.leaderboard.map((r) => r.name);
      check(`LB-${period}: the student appears on the ${period} board`,
        names.includes('Board Student'), names.join(','));
      check(`LB-${period}: no staff account appears on the ${period} board`,
        !['Board faculty', 'Board moderator', 'Board admin', 'Board superadmin'].some((staff) => names.includes(staff)), names.join(','));
    }

    // Opted out students stay off every period
    await User.updateOne({ _id: boardStudentId }, { $set: { leaderboardOptOut: true } });
    for (const period of ['all', 'week', 'month']) {
      const board = await request(app).get(`/api/leaderboard?period=${period}`);
      check(`LB-optout-${period}: an opted-out student is absent from the ${period} board`,
        !board.body.leaderboard.some((r) => r.name === 'Board Student'));
    }
    await User.updateOne({ _id: boardStudentId }, { $set: { leaderboardOptOut: false } });

    // ---------- 16. Only students may change the preference ----------
    for (const [role, token] of Object.entries(roleAccounts)) {
      const attempt = await request(app).patch('/api/auth/preferences')
        .set({ Authorization: `Bearer ${token}` })
        .send({ leaderboardOptOut: true });
      check(`PREF-${role}: a ${role} cannot change a leaderboard preference (403)`,
        attempt.status === 403, `got ${attempt.status}`);
    }

    const studentPref = await request(app).patch('/api/auth/preferences').set(auth)
      .send({ leaderboardOptOut: true });
    check('PREF-student: a student still can, and cannot escalate',
      studentPref.status === 200
      && studentPref.body.user.leaderboardOptOut === true
      && studentPref.body.user.role === 'student'
      && studentPref.body.user.points !== 9999,
      `role ${studentPref.body.user && studentPref.body.user.role}`);
    await User.updateOne({ _id: reg.body.user.id }, { $set: { leaderboardOptOut: false } });

    // ---------- 17. Concurrency ----------
    // Two simultaneous resets with one token: exactly one may win
    const raceUser = await request(app).post('/api/auth/register').send({
      name: 'Race Student', email: 'race@scds.saiuniversity.edu.in', password: 'oldsecret123'
    });
    const raceToken = require('crypto').randomBytes(32).toString('hex');
    await User.updateOne(
      { email: 'race@scds.saiuniversity.edu.in' },
      {
        $set: {
          resetTokenHash: require('crypto').createHash('sha256').update(raceToken).digest('hex'),
          resetTokenExpires: new Date(Date.now() + 15 * 60 * 1000)
        }
      }
    );
    const both = await Promise.all([
      request(app).post('/api/auth/reset-password').send({ token: raceToken, password: 'firstpass1' }),
      request(app).post('/api/auth/reset-password').send({ token: raceToken, password: 'secondpass2' })
    ]);
    const successes = both.filter((r) => r.status === 200).length;
    check('CONC-reset: exactly one of two simultaneous resets succeeds',
      successes === 1, both.map((r) => r.status).join(','));
    check('CONC-reset: the loser is told the link is spent',
      both.some((r) => r.status === 400));

    // Two simultaneous returns of one item must pay exactly once
    const raceItem = await request(app).post('/api/items').set(auth).send({
      title: 'Concurrency Return Target',
      description: 'A listing returned twice at once.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const raceItemId = raceItem.body.item && raceItem.body.item.id;
    const before = await User.findById(reg.body.user.id).then((u) => u.points);
    const returns = await Promise.all([
      request(app).patch(`/api/items/${raceItemId}/status`).set(auth).send({ status: 'returned' }),
      request(app).patch(`/api/items/${raceItemId}/status`).set(auth).send({ status: 'returned' })
    ]);
    const after = await User.findById(reg.body.user.id).then((u) => u.points);
    check('CONC-return: manual status changes do not award return points',
      after - before === 0 && returns.every((r) => r.status === 400), `${before} -> ${after} (${returns.map((r) => r.status).join(',')})`);

    // Ledger consistency is checked on an account whose balance was never set by
    // hand, so the ledger really is expected to explain it in full.
    const cleanUser = await request(app).post('/api/auth/register').send({
      name: 'Ledger Clean', email: 'ledger-clean@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const cleanAuth = { Authorization: `Bearer ${cleanUser.body.token}` };
    const cleanListing = await request(app).post('/api/items').set(cleanAuth).send({
      title: 'Clean Ledger Found Item',
      description: 'One found listing, so the ledger holds exactly one award.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const cleanItemId = cleanListing.body.item && cleanListing.body.item.id;
    const cleanVerify = await request(app).patch('/api/admin/items/' + cleanItemId + '/verify').set(authMod);
    check('CONSISTENCY: moderator verifies the clean found listing', cleanVerify.status === 200, 'status ' + cleanVerify.status);

    const cleanLedger = await PointEvent.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(cleanUser.body.user.id), status: 'completed' } },
      { $group: {
        _id: null,
        points: { $sum: '$points' },
        returns: { $sum: { $cond: [{ $eq: ['$type', 'return'] }, 1, 0] } }
      } }
    ]);
    const cleanPoints = cleanLedger.length ? cleanLedger[0].points : 0;
    const cleanReturns = cleanLedger.length ? cleanLedger[0].returns : 0;
    const cleanStored = await User.findById(cleanUser.body.user.id);
    check('CONSISTENCY: the ledger total equals the stored point total',
      cleanPoints === cleanStored.points, `ledger ${cleanPoints} vs stored ${cleanStored.points}`);
    check('CONSISTENCY: the ledger return count equals the stored return total',
      cleanReturns === cleanStored.returns, `ledger ${cleanReturns} vs stored ${cleanStored.returns}`);
    check('CONSISTENCY: one found listing is worth exactly its points',
      cleanStored.points === 2, `stored ${cleanStored.points}`);

    // ---------- 18. Hiding a listing must not move any public counter ----------
    const statsFields = ['total', 'lost', 'found', 'returned', 'claimed', 'open', 'active'];
    const snapshot = async () => (await request(app).get('/api/items/stats')).body;
    const baseline = await snapshot();

    const hideLost = await request(app).post('/api/items').set(auth).send({
      title: 'Stats Hidden Lost',
      description: 'A lost listing that will be hidden.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'lost'
    });
    const hideLostId = hideLost.body.item && hideLost.body.item.id;
    const verifyLost = await request(app).patch('/api/admin/items/' + hideLostId + '/verify').set(authMod);
    check('G1: a lost listing cannot be verified', verifyLost.status === 400, 'status ' + verifyLost.status);
    const afterCreate = await snapshot();
    check('STATS: a new lost listing raises total and lost',
      afterCreate.total === baseline.total + 1 && afterCreate.lost === baseline.lost + 1,
      JSON.stringify({ total: afterCreate.total, lost: afterCreate.lost }));

    await Item.updateOne({ _id: hideLostId }, { $set: { status: 'hidden' } });
    const afterHide = await snapshot();
    check('STATS: hiding it restores every counter to the baseline',
      statsFields.every((f) => afterHide[f] === baseline[f]),
      statsFields.map((f) => `${f}:${afterHide[f]}/${baseline[f]}`).join(' '));

    // The same for a returned listing, which touches a different counter
    const hideReturned = await request(app).post('/api/items').set(auth).send({
      title: 'Stats Hidden Returned',
      description: 'A listing returned and then hidden.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const hideReturnedId = hideReturned.body.item && hideReturned.body.item.id;
    await Item.updateOne({ _id: hideReturnedId }, { $set: { status: 'returned' } });
    const returnedUp = await snapshot();
    check('STATS: a returned listing raises the returned counter',
      returnedUp.returned === baseline.returned + 1, `${returnedUp.returned} vs ${baseline.returned}`);

    await Item.updateOne({ _id: hideReturnedId }, { $set: { status: 'hidden' } });
    const verifyHidden = await request(app).patch('/api/admin/items/' + hideReturnedId + '/verify').set(authMod);
    check('G1: a hidden found listing cannot be verified', verifyHidden.status === 400, 'status ' + verifyHidden.status);
    const afterHideReturned = await snapshot();
    check('STATS: hiding a returned listing restores every counter',
      statsFields.every((f) => afterHideReturned[f] === baseline[f]),
      statsFields.map((f) => `${f}:${afterHideReturned[f]}/${baseline[f]}`).join(' '));

    // ---------- 19. The ledger records a completed award ----------
    const settled = await PointEvent.findOne({ user: reg.body.user.id, type: 'found_item' });
    check('LEDGER: an awarded event is stored as completed',
      settled && settled.status === 'completed', settled && settled.status);

    // ---------- 20. A pending award is not a score ----------
    const studentId = reg.body.user.id;
    const pointsBeforePending = await User.findById(studentId).then((u) => u.points);
    const pendingEvent = await PointEvent.create({
      user: studentId,
      type: 'return',
      points: 999,
      key: `pending-test:${Date.now()}`,
      status: 'pending'
    });

    for (const period of ['week', 'month']) {
      const board = await request(app).get(`/api/leaderboard?period=${period}`);
      check(`PENDING-${period}: a pending award does not appear on the ${period} board`,
        !board.body.leaderboard.some((r) => r.points === 999), JSON.stringify(board.body.leaderboard));
    }

    const afterPending = await User.findById(studentId).then((u) => u.points);
    check('PENDING: an uncredited event does not change the stored total',
      afterPending === pointsBeforePending, `${pointsBeforePending} -> ${afterPending}`);

    const mixed = await request(app).get('/api/dashboard/me').set(auth);
    check('PENDING: the impact summary reports the pending award separately',
      mixed.body.impact.pendingAwards >= 1, JSON.stringify(mixed.body.impact));
    check('PENDING: the recent list contains credited contributions only',
      mixed.body.impact.recent.every((e) => e.points !== 999),
      JSON.stringify(mixed.body.impact.recent));
    check('PENDING: contributions counts credited events only',
      mixed.body.impact.contributions
        === (await PointEvent.countDocuments({ user: studentId, status: 'completed' })),
      `${mixed.body.impact.contributions} vs completed count`);

    // Claiming it and crediting it makes it visible, and only then
    const claimedEvent = await PointEvent.findOneAndUpdate(
      { _id: pendingEvent._id, status: 'pending' },
      { $set: { status: 'completed' } },
      { new: true }
    );
    check('PENDING: the event could be settled for this test', Boolean(claimedEvent));
    const afterSettle = await request(app).get('/api/dashboard/me').set(auth);
    check('PENDING: once completed it is counted',
      afterSettle.body.impact.contributions === mixed.body.impact.contributions + 1,
      `${mixed.body.impact.contributions} -> ${afterSettle.body.impact.contributions}`);

    // ---------- 21. Recovery after a real handover ----------
    const recItem = await request(app).post('/api/items').set(auth).send({
      title: 'Recovery Handover Item',
      description: 'A listing used to prove handover recovery.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    check('HANDOVER: recovery item creation succeeds',
      recItem.status === 201,
      `got ${recItem.status}: ${JSON.stringify(recItem.body)}`
    );
    const recItemId = recItem.body.item && recItem.body.item.id;

    const recClaim = await request(app).post('/api/claims').set(auth2)
      .send({ itemId: recItemId, message: 'That is mine, red cap.' });
    check('HANDOVER: recovery claim creation succeeds',
      recClaim.status === 201,
      `got ${recClaim.status}: ${JSON.stringify(recClaim.body)}`
    );
    const recClaimId = recClaim.body.claim && recClaim.body.claim.id;


    await request(app).patch(`/api/claims/${recClaimId}`).set(auth).send({ status: 'approved' });
    const handover = await request(app).post(`/api/claims/${recClaimId}/handover`).set(auth).send({});
    check('HANDOVER: the handover succeeds', handover.status === 200, `got ${handover.status}: ${JSON.stringify(handover.body)}`);

    const claimAfter = await Claim.findById(recClaimId);
    check('HANDOVER: the claim stays approved and records the confirmation',
      claimAfter.status === 'approved' && Boolean(claimAfter.handoverConfirmedAt),
      `${claimAfter.status} / ${claimAfter.handoverConfirmedAt}`);

    // The recovery test above used a real handover whose awards succeeded, so
    // start a second one where the ledger write fails at insertion time — the
    // only faithful simulation of "the award never reached the database".
    const failItem = await request(app).post('/api/items').set(auth).send({
      title: 'Handover With Failing Ledger',
      description: 'A handover whose award cannot be written.',
      category: 'Bottles',
      location: 'Canteen',
      date: new Date().toISOString(),
      type: 'found'
    });
    const failItemId = failItem.body.item && failItem.body.item.id;
    const failClaim = await request(app).post('/api/claims').set(auth2)
      .send({ itemId: failItemId, message: 'Mine, blue lid.' });
    const failClaimId = failClaim.body.claim && failClaim.body.claim.id;
    await request(app).patch(`/api/claims/${failClaimId}`).set(auth).send({ status: 'approved' });

    const balancesBefore = {
      owner: await User.findById(reg.body.user.id).then((u) => ({ points: u.points, returns: u.returns })),
      claimant: await User.findById(reg2.body.user.id).then((u) => ({ points: u.points, returns: u.returns }))
    };

    const realCreate = PointEvent.create;
    PointEvent.create = async (doc, opts) => {
      const key = doc && doc.key ? doc.key : (Array.isArray(doc) && doc[0] ? doc[0].key : '');
      if (String(key).startsWith(`return:${failItemId}:`)) {
        throw new Error('simulated ledger outage');
      }
      return realCreate.call(PointEvent, doc, opts);
    };

    let failedHandover;
    try {
      failedHandover = await request(app).post(`/api/claims/${failClaimId}/handover`).set(auth).send({});
    } finally {
      PointEvent.create = realCreate;
    }

    check('RECOVERY: the handover still succeeds when the award cannot be written',
      failedHandover.status === 200, `got ${failedHandover.status}`);

    const balancesAfter = {
      owner: await User.findById(reg.body.user.id).then((u) => ({ points: u.points, returns: u.returns })),
      claimant: await User.findById(reg2.body.user.id).then((u) => ({ points: u.points, returns: u.returns }))
    };
    check('RECOVERY: neither balance moved while the ledger was down',
      balancesAfter.owner.points === balancesBefore.owner.points
      && balancesAfter.owner.returns === balancesBefore.owner.returns
      && balancesAfter.claimant.points === balancesBefore.claimant.points
      && balancesAfter.claimant.returns === balancesBefore.claimant.returns,
      JSON.stringify({ before: balancesBefore, after: balancesAfter }));

    const orphanEvents = await PointEvent.countDocuments({ key: { $regex: `^return:${failItemId}:` } });
    check('RECOVERY: no return event was created for the failed handover',
      orphanEvents === 0, `${orphanEvents} rows`);

    const { recoverMissingAwards } = require('../src/utils/gamification');
    const recovery = await recoverMissingAwards({ apply: true });
    check('RECOVERY: a handover whose award never landed is found',
      recovery.missingSample.includes(`return:${failItemId}:${reg.body.user.id}`)
      && recovery.missingSample.includes(`return:${failItemId}:${reg2.body.user.id}`),
      JSON.stringify(recovery.missingSample));

    const ownerEvent = await PointEvent.findOne({ key: `return:${failItemId}:${reg.body.user.id}` });
    const claimantEvent = await PointEvent.findOne({ key: `return:${failItemId}:${reg2.body.user.id}` });
    check('RECOVERY: both the owner and the claimant now have a completed award',
      ownerEvent && ownerEvent.status === 'completed'
      && claimantEvent && claimantEvent.status === 'completed',
      `${ownerEvent && ownerEvent.status} / ${claimantEvent && claimantEvent.status}`);

    const recoveredBalances = {
      owner: await User.findById(reg.body.user.id).then((u) => ({ points: u.points, returns: u.returns })),
      claimant: await User.findById(reg2.body.user.id).then((u) => ({ points: u.points, returns: u.returns }))
    };
    check('RECOVERY: the owner was credited exactly once',
      recoveredBalances.owner.points === balancesBefore.owner.points + 10
      && recoveredBalances.owner.returns === balancesBefore.owner.returns + 1,
      JSON.stringify(recoveredBalances.owner));
    check('RECOVERY: the claimant was credited exactly once',
      recoveredBalances.claimant.points === balancesBefore.claimant.points + 10
      && recoveredBalances.claimant.returns === balancesBefore.claimant.returns + 1,
      JSON.stringify(recoveredBalances.claimant));

    const secondRecovery = await recoverMissingAwards({ apply: true });
    check('RECOVERY: running it again pays nothing more',
      secondRecovery.awarded === 0, `awarded ${secondRecovery.awarded}`);
    const finalBalances = await User.findById(reg.body.user.id).then((u) => ({ points: u.points, returns: u.returns }));
    check('RECOVERY: the second run leaves the balance untouched',
      finalBalances.points === recoveredBalances.owner.points
      && finalBalances.returns === recoveredBalances.owner.returns,
      JSON.stringify(finalBalances));

    const delOther = await request(app).delete(`/api/items/${itemId}`).set(auth2);
    check('non-owner cannot delete an item (403)', delOther.status === 403, `got ${delOther.status}`);

    const delOwner = await request(app).delete(`/api/items/${itemId}`).set(auth);
    check('owner can delete their item (200)', delOwner.status === 200, `got ${delOwner.status}`);
    // ---------- 24. Faculty registration and approval lifecycle ----------
    // A dedicated administrator: the shared account is promoted to admin only
    // for its own block and demoted afterwards, so reusing its token here would
    // authenticate as a student and the approval route would rightly answer 403.
    const approverReg = await request(app).post('/api/auth/register').send({
      name: 'Faculty Approver',
      email: 'faculty-approver@scds.saiuniversity.edu.in',
      password: 'secret123'
    });
    await User.updateOne(
      { _id: approverReg.body.user.id },
      { $set: { role: 'admin' } }
    );
    const approverLogin = await request(app).post('/api/auth/login').send({
      email: 'faculty-approver@scds.saiuniversity.edu.in', password: 'secret123'
    });
    const approverAuth = { Authorization: `Bearer ${approverLogin.body.token}` };
    check('FACULTY-LIFECYCLE setup: an administrator signed in',
      approverLogin.status === 200 && Boolean(approverLogin.body.token),
      `got ${approverLogin.status}`);

    // --- 1. register on the allowed faculty parent domain ---
    const facultyReg = await request(app).post('/api/auth/register').send({
      name: 'Faculty Applicant',
      email: 'faculty-applicant@saiuniversity.edu.in',
      password: 'secret123'
    });
    check('FACULTY-LIFECYCLE: registration on the faculty domain is accepted (201)',
      facultyReg.status === 201, `got ${facultyReg.status}: ${JSON.stringify(facultyReg.body)}`);

    // --- 2. the response says pending and issues no JWT ---
    check('FACULTY-LIFECYCLE: the response reports pending approval',
      facultyReg.body.pendingApproval === true, JSON.stringify(facultyReg.body));
    check('FACULTY-LIFECYCLE: no token is issued to a pending application',
      !facultyReg.body.token, `token present: ${Boolean(facultyReg.body.token)}`);

    const facultyUserDoc = await User.findOne({ email: 'faculty-applicant@saiuniversity.edu.in' });
    check('FACULTY-LIFECYCLE: the account is faculty and awaiting approval',
      Boolean(facultyUserDoc) && facultyUser.role === 'faculty' && facultyUserDoc.pendingApproval === true,
      facultyUserDoc ? `${facultyUserDoc.role} pending=${facultyUserDoc.pendingApproval}` : 'user missing');

    // --- 3. login is refused while pending ---
    const pendingLogin = await request(app).post('/api/auth/login').send({
      email: 'faculty-applicant@saiuniversity.edu.in', password: 'secret123'
    });
    check('FACULTY-LIFECYCLE: a pending account cannot sign in (403)',
      pendingLogin.status === 403, `got ${pendingLogin.status}`);
    check('FACULTY-LIFECYCLE: the refusal issues no token',
      !pendingLogin.body.token, `token present: ${Boolean(pendingLogin.body.token)}`);

    // --- a student must not be able to approve ---
    const studentApprove = await request(app)
      .patch(`/api/admin/users/${facultyUserDoc._id}/approve`)
      .set(auth).send({ approved: true });
    check('FACULTY-LIFECYCLE: an ordinary student cannot approve an account (403)',
      studentApprove.status === 403, `got ${studentApprove.status}`);

    // --- 4. an administrator approves ---
    const approveFaculty = await request(app)
      .patch(`/api/admin/users/${facultyUserDoc._id}/approve`)
      .set(approverAuth).send({ approved: true });
    check('FACULTY-LIFECYCLE: an administrator approves the application (200)',
      approveFaculty.status === 200, `got ${approveFaculty.status}: ${JSON.stringify(approveFaculty.body)}`);

    const approvedUserDoc = await User.findById(facultyUserDoc._id);
    check('FACULTY-LIFECYCLE: approval clears pendingApproval',
      approvedUserDoc.pendingApproval === false, `${approvedUserDoc.pendingApproval}`);

    // --- 5. login now succeeds ---
    const approvedLogin = await request(app).post('/api/auth/login').send({
      email: 'faculty-applicant@saiuniversity.edu.in', password: 'secret123'
    });
    check('FACULTY-LIFECYCLE: an approved account can sign in (200)',
      approvedLogin.status === 200 && Boolean(approvedLogin.body.token),
      `got ${approvedLogin.status}`);

    // --- 6. that token reaches a protected route ---
    const facultyMe = await request(app).get('/api/auth/me')
      .set({ Authorization: `Bearer ${approvedLogin.body.token}` });
    check('FACULTY-LIFECYCLE: the approved token reaches a protected route (200)',
      facultyMe.status === 200 && facultyMe.body.user.role === 'faculty',
      `got ${facultyMe.status}`);

    // --- 7. a second application is rejected, with a reason ---
    const rejectReg = await request(app).post('/api/auth/register').send({
      name: 'Rejected Applicant',
      email: 'faculty-rejected@saiuniversity.edu.in',
      password: 'secret123'
    });
    check('FACULTY-LIFECYCLE: a second application is accepted (201)',
      rejectReg.status === 201, `got ${rejectReg.status}`);

    const rejectUserFaculty = await User.findOne({ email: 'faculty-rejected@saiuniversity.edu.in' });
    const noReasonFaculty = await request(app)
      .patch(`/api/admin/users/${rejectUserFaculty._id}/approve`)
      .set(approverAuth).send({ approved: false });
    check('FACULTY-LIFECYCLE: a rejection without a reason is refused (400)',
      noReasonFaculty.status === 400, `got ${noReasonFaculty.status}`);

    const rejectFaculty = await request(app)
      .patch(`/api/admin/users/${rejectUserFaculty._id}/approve`)
      .set(approverAuth).send({ approved: false, note: 'Not a member of staff' });
    check('FACULTY-LIFECYCLE: an administrator rejects with a reason (200)',
      rejectFaculty.status === 200, `got ${rejectFaculty.status}: ${JSON.stringify(rejectFaculty.body)}`);

    const rejectedUserDoc = await User.findById(rejectUserFaculty._id);
    check('FACULTY-LIFECYCLE: the rejection records the reason and suspends the account',
      rejectedUserDoc.suspended === true
      && /Not a member of staff/.test(rejectedUserDoc.approvalNote || ''),
      `suspended=${rejectedUserDoc.suspended} note=${rejectedUserDoc.approvalNote}`);

    // --- 8. the rejected account cannot sign in ---
    const rejectedLogin = await request(app).post('/api/auth/login').send({
      email: 'faculty-rejected@saiuniversity.edu.in', password: 'secret123'
    });
    check('FACULTY-LIFECYCLE: a rejected account cannot sign in (403)',
      rejectedLogin.status === 403, `got ${rejectedLogin.status}`);

    // --- cleanup: remove the accounts this block created ---
    const removed = await User.deleteMany({
      email: { $in: ['faculty-approver@scds.saiuniversity.edu.in',
        'faculty-applicant@saiuniversity.edu.in',
        'faculty-rejected@saiuniversity.edu.in'] }
    });
    check('FACULTY-LIFECYCLE: the test accounts were removed',
      removed.deletedCount === 3, `deleted ${removed.deletedCount}`);

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
