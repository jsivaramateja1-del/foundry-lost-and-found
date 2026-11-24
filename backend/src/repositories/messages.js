/**
 * Conversations about one item.
 *
 * Anyone signed in may open a conversation with the reporter of a listing; the
 * reporter may reply to anyone who has written to them about it. A thread is
 * therefore a pair - (item, the other person) - and each party only ever sees
 * their own exchange with the reporter.
 */

const { many, one } = require('../config/pg');

/**
 * Resolve the conversation between `userId` and the item's reporter.
 * Returns null when the item does not exist or the reader is neither party.
 */
async function audienceFor(itemId, userId) {
  const item = await one('select reported_by from items where id = $1', [itemId]);
  if (!item) return null;

  const reporterId = item.reported_by;
  const isReporter = reporterId === userId;

  if (isReporter) {
    // Everyone who has written to the reporter about this item.
    const rows = await many(
      'select distinct sender_id as id from messages where item_id = $1 and recipient_id = $2',
      [itemId, reporterId]
    );
    return { isReporter: true, reporterId, others: rows.map((r) => r.id) };
  }

  return { isReporter: false, reporterId, others: [reporterId] };
}

/**
 * The messages of one conversation, oldest first.
 * The reporter sees their exchange with `withId`; anyone else sees their own.
 */
async function threadFor(itemId, userId, withId) {
  const audience = await audienceFor(itemId, userId);
  if (!audience) return null;

  const other = withId || audience.others[0];
  if (!other) return [];

  return many(
    `select m.id, m.item_id, m.sender_id, m.recipient_id, m.body, m.read_at, m.created_at,
            s.name as sender_name
       from messages m
       join users s on s.id = m.sender_id
      where m.item_id = $1
        and ((m.sender_id = $2 and m.recipient_id = $3) or (m.sender_id = $3 and m.recipient_id = $2))
      order by m.created_at asc`,
    [itemId, userId, other]
  );
}

/** Every conversation on an item, for the reporter's inbox. */
async function conversationsFor(itemId, userId) {
  const audience = await audienceFor(itemId, userId);
  if (!audience) return null;

  if (!audience.isReporter) {
    const rows = await threadFor(itemId, userId, audience.reporterId);
    return [{ otherId: audience.reporterId, otherName: 'The person who posted it', count: rows.length, last: rows.length ? rows[rows.length - 1] : null }];
  }

  const rows = await many(
    `select m.sender_id as other_id, u.name as other_name,
            count(*)::int as n, max(m.created_at) as last_at
       from messages m join users u on u.id = m.sender_id
      where m.item_id = $1 and m.recipient_id = $2
      group by m.sender_id, u.name
      order by last_at desc`,
    [itemId, userId]
  );
  return rows.map((r) => ({ otherId: r.other_id, otherName: r.other_name, count: r.n, lastAt: r.last_at }));
}

async function send(itemId, senderId, recipientId, body) {
  const audience = await audienceFor(itemId, senderId);
  if (!audience) return { ok: false, status: 403, error: 'That listing does not exist' };

  // A non-reporter may only address the reporter; the reporter may address
  // anyone who has written to them.
  if (!audience.isReporter && recipientId !== audience.reporterId) {
    return { ok: false, status: 400, error: 'You can only message the person who posted this item' };
  }
  if (audience.isReporter && !audience.others.includes(recipientId)) {
    return { ok: false, status: 400, error: 'That person has not written to you about this item' };
  }
  if (senderId === recipientId) return { ok: false, status: 400, error: 'You cannot message yourself' };

  const text = String(body == null ? '' : body).trim();
  if (!text) return { ok: false, status: 400, error: 'Write a message first' };
  if (text.length > 1000) return { ok: false, status: 400, error: 'That message is too long (max 1000 characters)' };

  const row = await one(
    `insert into messages (item_id, sender_id, recipient_id, body)
     values ($1,$2,$3,$4)
     returning id, item_id, sender_id, recipient_id, body, read_at, created_at`,
    [itemId, senderId, recipientId, text]
  );
  return { ok: true, message: row };
}

async function markRead(itemId, userId) {
  return many(
    `update messages set read_at = now()
      where item_id = $1 and recipient_id = $2 and read_at is null returning id`,
    [itemId, userId]
  );
}

async function unreadCount(userId) {
  const row = await one('select count(*)::int as n from messages where recipient_id = $1 and read_at is null', [userId]);
  return row ? row.n : 0;
}

module.exports = { audienceFor, threadFor, conversationsFor, send, markRead, unreadCount };
