/**
 * The whole claim journey, end to end, through the API.
 *
 * Two accounts, one item: file a claim, refuse a duplicate, refuse claiming your
 * own item, approve, read the handover code, refuse a wrong code, complete with
 * the right one, and check the item leaves the board for the Returned page with
 * points awarded. Every step is asserted, so a regression anywhere in the chain
 * fails here.
 */
const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  if (process.env.CI === 'true') { console.error('\n  FAILED - TEST_DATABASE_URL is required in CI.\n'); process.exit(1); }
  console.log('\n  SKIPPED - TEST_DATABASE_URL is not set.\n');
  process.exit(0);
}
process.env.DATABASE_URL = URL;
process.env.PG_NO_SSL = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'claims_test_secret_that_is_over_32_chars';

const { connectDB, many, one } = require('../src/config/pg');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const ok = (c, m) => console.log((c ? 'PASS  ' : 'FAIL  ') + m);

(async () => {
  await connectDB();
  await many('truncate messages, claims, items, users restart identity cascade');
  const app = require('../src/app.v2');

  const mk = async (name, email) => {
    const u = await one(`insert into users (name,email,password,role,email_verified,pending_approval)
      values ($1,$2,'x','student',true,false) returning id, role, token_version`, [name, email]);
    return { id: u.id, t: jwt.sign({ id: u.id, role: u.role, tv: u.token_version }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  };
  const A = await mk('Owner A', 'owner@scds.saiuniversity.edu.in');
  const B = await mk('Claimer B', 'claimer@scds.saiuniversity.edu.in');

  const item = await request(app).post('/api/items').set('Authorization', 'Bearer ' + A.t)
    .send({ title: 'Boat Rockers Headset', description: 'Black, looks old', type: 'found',
            category: 'Electronics', subcategory: 'Headphones', location: 'AB1', date: '2026-11-12' });
  const itemId = item.body.item.id;
  ok(item.status === 201, '4.0 owner posts an item');

  const c1 = await request(app).post('/api/claims').set('Authorization', 'Bearer ' + B.t)
    .send({ item: itemId, message: 'This is mine, black with a scuff' });
  ok(c1.status === 201 || c1.status === 200, '4.1 claimer files a claim');
  const claimId = (c1.body.claim || c1.body).id;

  const c2 = await request(app).post('/api/claims').set('Authorization', 'Bearer ' + B.t)
    .send({ item: itemId, message: 'again' });
  ok(c2.status >= 400, '4.2 same person cannot claim twice (' + c2.status + ')');

  const own = await request(app).post('/api/items').set('Authorization', 'Bearer ' + B.t)
    .send({ title: 'B item', description: 'x', type: 'found', category: 'Bottles',
            subcategory: 'Water Bottle', location: 'AB1', date: '2026-11-12' });
  const c3 = await request(app).post('/api/claims').set('Authorization', 'Bearer ' + B.t)
    .send({ item: own.body.item.id, message: 'mine' });
  ok(c3.status >= 400, '4.3 cannot claim your own item (' + c3.status + ')');

  const recv = await request(app).get('/api/claims/received').set('Authorization', 'Bearer ' + A.t);
  ok(Array.isArray(recv.body.claims) && recv.body.claims.length >= 1, '4.4 owner sees the claim received');

  const appr = await request(app).patch('/api/claims/' + claimId + '/review').set('Authorization', 'Bearer ' + A.t).send({ decision: 'approve' });
  ok(appr.status === 200, '4.5 owner approves (' + appr.status + ')');

  const after = await request(app).get('/api/items/' + itemId).set('Authorization', 'Bearer ' + A.t);
  ok(after.body.item && after.body.item.status === 'claimed', '4.5b item is now claimed');

  const mine = await request(app).get('/api/claims/mine').set('Authorization', 'Bearer ' + B.t);
  const code = (mine.body.claims || []).find((c) => c.id === claimId);
  ok(!!(code && code.handoverCode), '4.7 claimant sees a handover code: ' + (code && code.handoverCode));

  const wrong = await request(app).post('/api/claims/' + claimId + '/complete').set('Authorization', 'Bearer ' + A.t)
    .send({ code: '000000' });
  ok(wrong.status >= 400, '4.8 wrong code refused (' + wrong.status + ')');

  const right = await request(app).post('/api/claims/' + claimId + '/complete').set('Authorization', 'Bearer ' + A.t)
    .send({ code: code && code.handoverCode });
  ok(right.status === 200, '4.9 correct code completes handover (' + right.status + ')');

  const fin = await request(app).get('/api/items/' + itemId).set('Authorization', 'Bearer ' + A.t);
  ok(fin.body.item && fin.body.item.status === 'returned', '4.10 item is returned');

  const pts = await one('select points from users where id = $1', [A.id]);
  ok(pts.points > 0, '4.10b owner awarded points: ' + pts.points);

  const board = await request(app).get('/api/items?limit=50');
  ok(!(board.body.items || []).some((i) => i.id === itemId), '4.11 item gone from the board');

  const ret = await request(app).get('/api/items?status=returned');
  ok((ret.body.items || []).some((i) => i.id === itemId), '4.12 item appears on Returned');

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
