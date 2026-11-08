/**
 * The points ledger.
 *
 * Awarding is a single INSERT ... ON CONFLICT DO NOTHING followed by an UPDATE
 * of the user's totals, inside one transaction. The unique index on
 * (user_id, event_key) is what makes an award idempotent — the old design kept
 * an ever-growing creditedEvents array on the user for the same purpose.
 */
const { one, many, transaction } = require('../config/pg');

const POINTS = { return: 10, found_item: 2 };

/**
 * Credits an event exactly once. Returns { credited: boolean }.
 * A second call with the same key does nothing at all.
 */
const award = async (client, { userId, type, eventKey, itemId = null, claimId = null }) => {
  const points = POINTS[type];
  if (!points) throw new Error(`Unknown point event type: ${type}`);

  const inserted = await client.query(
    `insert into point_events (user_id, type, points, event_key, status, item, claim)
     values ($1,$2,$3,$4,'completed',$5,$6)
     on conflict (user_id, event_key) do nothing
     returning id`,
    [userId, type, points, eventKey, itemId, claimId]
  );
  if (inserted.rowCount === 0) return { credited: false };

  await client.query(
    `update users
        set points = points + $2,
            returns = returns + case when $3 = 'return' then 1 else 0 end
      where id = $1`,
    [userId, points, type]
  );
  return { credited: true, points };
};

/** Convenience wrapper that opens its own transaction. */
const awardOnce = (payload) => transaction((client) => award(client, payload));

/** A user's own ledger, newest first. */
const forUser = async (userId, limit = 50) =>
  many(`select id, type, points, event_key, status, created_at
          from point_events where user_id = $1
         order by created_at desc limit $2`, [userId, limit]);

/** Read-only consistency check: does the ledger sum match the stored total? */
const auditUser = async (userId) => {
  const row = await one(`
    select u.points as stored_points,
           coalesce(sum(pe.points) filter (where pe.status = 'completed'), 0)::int as ledger_points,
           count(pe.id) filter (where pe.status in ('pending','claimed'))::int as pending_events
      from users u left join point_events pe on pe.user_id = u.id
     where u.id = $1
     group by u.id, u.points`, [userId]);
  if (!row) return null;
  return {
    storedPoints: row.stored_points,
    ledgerPoints: row.ledger_points,
    pendingEvents: row.pending_events,
    inSync: row.stored_points === row.ledger_points
  };
};

/** Leaderboard for a period, students only, opt-outs excluded. */
const leaderboard = async (period = 'all', limit = 25) => {
  const window = {
    week: "and pe.created_at >= now() - interval '7 days'",
    month: "and pe.created_at >= now() - interval '30 days'",
    all: ''
  }[period];
  if (window === undefined) throw new Error('period must be week, month or all');

  return many(`
    select u.id, u.name, u.returns,
           sum(pe.points)::int as points,
           rank() over (order by sum(pe.points) desc, u.returns desc, u.id) as position
      from users u
      join point_events pe on pe.user_id = u.id and pe.status = 'completed' ${window}
     where u.role = 'student' and u.leaderboard_opt_out = false
     group by u.id, u.name, u.returns
     order by points desc, u.returns desc, u.id
     limit $1`, [limit]);
};

module.exports = { POINTS, award, awardOnce, forUser, auditUser, leaderboard };
