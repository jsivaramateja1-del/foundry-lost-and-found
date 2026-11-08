/**
 * Badges.
 *
 * Five badges, each earned once and never revoked. Evaluation is a pure
 * function of the user's own history, so it is safe to re-run after every
 * relevant event: the primary key on (user_id, badge_id) makes the insert
 * idempotent.
 *
 * A badge is never awarded for an action that has not been verified. A found
 * listing counts only once a moderator has verified it; a return counts only
 * once a handover has been completed. Posting a listing earns nothing.
 */
const { one, many } = require('../config/pg');

const BADGES = [
  {
    id: 'first_found',
    label: 'First Found Item',
    description: 'Had a found listing verified for the first time.',
    metric: 'foundVerified',
    threshold: 1
  },
  {
    id: 'helpful_finder',
    label: 'Helpful Finder',
    description: 'Had three found listings verified.',
    metric: 'foundVerified',
    threshold: 3
  },
  {
    id: 'first_return',
    label: 'Successful Return',
    description: 'Completed a handover and returned an item.',
    metric: 'returns',
    threshold: 1
  },
  {
    id: 'community_helper',
    label: 'Community Helper',
    description: 'Returned five items to their owners.',
    metric: 'returns',
    threshold: 5
  },
  {
    id: 'trusted_member',
    label: 'Trusted Member',
    description: 'Returned ten items. The board trusts you.',
    metric: 'returns',
    threshold: 10
  }
];

/** The counts a badge is measured against. */
const metricsFor = async (userId) => {
  const row = await one(`
    select
      (select count(*)::int from items
        where reported_by = $1 and type = 'found'
          and verified_at is not null and status <> 'hidden') as found_verified,
      (select returns from users where id = $1) as returns`, [userId]);
  return { foundVerified: row.found_verified, returns: row.returns };
};

/**
 * Awards every badge the user now qualifies for. Returns the ids newly earned.
 * Accepts an optional client so it can join the transaction that caused the
 * event.
 */
const evaluate = async (client, userId) => {
  const metrics = await metricsFor(userId);
  const earned = [];

  for (const badge of BADGES) {
    if ((metrics[badge.metric] || 0) < badge.threshold) continue;
    const sql = `insert into user_badges (user_id, badge_id) values ($1, $2)
                 on conflict (user_id, badge_id) do nothing returning badge_id`;
    const params = [userId, badge.id];
    const res = client
      ? await client.query(sql, params)
      : await one(sql, params);
    const inserted = client ? res.rows[0] : res;
    if (inserted) earned.push(badge.id);
  }
  return earned;
};

/** Every badge, with whether this user has it and when. */
const forUser = async (userId) => {
  const rows = await many(
    'select badge_id, earned_at from user_badges where user_id = $1', [userId]);
  const earned = {};
  rows.forEach((r) => { earned[r.badge_id] = r.earned_at; });
  return BADGES.map((b) => ({
    id: b.id,
    label: b.label,
    description: b.description,
    earned: Boolean(earned[b.id]),
    earnedAt: earned[b.id] || null
  }));
};

module.exports = { BADGES, evaluate, forUser, metricsFor };
