/**
 * Ledger consistency audit (read-only).
 *
 * Runs against an isolated in-memory MongoDB, seeds a known set of accounts and
 * point events, then asks the SAME classification code the production script
 * uses whether the stored balances and the ledger agree. Nothing is written:
 * the audit asserts the row counts are identical before and after.
 *
 * Run with:  npm run test:ledger
 */
const mongoose = require('mongoose');

let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  let mongod;
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('foundry-ledger-audit'));

    const User = require('../src/models/User');
    const PointEvent = require('../src/models/PointEvent');
    const { classifyBalance, planChange } = require('../src/utils/reconcile');

    // --- a consistent account: one completed return, one pending award --------
    const good = await User.create({
      name: 'Consistent', email: 'consistent@scds.saiuniversity.edu.in',
      password: 'secret123', points: 10, returns: 1
    });
    await PointEvent.create({
      user: good._id, type: 'return', points: 10, key: 'return:x:good', status: 'completed'
    });
    await PointEvent.create({
      user: good._id, type: 'found_item', points: 2, key: 'found:y', status: 'pending'
    });

    // --- an under-credited account: the ledger holds more than the balance ----
    const under = await User.create({
      name: 'Under', email: 'under@scds.saiuniversity.edu.in',
      password: 'secret123', points: 0, returns: 0
    });
    await PointEvent.create({
      user: under._id, type: 'return', points: 10, key: 'return:z:under', status: 'completed'
    });

    const usersBefore = await User.countDocuments();
    const eventsBefore = await PointEvent.countDocuments();

    // The same aggregation the reconciliation script performs
    const ledger = await PointEvent.aggregate([
      { $match: { status: 'completed' } },
      { $group: {
        _id: '$user',
        points: { $sum: '$points' },
        returns: { $sum: { $cond: [{ $eq: ['$type', 'return'] }, 1, 0] } },
        events: { $sum: 1 }
      } }
    ]);
    const pending = await PointEvent.aggregate([
      { $match: { status: { $in: ['pending', 'claimed'] } } },
      { $group: { _id: '$user', n: { $sum: 1 } } }
    ]);

    const byUser = new Map(ledger.map((r) => [String(r._id), r]));
    const pendingByUser = new Map(pending.map((r) => [String(r._id), r.n]));

    const rowFor = (user) => {
      const l = byUser.get(String(user._id)) || { points: 0, returns: 0, events: 0 };
      return classifyBalance({
        storedPoints: user.points,
        storedReturns: user.returns,
        ledgerPoints: l.points,
        ledgerReturns: l.returns,
        pendingEvents: pendingByUser.get(String(user._id)) || 0
      });
    };

    const goodRow = rowFor(good);
    check('a balance that matches the ledger is reported in sync',
      goodRow.state === 'in-sync', JSON.stringify(goodRow));
    check('a pending award is not counted as a score',
      goodRow.pendingEvents === 1 && goodRow.ledgerPoints === 10,
      `pending ${goodRow.pendingEvents}, ledger ${goodRow.ledgerPoints}`);
    check('an in-sync account needs no change', planChange(goodRow) === null);

    const underRow = rowFor(under);
    check('a ledger holding more than the balance is reported under-credited',
      underRow.state === 'under-credited', JSON.stringify(underRow));
    check('the planned change tops the account up to the ledger',
      planChange(underRow) && planChange(underRow).action === 'top-up'
      && planChange(underRow).to.points === 10,
      JSON.stringify(planChange(underRow)));

    // --- the audit is read-only -----------------------------------------------
    const usersAfter = await User.countDocuments();
    const eventsAfter = await PointEvent.countDocuments();
    check('the audit changes no account', usersAfter === usersBefore, `${usersBefore} -> ${usersAfter}`);
    check('the audit changes no ledger row', eventsAfter === eventsBefore, `${eventsBefore} -> ${eventsAfter}`);

    const unchanged = await User.findById(good._id);
    check('no stored balance was rewritten', unchanged.points === 10 && unchanged.returns === 1,
      `${unchanged.points}/${unchanged.returns}`);
  } catch (err) {
    check('the ledger audit ran', false, err.message);
  } finally {
    try { await mongoose.disconnect(); } catch { /* never connected */ }
    if (mongod) await mongod.stop().catch(() => {});
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
