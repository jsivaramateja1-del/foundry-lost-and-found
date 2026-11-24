/**
 * WhatsApp notification subscriptions.
 *
 * Consent is stored per user, one row each. No row means "not subscribed":
 * messaging someone who never asked would be wrong, and Meta's policy requires
 * opt-in before a business may initiate a conversation.
 */

const { many, one } = require('../config/pg');

/** The subscriber list a new listing is announced to. */
async function listSubscribers() {
  return many(
    `select s.user_id, s.phone, u.name
       from whatsapp_subscriptions s
       join users u on u.id = s.user_id
      order by s.created_at asc`
  );
}

/** One user's subscription, or null. */
async function findForUser(userId) {
  return one(
    `select user_id, phone, created_at, updated_at
       from whatsapp_subscriptions
      where user_id = $1`,
    [userId]
  );
}

/**
 * Subscribe, or change the number on an existing subscription.
 * One statement so a repeat call cannot leave two rows for the same user.
 */
async function upsert(userId, phone) {
  return one(
    `insert into whatsapp_subscriptions (user_id, phone)
     values ($1, $2)
     on conflict (user_id) do update
        set phone = excluded.phone,
            updated_at = now()
     returning user_id, phone, created_at, updated_at`,
    [userId, phone]
  );
}

/** Opt out. Idempotent: removing something absent is not an error. */
async function remove(userId) {
  const rows = await many(
    `delete from whatsapp_subscriptions where user_id = $1 returning user_id`,
    [userId]
  );
  return rows.length > 0;
}

/**
 * True when another user has already claimed this number.
 *
 * Two students sharing a phone would each receive the other's alerts, and the
 * same number twice in one fanout is a wasted send. Checked before insert.
 */
async function phoneTakenByOther(phone, userId) {
  const row = await one(
    `select user_id from whatsapp_subscriptions
      where phone = $1 and user_id <> $2
      limit 1`,
    [phone, userId]
  );
  return Boolean(row);
}

module.exports = { listSubscribers, findForUser, upsert, remove, phoneTakenByOther };
