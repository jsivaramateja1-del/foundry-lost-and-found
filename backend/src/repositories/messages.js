/**
 * Messages between a reporter and a claimant of one item.
 *
 * Authorisation lives here, not in the route and never in the UI: every
 * function takes the acting user and refuses when that user is neither the
 * reporter nor a claimant of the item.
 */

const { many, one } = require('../config/pg');

/**
 * Everyone entitled to see the thread on an item: the reporter, plus anyone
 * holding a claim on it. A withdrawn claim keeps its row, so a person who was
 * once part of the conversation can still read what was said to them.
 */
async function participants(itemId) {
  const row = await one('select reported_by from items where id = $1', [itemId]);
  if (!row) return null;

  const claimants = await many(
    'select distinct claimant from claims where item = $1',
    [itemId]
  );

  const ids = new Set([row.reported_by, ...claimants.map((c) => c.claimant)]);
  return { reporterId: row.reported_by, ids };
}

/**
 * May `userId` take part in this item's thread?
 * Returns who they may address, or null when they have no place in it.
 */
async function audienceFor(itemId, userId) {
  const parts = await participants(itemId);
  if (!parts) return null;
  if (!parts.ids.has(userId)) return null;

  const others = [...parts.ids].filter((id) => id !== userId);
  return { isReporter: parts.reporterId === userId, others };
}

/** The thread visible to this user, oldest first, with sender names. */
async function threadFor(itemId, userId) {
  const audience = await audienceFor(itemId, userId);
  if (!audience) return null;

  return many(
    `select m.id, m.item_id, m.sender_id, m.recipient_id, m.body, m.read_at, m.created_at,
            s.name as sender_name
       from messages m
       join users s on s.id = m.sender_id
      where m.item_id = $1
        and (m.sender_id = $2 or m.recipient_id = $2)
      order by m.created_at asc`,
    [itemId, userId]
  );
}

/**
 * Send a message. Refuses when the sender has no place in the thread, when the
 * recipient is not the other party, or when the body is empty or oversized.
 */
async function send(itemId, senderId, recipientId, body) {
  const audience = await audienceFor(itemId, senderId);
  if (!audience) return { ok: false, status: 403, error: 'You are not part of this conversation' };

  if (!audience.others.includes(recipientId)) {
    return { ok: false, status: 400, error: 'That person is not part of this conversation' };
  }

  const text = String(body == null ? '' : body).trim();
  if (!text) return { ok: false, status: 400, error: 'Write a message first' };
  if (text.length > 1000) return { ok: false, status: 400, error: 'That message is too long (max 1000 characters)' };

  const row = await one(
    `insert into messages (item_id, sender_id, recipient_id, body)
     values ($1, $2, $3, $4)
     returning id, item_id, sender_id, recipient_id, body, read_at, created_at`,
    [itemId, senderId, recipientId, text]
  );
  return { ok: true, message: row };
}

/** Mark everything addressed to this user on this item as read. */
async function markRead(itemId, userId) {
  const audience = await audienceFor(itemId, userId);
  if (!audience) return null;
  return many(
    `update messages set read_at = now()
      where item_id = $1 and recipient_id = $2 and read_at is null
      returning id`,
    [itemId, userId]
  );
}

/** Unread count across all of a user's threads, for a badge. */
async function unreadCount(userId) {
  const row = await one(
    'select count(*)::int as n from messages where recipient_id = $1 and read_at is null',
    [userId]
  );
  return row ? row.n : 0;
}

module.exports = { participants, audienceFor, threadFor, send, markRead, unreadCount };
