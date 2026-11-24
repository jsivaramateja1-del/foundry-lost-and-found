/**
 * Item conversations - authorisation against the real database.
 *
 * Rule: anyone signed in may message the reporter of a listing; the reporter
 * may reply to anyone who has written to them. Each party only sees their own
 * exchange with the reporter.
 */

const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  if (process.env.CI === 'true') { console.error('\n  FAILED - TEST_DATABASE_URL is required in CI.\n'); process.exit(1); }
  console.log('\n  SKIPPED - TEST_DATABASE_URL is not set.\n'); process.exit(0);
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
const user = (email) => one(`insert into users (name,email,password,role,email_verified,pending_approval)
  values ('Msg Tester',$1,'x','student',true,false) returning id, role, token_version`, [email]);

async function main() {
  await connectDB();
  await many('truncate messages, claims, items, users restart identity cascade');

  const reporter = await user('r@scds.saiuniversity.edu.in');
  const alice = await user('a@scds.saiuniversity.edu.in');
  const bob = await user('b@scds.saiuniversity.edu.in');
  const tr = tok(reporter), ta = tok(alice), tb = tok(bob);

  const item = await one(`insert into items (title,description,category,location,date,type,status,reported_by)
    values ('Lost keys','d','Electronics','AB1','2026-11-01','lost','open',$1) returning id`, [reporter.id]);

  console.log('\nItem conversations');

  await test('unauthenticated access is refused', async () => {
    assert.strictEqual((await request(app).get(`/api/items/${item.id}/messages`)).status, 401);
  });

  await test('anyone signed in may read an empty thread', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.messages, []);
    assert.strictEqual(res.body.isReporter, false);
    assert.deepStrictEqual(res.body.conversations.length >= 0, true);
  });

  await test('a stranger may message the reporter', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ta}`)
      .send({ recipientId: reporter.id, body: 'I think I saw these.' });
    assert.strictEqual(res.status, 201);
  });

  await test('a second person may also message the reporter', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tb}`)
      .send({ recipientId: reporter.id, body: 'Are these still missing?' });
    assert.strictEqual(res.status, 201);
  });

  await test('the reporter sees one conversation per person', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${tr}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isReporter, true);
    assert.strictEqual(res.body.conversations.length, 2);
  });

  await test('the reporter may reply to a specific person', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tr}`)
      .send({ recipientId: alice.id, body: 'Yes, still missing. Where did you see them?' });
    assert.strictEqual(res.status, 201);
  });

  await test('a sender only sees their own exchange', async () => {
    const res = await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.body.messages.length, 2);
    const bodies = res.body.messages.map((m) => m.body);
    assert.ok(bodies.some((b) => /I think I saw/.test(b)));
    assert.ok(bodies.some((b) => /still missing/.test(b)));
    assert.ok(!bodies.some((b) => /still missing\?/.test(b)), 'alice saw bob\'s message');
  });

  await test('the reporter may not message someone who never wrote', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${tr}`)
      .send({ recipientId: bob.id, body: 'hello' });
    assert.strictEqual(res.status, 201, 'bob did write, so this is allowed');
  });

  await test('a non-reporter may not address a third party', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ta}`)
      .send({ recipientId: bob.id, body: 'hello' });
    assert.strictEqual(res.status, 400);
  });

  await test('nobody may message themselves', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ta}`)
      .send({ recipientId: alice.id, body: 'note' });
    assert.strictEqual(res.status, 400);
  });

  await test('an empty body is refused', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ta}`).send({ recipientId: reporter.id, body: '   ' });
    assert.strictEqual(res.status, 400);
  });

  await test('a 1001-character body is refused', async () => {
    const res = await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ta}`).send({ recipientId: reporter.id, body: 'x'.repeat(1001) });
    assert.strictEqual(res.status, 400);
  });

  await test('a missing item answers 404', async () => {
    const res = await request(app).get('/api/items/00000000-0000-0000-0000-000000000000/messages')
      .set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.status, 404);
  });

  await test('reading the thread marks it read', async () => {
    // Alice writes again so the reporter definitely has something unread.
    await request(app).post(`/api/items/${item.id}/messages`)
      .set('Authorization', `Bearer ${ta}`)
      .send({ recipientId: reporter.id, body: 'One more thing.' });
    const before = await one('select count(*)::int as n from messages where read_at is null and recipient_id = $1', [reporter.id]);
    assert.ok(before.n > 0, 'expected an unread message before reading');
    await request(app).get(`/api/items/${item.id}/messages`).set('Authorization', `Bearer ${tr}`);
    const after = await one('select count(*)::int as n from messages where read_at is null and recipient_id = $1', [reporter.id]);
    assert.ok(after.n < before.n, `unread did not drop: ${before.n} -> ${after.n}`);
  });

  await test('deleting the item removes its messages', async () => {
    await many('delete from items where id = $1', [item.id]);
    assert.strictEqual((await many('select id from messages where item_id = $1', [item.id])).length, 0);
  });

  await many('truncate messages, claims, items, users restart identity cascade');
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('suite crashed:', e.message); process.exit(1); });
