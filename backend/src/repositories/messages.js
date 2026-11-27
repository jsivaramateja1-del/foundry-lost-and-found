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

  /* The claim itself is the first thing anyone says about an item, so it is
     part of the thread. Reading only the messages table made every thread look
     empty until someone typed a second line. */
  return many(
    `select * from (
       select m.id::text as id, m.item_id, m.sender_id, m.recipient_id, m.body,
              m.read_at, m.created_at, s.name as sender_name
         from messages m
         join users s on s.id = m.sender_id
        where m.item_id = $1
          and ((m.sender_id = $2 and m.recipient_id = $3)
            or (m.sender_id = $3 and m.recipient_id = $2))
       union all
       select c.id::text as id, c.item as item_id, c.claimant as sender_id,
              i.reported_by as recipient_id,
              coalesce(nullif(btrim(c.message), ''), 'Claimed this item') as body,
              null::timestamptz as read_at, c.created_at, u.name as sender_name
         from claims c
         join items i on i.id = c.item
         join users u on u.id = c.claimant
        where c.item = $1
          and c.claimant in ($2, $3)
     ) t
     order by t.created_at asc`,
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

/**
 * Every conversation this user is part of, newest first.
 *
 * This includes CLAIMS, not just chat messages. A claim carries a message the
 * claimant wrote, and that is often the only thing a person has said about an
 * item - so a conversations page that ignored claims looked empty even when the
 * user had clearly written something.
 */
async function myConversations(userId) {
  return many(
    `with pairs as (
       select m.item_id,
              case when m.sender_id = $1 then m.recipient_id else m.sender_id end as other_id,
              m.body, m.created_at, m.read_at, m.sender_id
         from messages m
        where m.sender_id = $1 or m.recipient_id = $1
       union all
       select c.item as item_id,
              case when c.claimant = $1 then i.reported_by else c.claimant end as other_id,
              coalesce(nullif(btrim(c.message), ''), 'Claimed this item') as body,
              c.created_at,
              null::timestamptz as read_at,
              c.claimant as sender_id
         from claims c
         join items i on i.id = c.item
        where (c.claimant = $1 or i.reported_by = $1)
     )
     select p.item_id,
            i.title as item_title,
            i.status as item_status,
            i.type as item_type,
            p.other_id,
            u.name as other_name,
            count(*)::int as message_count,
            max(p.created_at) as last_at,
            (array_agg(p.body order by p.created_at desc))[1] as last_body,
            count(*) filter (where p.sender_id <> $1 and p.read_at is null)::int as unread
       from pairs p
       join items i on i.id = p.item_id
       join users u on u.id = p.other_id
      group by p.item_id, i.title, i.status, i.type, p.other_id, u.name
      order by last_at desc
      limit 100`,
    [userId]
  );
}

module.exports.myConversations = myConversations;

/** Record that this user is typing on this item. Throttled by the caller. */
async function markTyping(itemId, userId) {
  await one(
    `insert into typing (item_id, user_id, updated_at) values ($1,$2,now())
     on conflict (item_id, user_id) do update set updated_at = now()`,
    [itemId, userId]
  );
}

/** Is anyone other than `userId` typing on this item in the last 5 seconds? */
async function typingOn(itemId, userId) {
  const row = await one(
    `select count(*)::int as n from typing
      where item_id = $1 and user_id <> $2 and updated_at > now() - interval '5 seconds'`,
    [itemId, userId]
  );
  return !!(row && row.n > 0);
}

module.exports.markTyping = markTyping;
module.exports.typingOn = typingOn;
