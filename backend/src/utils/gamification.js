const mongoose = require('mongoose');
const PointEvent = require('../models/PointEvent');
const User = require('../models/User');
const Item = require('../models/Item');
const Claim = require('../models/Claim');
const { supportsTransactions } = require('./transactions');

/**
 * Gamification, in one place.
 *
 * Two rules keep it honest:
 *   1. Points are written only by this module, never by a route handler and
 *      never from anything the client sends.
 *   2. Every award carries a stable `key`, and { user, key } is unique in the
 *      database. A repeated request is therefore a no-op rather than a second
 *      payout — the guard lives in the index, not in a count-then-write check
 *      that two concurrent requests could both pass.
 */

const POINTS = {
  return: 10,      // a completed, verified return or handover
  found_item: 2    // moderator-verified found listing
};

const BADGES = [
  {
    id: 'first_found',
    label: 'First Found Item',
    description: 'Had your first found item verified by a moderator.',
    earned: (s) => s.foundItems >= 1
  },
  {
    id: 'helpful_finder',
    label: 'Helpful Finder',
    description: 'Had three found items verified by a moderator.',
    earned: (s) => s.foundItems >= 3
  },
  {
    id: 'successful_return',
    label: 'Successful Return',
    description: 'Completed your first verified return.',
    earned: (s) => s.returns >= 1
  },
  {
    id: 'community_helper',
    label: 'Community Helper',
    description: 'Completed five verified returns.',
    earned: (s) => s.returns >= 5
  },
  {
    id: 'trusted_member',
    label: 'Trusted Member',
    description: 'Completed ten verified returns.',
    earned: (s) => s.returns >= 10
  }
];

/**
 * Award points for a verified event, at most once.
 * Returns { awarded: true } when this call is the one that paid out.
 */
/** Thrown inside a transaction when the account disappeared mid-award. */
class MissingUserError extends Error {
  constructor() {
    super('The account no longer exists');
    this.name = 'MissingUserError';
  }
}

/**
 * How long a claim is valid. A claim that is not finished within this window —
 * because the process crashed, the connection dropped, or the write hung — can
 * be picked up by the next request or by the reconciliation script.
 */
const CLAIM_LEASE_MS = 60 * 1000;

/**
 * Apply the credit at most once.
 *
 * The guard (`creditedEvents: { $ne: id }`) is part of the same atomic update as
 * the `$inc`, so a retry after a crash, a timeout or a duplicate request matches
 * nothing and pays nothing. This is what makes the credit idempotent without a
 * transaction: the check and the increment cannot be separated.
 *
 * Returns 'applied' | 'already-credited' | 'user-missing'.
 */
const creditOnce = async (event) => {
  const increment = { points: event.points };
  if (event.type === 'return') increment.returns = 1;

  // The marker is permanent, and that is deliberate. A worker can be paused for
  // an unbounded time: it can hold a claim, lose its lease to another worker,
  // and only resume after that worker has finished. Removing the marker once an
  // event looks complete would let the paused worker credit it a second time,
  // because it never re-reads the event's status before this update. Keeping
  // the id for ever is the only pruning-free guarantee that no stale worker can
  // pay twice. The cost is one 24-character string per award on the user
  // document (see the README for the storage note).
  const result = await User.updateOne(
    { _id: event.user, creditedEvents: { $ne: String(event._id) } },
    {
      $inc: increment,
      $push: { creditedEvents: String(event._id) }
    }
  );

  if (result.modifiedCount === 1) return 'applied';

  // Nothing matched: either the account is gone, or this event was already paid
  const exists = await User.exists({ _id: event.user });
  return exists ? 'already-credited' : 'user-missing';
};

/**
 * Finish a claimed event: credit it once, then mark it completed.
 * Safe to call repeatedly for the same event, including after a crash.
 */
const settleClaimed = async (event) => {
  const outcome = await creditOnce(event);

  if (outcome === 'user-missing') {
    // Nothing to credit and nobody to credit: drop the row
    await PointEvent.deleteOne({ _id: event._id }).catch((err) => {
      console.error(`POINT LEDGER: could not remove event ${event._id} for a deleted account: ${err.message}`);
    });
    return { awarded: false, reason: 'user-missing' };
  }

  try {
    await PointEvent.updateOne(
      { _id: event._id, status: { $ne: 'completed' } },
      { $set: { status: 'completed' }, $unset: { claimedAt: '' } }
    );
  } catch (err) {
    // The money is already on the account. Leaving the row claimed is safe:
    // it is reclaimed after the lease and the idempotent guard stops a second
    // credit. Say so rather than hiding it.
    console.error(
      `POINT LEDGER: event ${event._id} was credited but could not be marked completed (${err.message}). `
      + 'It will be reclaimed after the lease; the idempotent guard prevents a second credit.'
    );
  }

  return outcome === 'applied'
    ? { awarded: true, points: event.points }
    : { awarded: false, reason: 'already-awarded' };
};

/**
 * Award points for a verified event, at most once.
 *
 * Replica set (Atlas): the ledger row and the credit commit inside one
 * transaction, so they cannot diverge at all.
 *
 * Standalone: an explicit state machine.
 *
 *     pending ──claim──> claimed ──credit (idempotent)──> completed
 *        ^                   │
 *        └── lease expires ──┘   (the claim is picked up again)
 *
 * Only the holder of the claim credits, and the credit is guarded on the event
 * id. That guard is the one thing a stale worker cannot get past: it is checked
 * inside the same atomic update as the increment, so a worker that resumes after
 * its lease expired — however long it was paused — finds the marker already
 * present and pays nothing. The marker is therefore never removed.
 * A crash before the credit leaves a claim that expires and is picked up again.
 *
 * What this does NOT give you: a single atomic operation across two collections.
 * Between the credit and the `completed` write the database briefly shows a
 * claimed event whose points are already on the account. That window is
 * recoverable, not corrupting, and the reconciliation script reports it.
 */
const awardPoints = async ({ userId, type, key, item, claim }) => {
  const points = POINTS[type];
  if (!userId || !points) return { awarded: false, reason: 'not-awardable' };

  if (await supportsTransactions()) {
    const increment = { points };
    if (type === 'return') increment.returns = 1;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await PointEvent.create(
          [{ user: userId, type, points, key, item, claim, status: 'completed' }],
          { session }
        );
        const updated = await User.findByIdAndUpdate(
          userId, { $inc: increment }, { session, new: true }
        );
        if (!updated) throw new MissingUserError();
      });
      return { awarded: true, points };
    } catch (err) {
      if (err && err.code === 11000) return { awarded: false, reason: 'already-awarded' };
      if (err instanceof MissingUserError) return { awarded: false, reason: 'user-missing' };
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // ---- standalone state machine ----
  let event = await PointEvent.findOne({ user: userId, key });
  if (!event) {
    try {
      event = await PointEvent.create({
        user: userId, type, points, key, item, claim, status: 'pending'
      });
    } catch (err) {
      if (!err || err.code !== 11000) throw err;
      event = await PointEvent.findOne({ user: userId, key });
      if (!event) return { awarded: false, reason: 'already-awarded' };
    }
  }
  if (event.status === 'completed') return { awarded: false, reason: 'already-awarded' };

  const now = new Date();
  const claimed = await PointEvent.findOneAndUpdate(
    {
      _id: event._id,
      $or: [
        { status: 'pending' },
        // An abandoned claim becomes available again
        { status: 'claimed', claimedAt: { $lt: new Date(now.getTime() - CLAIM_LEASE_MS) } }
      ]
    },
    { $set: { status: 'claimed', claimedAt: now } },
    { new: true }
  );

  if (!claimed) {
    const current = await PointEvent.findOne({ _id: event._id });
    return {
      awarded: false,
      reason: current && current.status === 'completed' ? 'already-awarded' : 'in-progress'
    };
  }

  return settleClaimed(claimed);
};

/**
 * Grant any badge whose criteria the user now meets. Badges are never revoked,
 * and an already-earned badge is skipped by id, so this is safe to call often.
 */
const evaluateBadges = async (userId) => {
  if (!userId) return [];
  const user = await User.findById(userId).select('badges returns');
  if (!user) return [];

  const foundItems = await Item.countDocuments({ reportedBy: userId, type: 'found', status: { $ne: 'hidden' }, verifiedAt: { $exists: true, $ne: null } });
  const stats = { foundItems, returns: user.returns || 0 };
  const earned = new Set((user.badges || []).map((b) => b.id));

  const newlyEarned = BADGES.filter((b) => !earned.has(b.id) && b.earned(stats));

  // One conditional update per badge. The `badges.id: { $ne: ... }` guard is
  // part of the update, so two concurrent evaluations cannot both insert it.
  const granted = [];
  for (const badge of newlyEarned) {
    const result = await User.updateOne(
      { _id: userId, 'badges.id': { $ne: badge.id } },
      { $push: { badges: { id: badge.id, earnedAt: new Date() } } }
    );
    if (result.modifiedCount === 1) granted.push(badge);
  }
  return granted;
};

/** Recovery page size. Bounded so one page can never become a full scan. */
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

/**
 * Validate a page size. Throws rather than falling back to a default, because a
 * silently "fixed" value is how an accidental full-collection read happens.
 */
const resolveBatchSize = (value) => {
  if (value === undefined || value === null) return DEFAULT_BATCH_SIZE;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new RangeError(`batchSize must be a finite whole number between 1 and ${MAX_BATCH_SIZE}`);
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(`batchSize must be a whole number between 1 and ${MAX_BATCH_SIZE} (got ${value})`);
  }
  if (n < 1) {
    throw new RangeError(`batchSize must be at least 1 (got ${n})`);
  }
  if (n > MAX_BATCH_SIZE) {
    throw new RangeError(`batchSize must not exceed ${MAX_BATCH_SIZE} (got ${n})`);
  }
  return n;
};

/**
 * Walk a collection in stable pages, ordered by _id, using a cursor rather than
 * skip/limit. A cursor keeps working while rows are inserted and never re-reads
 * a page it has already seen, which skip/limit does not guarantee.
 *
 * `onRow` is awaited for each row, so the caller processes a page before the
 * next one is requested. Only one page is ever held in memory.
 */
const scanInPages = async ({ model, filter, dateField, since, batchSize, onRow }) => {
  let lastId = null;
  let batches = 0;

  for (;;) {
    const query = { ...filter };
    if (since && dateField) query[dateField] = { $gte: since };
    if (lastId) query._id = { $gt: lastId };

    const rows = await model.find(query)
      .select('_id reportedBy')
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (!rows.length) break;
    batches += 1;

    for (const row of rows) {
      await onRow(row);          // finish this row before the next is fetched
    }

    lastId = rows[rows.length - 1]._id;
    if (rows.length < batchSize) break;
  }

  return { batches };
};

/**
 * Find eligible business actions that have no ledger row and create them.
 *
 * Eligibility is read from the persisted business record, never from a log
 * line, so this works after a restart and after the process that failed is
 * long gone:
 *
 *   - a found listing (not hidden)   -> found_item points to its owner
 *   - a returned listing             -> return points to the owner
 *   - ...and to the approved claimant, if there is one
 *
 * The default is ALL TIME, walked in pages by _id cursor. Each page is fully
 * processed and then released: nothing accumulates across pages, so memory is
 * bounded by the batch size however many eligible records exist. Only a small
 * sample of missing and failed keys is kept for diagnosis; the counters are
 * exact.
 *
 * Every award goes through awardPoints, so this is idempotent and safe to run
 * repeatedly, concurrently, or while the site is live.
 */
const recoverMissingAwards = async ({
  sinceDays = null,
  apply = false,
  batchSize = DEFAULT_BATCH_SIZE,
  sampleSize = 10
} = {}) => {
  // Validated here as well as in the CLI, so any caller is held to the limit
  const pageSize = resolveBatchSize(batchSize);
  const since = sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : null;
  const report = {
    window: since ? `last ${sinceDays} day(s)` : 'all time',
    scanned: 0,
    batches: 0,
    eligible: 0,
    alreadyPresent: 0,
    missing: 0,
    awarded: 0,
    failed: 0,
    missingSample: [],
    failedSample: [],
    sampleLimit: sampleSize,
    samplesTruncated: false
  };

  const note = (list, value) => {
    if (list.length < sampleSize) list.push(value);
    else report.samplesTruncated = true;
  };

  /** Check and (optionally) create one award. Never stores the job anywhere. */
  const handleJob = async (job) => {
    if (!job.userId || !job.key) return;
    report.eligible += 1;

    const exists = await PointEvent.exists({ user: job.userId, key: job.key });
    if (exists) {
      report.alreadyPresent += 1;
      return;
    }

    report.missing += 1;
    note(report.missingSample, job.key);

    if (!apply) return;

    try {
      const result = await awardPoints(job);
      if (result.awarded) report.awarded += 1;
      else report.alreadyPresent += 1;
    } catch (err) {
      report.failed += 1;
      note(report.failedSample, `${job.key}: ${err.message}`);
    }
  };

  const found = await scanInPages({
    model: Item,
    filter: { type: 'found', status: { $ne: 'hidden' }, verifiedAt: { $exists: true, $ne: null } },
    dateField: 'createdAt',
    since,
    batchSize: pageSize,
    onRow: async (item) => {
      report.scanned += 1;
      await handleJob({
        userId: item.reportedBy,
        type: 'found_item',
        key: `found:${item._id}`,
        item: item._id
      });
    }
  });

  const returned = await scanInPages({
    model: Item,
    filter: { status: 'returned' },
    dateField: 'updatedAt',
    since,
    batchSize: pageSize,
    onRow: async (item) => {
      report.scanned += 1;

      // Return points require a confirmed handover, not just returned status.
      const approved = await Claim.findOne({
        item: item._id,
        status: 'approved',
        handoverConfirmedAt: { $exists: true, $ne: null }
      }).select("_id claimant").lean();

      if (approved && approved.claimant) {
        await handleJob({
          userId: item.reportedBy,
          type: 'return',
          key: `return:${item._id}:${item.reportedBy}`,
          item: item._id,
          claim: approved._id
        });
        await handleJob({
          userId: approved.claimant,
          type: 'return',
          key: `return:${item._id}:${approved.claimant}`,
          item: item._id,
          claim: approved._id
        });
      }
    }
  });

  report.batches = found.batches + returned.batches;
  return report;
};

module.exports = {
  resolveBatchSize,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  recoverMissingAwards,
  POINTS,
  BADGES,
  awardPoints,
  evaluateBadges,
  MissingUserError,
  settleClaimed,
  CLAIM_LEASE_MS
};
