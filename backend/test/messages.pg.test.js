/**
 * Item conversations — authorisation against the real database.
 *
 * The interesting cases are the refusals: a stranger must not read a thread, a
 * participant must not address someone outside it, and nobody may message
 * themselves.
 */

const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  if (process.env.CI === 'true') { console.error('\n  FAILED - TEST_DATABASE_URL is required in CI.\n'); process.exit(1); }
  console.log('\n  SKIPPED - TEST_DATABASE_URL is not set.\n');
  process.exit(0);
}
process.env.DATABASE_URL = URL;
process.env.PG_NO_SSL = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'messages_test_secret_that_is_over_32_chars';

const app = require('../src/app.v2');
const { connectDB, many, one } = require('../src/config/pg');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS ', name); pass++; }
  catch (e) { console.log('  FAIL ', name, '::', e.message); fail++; }
}

const tok = (u) => jwt.sign({ id: u.id, role: u.role, tv: u.token_version }, process.env.JWT_SECRET, { expiresIn: '1h' });

async function user(email) {
  return one(`insert into users (name,email,password,role,email_verified,pending_approval)
              values ('Msg Tester',$1,'x','student',true,false)
              returning id, role, token_version`, [email]);
}

async function main() {
  await connectDB();
  await many('truncate messages, claims, items, users restart identity cascade');

  const reporter = await user('r@scds.saiuniversity.edu.in');
  const claimant = await user('c@scds.saiuniversity.edu.in');
  const stranger = await user('s@scds.saiuniversity.edu.in');
  const tr = tok(reporter), tc = tok(claimant), ts = tok(stranger);

  const item = await one(`insert into items (title,description,category,location,date,type,status,reported_by)
                          values ('Lost keys','d','Electronics','AB1','2026-11-01','lost','open',$1) returning id`, [reporter.id]);
  const otherItem = await one(`insert into items (title,description,category,location,date,type,status,reported_by)
                          values ('Other','d','Electronics','AB1','2026-11-01','lost','open',$1) returning id`, [reporter.id]);

  // the claimant holds a claim on the first item only
  await one(`insert into claims (item, claimant, message, status)
             values ($1,$2,'I think these are mine','pending') returning id`, [item.id, claimant.id]);

  console.log('\nItem conversations');

  await test('a stranger cannot read the thread', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${ts}`);
    assert.strictEqual(res.status, 403);
  });

  await test('the reporter can read an empty thread', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${tr}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.messages, []);
    assert.strictEqual(res.body.isReporter, true);
    assert.deepStrictEqual(res.body.canMessage, [claimant.id]);
  });

  await test('the claimant can read the thread and may address the reporter', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${tc}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isReporter, false);
    assert.deepStrictEqual(res.body.canMessage, [reporter.id]);
  });

  await test('the claimant can send to the reporter', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tc}`)
      .send({ recipientId: reporter.id, body: 'Hi, I think I found these.' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.message.body, 'Hi, I think I found these.');
  });

  await test('the reporter can reply', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tr}`)
      .send({ recipientId: claimant.id, body: 'Where did you find them?' });
    assert.strictEqual(res.status, 201);
  });

  await test('both messages appear in order', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${tr}`);
    assert.strictEqual(res.body.messages.length, 2);
    assert.match(res.body.messages[0].body, /I think I found/);
    assert.match(res.body.messages[1].body, /Where did you find/);
  });

  await test('a stranger cannot send', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ts}`)
      .send({ recipientId: reporter.id, body: 'hello' });
    assert.strictEqual(res.status, 403);
  });

  await test('a participant cannot address someone outside the thread', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tr}`)
      .send({ recipientId: stranger.id, body: 'hello' });
    assert.strictEqual(res.status, 400);
  });

  await test('nobody may message themselves', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tr}`)
      .send({ recipientId: reporter.id, body: 'note to self' });
    assert.strictEqual(res.status, 400);
  });

  await test('an empty body is refused', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tc}`)
      .send({ recipientId: reporter.id, body: '   ' });
    assert.strictEqual(res.status, 400);
  });

  await test('a 1001-character body is refused', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tc}`)
      .send({ recipientId: reporter.id, body: 'x'.repeat(1001) });
    assert.strictEqual(res.status, 400);
  });

  await test('a claim on another item grants no access here', async () => {
    const res = await request(app).get(`/api/items/${otherItem.id}/messages`).set('Authorization', `Bearer ${tc}`);
    assert.strictEqual(res.status, 403);
  });

  await test('unauthenticated access is refused', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`);
    assert.strictEqual(res.status, 401);
  });

  await test('reading the thread marks it read', async () => {
    const before = await one('select count(*)::int as n from messages where read_at is null and recipient_id = $1', [claimant.id]);
    await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${tc}`);
    const after = await one('select count(*)::int as n from messages where read_at is null and recipient_id = $1', [claimant.id]);
    assert.ok(after.n < before.n, `unread did not drop: ${before.n} -> ${after.n}`);
  });

  await test('deleting the item removes its messages', async () => {
    await many('delete from items where id = $1', [item.id]);
    const rows = await many('select id from messages where item_id = $1', [item.id]);
    assert.strictEqual(rows.length, 0);
  });

  await many('truncate messages, claims, items, users restart identity cascade');
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('suite crashed:', e.message); process.exit(1); });
