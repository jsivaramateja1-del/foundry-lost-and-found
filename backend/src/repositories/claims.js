/**
 * Claim persistence, including the approval and handover transactions.
 *
 * The Mongo version needed a replica set for this; Postgres does it natively.
 * Approving a claim touches three tables — the claim, its siblings, and the
 * item — and all three either land together or not at all.
 */
const { one, many, transaction } = require('../config/pg');
const points = require('./points');

const toClaim = (row) => (row ? {
  id: row.id,
  item: row.item,
  claimant: row.claimant,
  claimantName: row.claimant_name,
  message: row.message,
  status: row.status,
  reviewNote: row.review_note,
  reviewedAt: row.reviewed_at,
  handoverConfirmedAt: row.handover_confirmed_at,
  createdAt: row.created_at
} : null);

const COLUMNS = 'c.*, u.name as claimant_name';

const create = async ({ item, claimant, message }) => {
  try {
    return toClaim(await one(
      `insert into claims (item, claimant, message) values ($1,$2,$3) returning *`,
      [item, claimant, message]));
  } catch (err) {
    if (err.code === '23505') return null; // already claimed by this user
    throw err;
  }
};

const findByItem = async (itemId) =>
  (await many(`select ${COLUMNS} from claims c join users u on u.id=c.claimant
                where c.item=$1 order by c.created_at desc`, [itemId])).map(toClaim);

const findByClaimant = async (userId) =>
  (await many(`select ${COLUMNS} from claims c join users u on u.id=c.claimant
                where c.claimant=$1 order by c.created_at desc`, [userId])).map(toClaim);

const findById = async (id) =>
  toClaim(await one(`select ${COLUMNS} from claims c join users u on u.id=c.claimant
                      where c.id=$1`, [id]));

/**
 * Approves one claim: marks it approved, rejects every other pending claim on
 * the same item with a note, and moves the item to 'claimed'. Atomic.
 */
const approve = (claimId, reviewerId, note = '') => transaction(async (client) => {
  const { rows } = await client.query('select * from claims where id=$1 for update', [claimId]);
  const claim = rows[0];
  if (!claim) return { error: 'not-found' };
  if (claim.status !== 'pending') return { error: 'not-pending' };

  // Lock the ITEM too, and require it to still be open. Without this two
  // different claims on one listing can both be approved, the item is marked
  // claimed twice, and a stale pending claim can drag a returned or
  // moderator-hidden listing back onto the board.
  const itemRow = (await client.query(
    'select status from items where id=$1 for update', [claim.item])).rows[0];
  if (!itemRow) return { error: 'not-found' };
  if (itemRow.status !== 'open') return { error: 'item-not-open' };

  await client.query(
    `update claims set status='approved', reviewed_by=$2, review_note=$3, reviewed_at=now()
      where id=$1`, [claimId, reviewerId, note]);

  const siblings = await client.query(
    `update claims set status='rejected', reviewed_by=$2, reviewed_at=now(),
                       review_note='Another claim was approved for this listing.'
      where item=$1 and id<>$3 and status='pending' returning id`,
    [claim.item, reviewerId, claimId]);

  await client.query("update items set status='claimed' where id=$1", [claim.item]);
  return { approved: claimId, autoRejected: siblings.rowCount };
});

const reject = (claimId, reviewerId, note = '') => transaction(async (client) => {
  const { rows } = await client.query('select * from claims where id=$1 for update', [claimId]);
  if (!rows[0]) return { error: 'not-found' };
  if (rows[0].status !== 'pending') return { error: 'not-pending' };
  await client.query(
    `update claims set status='rejected', reviewed_by=$2, review_note=$3, reviewed_at=now()
      where id=$1`, [claimId, reviewerId, note]);
  return { rejected: claimId };
});

/**
 * Completes a handover. The owner enters the six-digit code; the claim becomes
 * completed, the item returned, and both parties are credited — once each.
 */
const complete = (claimId, confirmerId, codeMatches) => transaction(async (client) => {
  const { rows } = await client.query('select * from claims where id=$1 for update', [claimId]);
  const claim = rows[0];
  if (!claim) return { error: 'not-found' };
  if (claim.status !== 'approved') return { error: 'not-approved' };
  if (!codeMatches) return { error: 'bad-code' };

  // Check the item BEFORE writing anything. Returning early after the claim
  // update below would COMMIT a completed claim against an item that never
  // moved to returned, and complete() requires status='approved', so the
  // handover could never be re-run.
  const itemLock = await client.query(
    "select status from items where id=$1 for update", [claim.item]);
  if (!itemLock.rows[0] || itemLock.rows[0].status !== 'claimed') {
    return { error: 'item-not-claimed' };
  }

  await client.query(
    `update claims set status='completed', handover_confirmed_by=$2, handover_confirmed_at=now()
      where id=$1`, [claimId, confirmerId]);
  const done = await client.query(
    "update items set status='returned' where id=$1 and status='claimed' returning id", [claim.item]);
  if (done.rowCount === 0) return { error: 'item-not-claimed' };

  const itemRow = (await client.query('select * from items where id=$1', [claim.item])).rows[0];
  // Keys are ITEM-scoped, not claim-scoped. Two claims on one item must not be
  // able to pay the same person twice; this was the Mongo guarantee.
  await points.award(client, {
    userId: itemRow.reported_by, type: 'return',
    eventKey: `return:${claim.item}:${itemRow.reported_by}`, itemId: claim.item, claimId: claim.id
  });
  await points.award(client, {
    userId: claim.claimant, type: 'return',
    eventKey: `return:${claim.item}:${claim.claimant}`, itemId: claim.item, claimId: claim.id
  });

  return { completed: claimId };
});

module.exports = { toClaim, create, findByItem, findByClaimant, findById, approve, reject, complete };
