/**
 * In-app notifications and the audit trail.
 *
 * Both tables existed in the schema and were read by the API, but nothing ever
 * wrote to them — so the bell was permanently empty and the admin audit panel
 * had no source data. These are the writers.
 *
 * Both accept an optional `client` so they can join a surrounding transaction:
 * a notification must never describe a change that then rolled back.
 */
const { one, many } = require('../config/pg');

/** Creates one notification. Safe to call inside a transaction via `client`. */
const create = async (client, { userId, type, message, link = '', relatedType = null, relatedId = null }) => {
  const run = client ? client.query.bind(client) : null;
  const sql = `insert into notifications (user_id, type, message, link, related_type, related_id)
               values ($1,$2,$3,$4,$5,$6) returning id`;
  const params = [userId, type, message, link, relatedType, relatedId];
  if (run) return (await run(sql, params)).rows[0];
  return one(sql, params);
};

/** Records a privileged action. Never throws into the caller's path. */
const audit = async ({ actor, actorEmail, action, targetType, targetId, note = '' }) => {
  try {
    await one(
      `insert into audit_logs (actor, actor_email, action, target_type, target_id, note)
       values ($1,$2,$3,$4,$5,$6)`,
      [actor || null, actorEmail || '', action, targetType || '', targetId || null, note]);
  } catch (err) {
    // An audit write must not fail the action it is recording.
    console.error(`[audit] failed to record ${action}: ${err.message}`);
  }
};

const forUser = (userId, limit = 50) =>
  many(`select id, type, message, link, read, created_at from notifications
         where user_id = $1 order by created_at desc limit $2`, [userId, limit]);

const trail = (limit = 50) =>
  many(`select action, actor_email, note, created_at from audit_logs
         order by created_at desc limit $1`, [limit]);

module.exports = { create, audit, forUser, trail };
