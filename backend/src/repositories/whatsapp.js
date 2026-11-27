const { many, one } = require('../config/pg');

async function listSubscribers() {
  return many(
    `select s.user_id, s.phone, u.name
       from whatsapp_subscriptions s
       join users u on u.id = s.user_id
      order by s.created_at asc`
  );
}

async function findForUser(userId) {
  return one(
    `select user_id, phone, created_at, updated_at
       from whatsapp_subscriptions
      where user_id = $1`,
    [userId]
  );
}

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

async function remove(userId) {
  const rows = await many(
    `delete from whatsapp_subscriptions where user_id = $1 returning user_id`,
    [userId]
  );
  return rows.length > 0;
}

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
