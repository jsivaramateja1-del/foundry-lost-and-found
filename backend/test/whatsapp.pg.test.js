/**
 * WhatsApp opt-in routes — integration tests against the real database.
 *
 * Proves the consent lifecycle and the authorisation boundaries. It does not
 * prove a message is delivered: WHATSAPP_TOKEN is never set here, so every
 * send path short-circuits.
 */

const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'whatsapp_test_secret_that_is_over_32_chars';

const app = require('../src/app.v2');
const { connectDB, many, one } = require('../src/config/pg');

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  PASS ', name);
    pass += 1;
  } catch (err) {
    console.log('  FAIL ', name, '::', err.message);
    fail += 1;
  }
}

const tokenFor = (user) => jwt.sign(
  { id: user.id, role: user.role, tv: user.token_version },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

async function makeUser(email) {
  return one(
    `insert into users (name, email, password, role, email_verified, pending_approval)
     values ('WA Tester', $1, 'x', 'student', true, false)
     returning id, role, token_version`,
    [email]
  );
}

async function main() {
  await connectDB();
  await many('truncate whatsapp_subscriptions, users restart identity cascade');

  const a = await makeUser('wa-a@scds.saiuniversity.edu.in');
  const b = await makeUser('wa-b@scds.saiuniversity.edu.in');
  const ta = tokenFor(a);
  const tb = tokenFor(b);

  console.log('\nWhatsApp opt-in');

  await test('unauthenticated GET is refused', async () => {
    const res = await request(app).get('/api/whatsapp');
    assert.strictEqual(res.status, 401);
  });

  await test('a fresh user is not subscribed', async () => {
    const res = await request(app).get('/api/whatsapp').set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.subscribed, false);
    assert.strictEqual(res.body.phone, null);
  });

  await test('available is false when no credentials are configured', async () => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_ID;
    const res = await request(app).get('/api/whatsapp').set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.body.available, false);
  });

  await test('opting in is refused with 503 while unconfigured', async () => {
    const res = await request(app).post('/api/whatsapp')
      .set('Authorization', `Bearer ${ta}`)
      .send({ phone: '919876543210' });
    assert.strictEqual(res.status, 503);
  });

  // Turn the feature on for the rest of the run.
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_ID = '1234567890';

  await test('a malformed number is rejected with 400', async () => {
    const res = await request(app).post('/api/whatsapp')
      .set('Authorization', `Bearer ${ta}`)
      .send({ phone: '123' });
    assert.strictEqual(res.status, 400);
  });

  await test('a valid number subscribes and is stored normalised', async () => {
    const res = await request(app).post('/api/whatsapp')
      .set('Authorization', `Bearer ${ta}`)
      .send({ phone: '+91 98765 43210' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.subscribed, true);
    assert.strictEqual(res.body.phone, '919876543210');
  });

  await test('GET now reports the subscription', async () => {
    const res = await request(app).get('/api/whatsapp').set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.body.subscribed, true);
    assert.strictEqual(res.body.phone, '919876543210');
    assert.strictEqual(res.body.available, true);
  });

  await test('another user cannot take the same number', async () => {
    const res = await request(app).post('/api/whatsapp')
      .set('Authorization', `Bearer ${tb}`)
      .send({ phone: '919876543210' });
    assert.strictEqual(res.status, 409);
  });

  await test('a user only ever sees their own number', async () => {
    const res = await request(app).get('/api/whatsapp').set('Authorization', `Bearer ${tb}`);
    assert.strictEqual(res.body.subscribed, false);
    assert.strictEqual(res.body.phone, null);
  });

  await test('a second user can subscribe with a different number', async () => {
    const res = await request(app).post('/api/whatsapp')
      .set('Authorization', `Bearer ${tb}`)
      .send({ phone: '919876543211' });
    assert.strictEqual(res.status, 201);
  });

  await test('re-subscribing updates rather than duplicating', async () => {
    const res = await request(app).post('/api/whatsapp')
      .set('Authorization', `Bearer ${ta}`)
      .send({ phone: '919876543299' });
    assert.strictEqual(res.status, 201);
    const rows = await many('select user_id from whatsapp_subscriptions where user_id = $1', [a.id]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(res.body.phone, '919876543299');
  });

  await test('the subscriber list carries both users', async () => {
    const rows = await many('select user_id from whatsapp_subscriptions');
    assert.strictEqual(rows.length, 2);
  });

  await test('opting out removes the row', async () => {
    const res = await request(app).delete('/api/whatsapp').set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.subscribed, false);
    const rows = await many('select user_id from whatsapp_subscriptions where user_id = $1', [a.id]);
    assert.strictEqual(rows.length, 0);
  });

  await test('opting out twice is not an error', async () => {
    const res = await request(app).delete('/api/whatsapp').set('Authorization', `Bearer ${ta}`);
    assert.strictEqual(res.status, 200);
  });

  await test('deleting a user removes their consent', async () => {
    await many('delete from users where id = $1', [b.id]);
    const rows = await many('select user_id from whatsapp_subscriptions where user_id = $1', [b.id]);
    assert.strictEqual(rows.length, 0);
  });

  await many('truncate whatsapp_subscriptions, users restart identity cascade');
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('suite crashed:', err.message);
  process.exit(1);
});
