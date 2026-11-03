/**
 * Integration tests for the TRANSACTIONAL claim-approval path.
 *
 * test/api.test.js runs against a standalone in-memory server, so it exercises
 * the fallback path (conditional update + compensating write). This file runs
 * against a single-node replica set, which is the only way to make
 * `session.withTransaction()` actually execute — and therefore the only way to
 * prove that a failure mid-approval leaves nothing half-written.
 *
 * Run with:  npm run test:transactions
 * Needs to download a mongod binary on first run (MongoDB's download host).
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../src/app');
const connectDB = require('../src/config/db');
const { supportsTransactions, forgetTransactionSupport } = require('../src/utils/transactions');
const { signToken } = require('../src/middleware/auth');
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

let mongod;

const startReplicaSet = async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDB(mongod.getUri());
  // The capability probe caches its answer, so clear anything decided before
  // the connection existed
  forgetTransactionSupport();
};

const stopReplicaSet = async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
};

/** Make a student and return { user, auth } with a real JWT. */
const makeUser = async (name, email) => {
  const user = await User.create({ name, email, password: 'secret123' });
  return { user, auth: { Authorization: `Bearer ${signToken(user._id)}` } };
};

const makeListing = async (auth, title) => {
  const res = await request(app).post('/api/items').set(auth).send({
    title,
    description: 'Used by the transaction tests.',
    category: 'Electronics',
    subcategory: 'Earphones',
    location: 'Library',
    date: new Date().toISOString(),
    type: 'found'
  });
  return res.body.item.id;
};

(async () => {
  try {
    await startReplicaSet();

    // ---------- 0. The path under test is genuinely transactional ----------
    const transactional = await supportsTransactions();
    check('the replica set reports transaction support', transactional === true, `got ${transactional}`);
    if (!transactional) {
      throw new Error('Refusing to continue: this suite is meaningless without transactions');
    }

    const owner = await makeUser('Owner Student', 'owner@scds.saiuniversity.edu.in');
    const alice = await makeUser('Alice Claimant', 'alice@scds.saiuniversity.edu.in');
    const bob = await makeUser('Bob Claimant', 'bob@scds.saiuniversity.edu.in');

    // ---------- 1-3. A successful approval, its siblings and its notifications ----------
    const itemId = await makeListing(owner.auth, 'Transaction Test Earbuds');

    const claimA = await request(app).post('/api/claims').set(alice.auth)
      .send({ itemId, message: 'I lost these on Monday near the library.' });
    const claimB = await request(app).post('/api/claims').set(bob.auth)
      .send({ itemId, message: 'They are mine — the case has a scratch.' });
    check('two students can claim the same listing',
      claimA.status === 201 && claimB.status === 201, `${claimA.status}/${claimB.status}`);

    const approve = await request(app).patch(`/api/claims/${claimA.body.claim.id}`)
      .set(owner.auth).send({ status: 'approved' });

    check('approval succeeds through the transactional path',
      approve.status === 200, `got ${approve.status} ${JSON.stringify(approve.body)}`);

    const itemAfter = await Item.findById(itemId);
    check('the listing moves to claimed exactly once', itemAfter.status === 'claimed', itemAfter.status);

    const claimAAfter = await Claim.findById(claimA.body.claim.id);
    check('the approved claim is approved', claimAAfter.status === 'approved', claimAAfter.status);
    check('the approved claim records who reviewed it',
      String(claimAAfter.reviewedBy) === String(owner.user._id), String(claimAAfter.reviewedBy));

    const claimBAfter = await Claim.findById(claimB.body.claim.id);
    check('the sibling claim is automatically rejected', claimBAfter.status === 'rejected', claimBAfter.status);
    check('the sibling carries the required note',
      claimBAfter.reviewNote === 'Another claim was approved for this listing.', claimBAfter.reviewNote);
    check('the response reports the rejected sibling count',
      approve.body.rejectedSiblings === 1, String(approve.body.rejectedSiblings));

    const aliceNotes = await Notification.find({ user: alice.user._id });
    check('the approved claimant is notified of the approval',
      aliceNotes.some((n) => n.type === 'claim_approved'), aliceNotes.map((n) => n.type).join(','));
    check('the approval notification points at her claim',
      aliceNotes.some((n) => n.type === 'claim_approved'
        && String(n.relatedId) === String(claimA.body.claim.id)),
      aliceNotes.map((n) => String(n.relatedId)).join(','));

    const bobNotes = await Notification.find({ user: bob.user._id });
    check('the sibling claimant is notified of the rejection',
      bobNotes.some((n) => n.type === 'claim_rejected'), bobNotes.map((n) => n.type).join(','));
    check('the rejection notification points at his claim, not another one',
      bobNotes.some((n) => n.type === 'claim_rejected'
        && String(n.relatedId) === String(claimB.body.claim.id)),
      bobNotes.map((n) => String(n.relatedId)).join(','));
    check('the rejection notification is navigable',
      bobNotes.every((n) => /^dashboard\.html#(claims-made|claims-received|listings)$/.test(n.link || '')),
      bobNotes.map((n) => n.link).join(','));

    // ---------- 4. A second approval cannot succeed ----------
    const secondApproval = await request(app).patch(`/api/claims/${claimB.body.claim.id}`)
      .set(owner.auth).send({ status: 'approved' });
    check('a second approval on the same listing is refused (409)',
      secondApproval.status === 409, `got ${secondApproval.status}`);

    const itemStill = await Item.findById(itemId);
    check('the refused approval did not change the listing', itemStill.status === 'claimed', itemStill.status);

    // ---------- 5. A failure inside the transaction leaves nothing half-written ----------
    const itemId2 = await makeListing(owner.auth, 'Rollback Test Backpack');
    const claimC = await request(app).post('/api/claims').set(alice.auth)
      .send({ itemId: itemId2, message: 'My backpack, grey with a red zip pull.' });
    const claimD = await request(app).post('/api/claims').set(bob.auth)
      .send({ itemId: itemId2, message: 'That is mine, the zip pull is red.' });
    check('a second listing has two pending claims',
      claimC.status === 201 && claimD.status === 201, `${claimC.status}/${claimD.status}`);

    const notificationsBefore = await Notification.countDocuments();

    // Inject the failure AFTER all three writes have executed:
    //   1. the listing moves to "claimed"
    //   2. the claim is saved as "approved"
    //   3. every sibling claim is rejected
    // Failing earlier would only prove that an abort before any work is undone,
    // which is nearly free. This proves that work which has already been
    // written is rolled back — the reason for using a transaction at all.
    const executed = { listingUpdated: false, claimSaved: false, siblingsRejected: false };

    const realFindOneAndUpdate = Item.findOneAndUpdate;
    const realSave = Claim.prototype.save;
    const realUpdateMany = Claim.updateMany;

    Item.findOneAndUpdate = function patchedItemUpdate(...args) {
      return realFindOneAndUpdate.apply(this, args).then((result) => {
        executed.listingUpdated = true;
        return result;
      });
    };

    Claim.prototype.save = function patchedSave(...args) {
      return realSave.apply(this, args).then((result) => {
        executed.claimSaved = true;
        return result;
      });
    };

    Claim.updateMany = async function patchedUpdateMany(...args) {
      const result = await realUpdateMany.apply(this, args);
      executed.siblingsRejected = true;
      // All three writes have now run inside the transaction. Fail here, so
      // the rollback has real completed work to undo.
      throw new Error('simulated failure after all three writes');
    };

    let failedApproval;
    try {
      failedApproval = await request(app).patch(`/api/claims/${claimC.body.claim.id}`)
        .set(owner.auth).send({ status: 'approved' });
    } finally {
      Item.findOneAndUpdate = realFindOneAndUpdate;
      Claim.prototype.save = realSave;
      Claim.updateMany = realUpdateMany;
    }

    check('the failure was injected only after all three writes had executed',
      executed.listingUpdated && executed.claimSaved && executed.siblingsRejected,
      JSON.stringify(executed));

    check('the simulated failure surfaces as a server error, not a success',
      failedApproval.status >= 500, `got ${failedApproval.status}`);

    const itemAfterFailure = await Item.findById(itemId2);
    check('the listing was rolled back to open', itemAfterFailure.status === 'open', itemAfterFailure.status);

    const claimCAfterFailure = await Claim.findById(claimC.body.claim.id);
    const claimDAfterFailure = await Claim.findById(claimD.body.claim.id);
    check('the claim write was rolled back to pending',
      claimCAfterFailure.status === 'pending', claimCAfterFailure.status);
    check('the sibling rejection was rolled back too',
      claimDAfterFailure.status === 'pending', claimDAfterFailure.status);
    check('the rolled-back sibling carries no decision note',
      !claimDAfterFailure.reviewNote, String(claimDAfterFailure.reviewNote));
    check('the rolled-back claim records no reviewer',
      !claimCAfterFailure.reviewedBy, String(claimCAfterFailure.reviewedBy));

    const notificationsAfter = await Notification.countDocuments();
    check('a failed approval creates no notifications',
      notificationsAfter === notificationsBefore, `${notificationsBefore} -> ${notificationsAfter}`);

    // ---------- The rollback path still works afterwards ----------
    const retry = await request(app).patch(`/api/claims/${claimC.body.claim.id}`)
      .set(owner.auth).send({ status: 'approved' });
    check('the same approval succeeds once the failure is gone',
      retry.status === 200, `got ${retry.status}`);
    const itemRetried = await Item.findById(itemId2);
    check('the retried approval claims the listing', itemRetried.status === 'claimed', itemRetried.status);
  } catch (err) {
    failed++;
    results.push(`  FAIL  suite crashed: ${err.message}`);
  } finally {
    await stopReplicaSet();
    console.log('\n' + results.join('\n'));
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
