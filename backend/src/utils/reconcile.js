/**
 * Comparing an account's balance with its ledger.
 *
 * The ledger only starts at the moment it was introduced, so an account can
 * legitimately hold points that no event records. Treating "stored > ledger"
 * as an error and overwriting it would erase genuine history, which is exactly
 * what this module exists to prevent.
 *
 * Kept pure so the classification can be tested without a database.
 */

/**
 * @param {object} input
 * @param {number} input.storedPoints   points on the user document
 * @param {number} input.storedReturns  returns on the user document
 * @param {number} input.ledgerPoints   sum of COMPLETED events
 * @param {number} input.ledgerReturns  number of COMPLETED return events
 * @param {number} [input.pendingEvents] events written but not yet credited
 * @returns {{state: string, preLedgerPoints: number, preLedgerReturns: number, pendingEvents: number}}
 *
 * state is one of:
 *   'in-sync'            the ledger explains the whole balance
 *   'historical-balance' the account holds more than the ledger records —
 *                        normal for points earned before the ledger existed
 *   'under-credited'     the ledger records more than the account holds —
 *                        the residue of a failed credit, safe to top up
 */
const classifyBalance = ({
  storedPoints = 0,
  storedReturns = 0,
  ledgerPoints = 0,
  ledgerReturns = 0,
  pendingEvents = 0
} = {}) => {
  const preLedgerPoints = storedPoints - ledgerPoints;
  const preLedgerReturns = storedReturns - ledgerReturns;

  let state = 'in-sync';
  if (preLedgerPoints < 0 || preLedgerReturns < 0) state = 'under-credited';
  else if (preLedgerPoints > 0 || preLedgerReturns > 0) state = 'historical-balance';

  // The inputs are echoed back so a caller can hand the result straight to
  // planChange without re-assembling the row — the mistake that made the first
  // version of this module return undefined balances.
  return {
    state,
    preLedgerPoints,
    preLedgerReturns,
    pendingEvents,
    storedPoints,
    storedReturns,
    ledgerPoints,
    ledgerReturns
  };
};

/**
 * Decide what an --apply run would do to one account.
 *
 * A top-up only ever adds points, so it is safe. Reducing an account is only
 * allowed when the operator asked for it explicitly, because a reduction can
 * destroy a balance that predates the ledger.
 */
const planChange = (row, { allowDecrease = false } = {}) => {
  if (row.state === 'in-sync') return null;

  if (row.state === 'under-credited') {
    return {
      action: 'top-up',
      from: { points: row.storedPoints, returns: row.storedReturns },
      to: { points: row.ledgerPoints, returns: row.ledgerReturns },
      reason: 'the ledger records more than the account holds'
    };
  }

  if (allowDecrease) {
    return {
      action: 'reduce',
      from: { points: row.storedPoints, returns: row.storedReturns },
      to: { points: row.ledgerPoints, returns: row.ledgerReturns },
      reason: 'reducing to the ledger was explicitly requested (--allow-decrease)'
    };
  }

  return {
    action: 'skip',
    reason: 'the account holds points the ledger does not record; this is a '
      + 'historical balance, not an error. Re-run with --allow-decrease to overwrite it.'
  };
};

/**
 * The atomic filter used to take over a stuck event.
 *
 * The bug this closes: selecting an expired claim and then updating by
 * `{ _id, status }` matches a lease that another request renewed in between,
 * which would steal an active claim. Matching the exact `claimedAt` we observed
 * means only that specific expired lease can be taken.
 */
const leaseClaimFilter = (event) => {
  if (!event) return null;
  if (event.status === 'claimed') {
    return { _id: event._id, status: 'claimed', claimedAt: event.claimedAt };
  }
  return { _id: event._id, status: 'pending' };
};

/** Is this event a candidate for recovery at all? */
const isRecoverable = (event, now = Date.now(), leaseMs = 60000) => {
  if (!event) return false;
  if (event.status === 'pending') return true;
  if (event.status !== 'claimed') return false;
  return Boolean(event.claimedAt) && new Date(event.claimedAt).getTime() < now - leaseMs;
};

/**
 * Parse a positive whole number from a CLI argument.
 *
 * Throws rather than defaulting: a mistyped value silently becoming something
 * else is how an operator ends up scanning the wrong window.
 */
const parsePositiveInt = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new RangeError(`${label} needs a whole number greater than zero`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new RangeError(`${label} must be a whole number greater than zero (got "${value}")`);
  }
  return n;
};

module.exports = {
  classifyBalance,
  planChange,
  leaseClaimFilter,
  isRecoverable,
  parsePositiveInt
};
