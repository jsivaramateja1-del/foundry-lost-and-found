/**
 * Stage B/C verification against a real PostgreSQL database.
 *
 * Proves the fixes that cannot be shown by unit test alone: logout revocation,
 * self-verification prevention for every role, reporter-UUID privacy, upload
 * magic-byte validation, and the registration response no longer revealing
 * whether an address exists.
 *
 *   TEST_DATABASE_URL=postgres://... node test/stageBC.pg.test.js
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration_secret_only_for_tests';
const request = require('supertest');
const crypto = require('crypto');

const URL = process.env.TEST_DATABASE_URL;
let pass = 0, fail = 0;
const results = [];
const ck = (n, c, d = '') => {
  if (c) { pass++; results.push(`  PASS  ${n}`); }
  else { fail++; results.push(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
};
if (!URL) {
  console.log('\n  SKIPPED — TEST_DATABASE_URL is not set.\n0 passed, 0 failed, SUITE SKIPPED\n');
  process.exit(0);
}
process.env.DATABASE_URL = URL;
process.env.PG_NO_SSL = 'true';
const { connectDB, many, one } = require('../src/config/pg');

const email = (n) => `${n}@scds.saiuniversity.edu.in`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('IHDR-body')]);
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('JFIF-body')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 body')]);
const uri = (mime, buf) => `data:image/${mime};base64,${buf.toString('base64')}`;

async function makeUser(app, users, name, role) {
  const pw = 'secret123';
  await request(app).post('/api/auth/register').send({ name, email: email(name), password: pw });
  const row = await users.findByEmail(email(name));
  const tok = crypto.randomBytes(32).toString('hex');
  await users.setVerificationToken(row.id, crypto.createHash('sha256').update(tok).digest('hex'), new Date(Date.now() + 60000));
  await request(app).get(`/api/auth/verify?token=${tok}`);
  if (role) await one('update users set role = $1 where id = $2 returning id', [role, row.id]);
  const login = await request(app).post('/api/auth/login').send({ email: email(name), password: pw });
  return { id: row.id, token: login.body.token, name };
}

(async () => {
  try {
    await connectDB();
    await many('truncate users, items, claims, notifications, point_events, reports, campus_locations restart identity cascade');
    const app = require('../src/app.v2');
    const users = require('../src/repositories/users');

    /* ---- B-1 logout revokes ---- */
    const alice = await makeUser(app, users, 'alice', null);
    ck('B-1 sign-in issues a token', Boolean(alice.token));
    ck('B-1 the token works before logout', (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${alice.token}`)).status === 200);
    ck('B-1 logout returns 200', (await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${alice.token}`)).status === 200);
    ck('B-1 the SAME token is rejected after logout (401)',
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${alice.token}`)).status === 401);
    const re = await request(app).post('/api/auth/login').send({ email: email('alice'), password: 'secret123' });
    ck('B-1 the new token works', (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${re.body.token}`)).status === 200);
    const bob = await makeUser(app, users, 'bob', null);
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${re.body.token}`);
    ck("B-1 another user's session survives someone else's logout",
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bob.token}`)).status === 200);

    /* ---- B-12 registration is not enumerable ---- */
    const again = await request(app).post('/api/auth/register').send({ name: 'Alice', email: email('alice'), password: 'secret123' });
    ck('B-12 a duplicate registration returns the same status as a new one (201)', again.status === 201, `got ${again.status}`);
    ck('B-12 the duplicate response does not confirm the account exists',
      !/already exists/i.test(JSON.stringify(again.body)), JSON.stringify(again.body).slice(0, 80));

    /* ---- B-2 self-verification blocked for every role ---- */
    for (const r of ['student', 'faculty', 'moderator', 'admin', 'superadmin']) {
      const u = await makeUser(app, users, `self${r}`, r);
      const created = await request(app).post('/api/items').set('Authorization', `Bearer ${u.token}`)
        .send({ title: `${r} keys`, description: 'found', category: 'Other', customCategory: 'Misc', location: 'AB1', type: 'found', date: '2026-11-10' });
      ck(`B-2 a ${r} can create a found listing`, created.status === 201, `got ${created.status}`);
      const id = created.body.item.id;
      ck(`B-2 a ${r} cannot verify their own listing (403)`,
        (await request(app).patch(`/api/admin/items/${id}/verify`).set('Authorization', `Bearer ${u.token}`)).status === 403);
      const pts = await one(`select coalesce(sum(points),0)::int p from point_events where user_id=$1 and event_key like 'found:%'`, [u.id]);
      ck(`B-2 no points for the ${r}'s rejected self-verification`, pts.p === 0, `p=${pts.p}`);
    }

    /* ---- legitimate verification still works, once ---- */
    const owner = await makeUser(app, users, 'owner1', null);
    const it = await request(app).post('/api/items').set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'owner keys', description: 'found', category: 'Other', customCategory: 'Misc', location: 'AB2', type: 'found', date: '2026-11-10' });
    const iid = it.body.item.id;
    const mod = await makeUser(app, users, 'mod1', 'moderator');
    ck('B-2 a moderator CAN verify someone else\'s listing',
      (await request(app).patch(`/api/admin/items/${iid}/verify`).set('Authorization', `Bearer ${mod.token}`)).status === 200);
    const p1 = await one(`select coalesce(sum(points),0)::int p from point_events where user_id=$1 and event_key=$2`, [owner.id, `found:${iid}`]);
    ck('B-2 the owner is credited', p1.p > 0, `p=${p1.p}`);
    ck('B-2 a second verify is refused',
      (await request(app).patch(`/api/admin/items/${iid}/verify`).set('Authorization', `Bearer ${mod.token}`)).status >= 400);
    const p2 = await one(`select coalesce(sum(points),0)::int p from point_events where user_id=$1 and event_key=$2`, [owner.id, `found:${iid}`]);
    ck('B-9 points awarded exactly once', p1.p === p2.p, `${p1.p} vs ${p2.p}`);

    /* ---- B-3 reporter UUID privacy ---- */
    ck('B-3 the anonymous list exposes no reportedBy',
      !(await request(app).get('/api/items')).body.items.some((i) => i.reportedBy !== undefined));
    ck('B-3 the anonymous detail exposes no reportedBy',
      (await request(app).get(`/api/items/${iid}`)).body.item.reportedBy === undefined);
    ck('B-3 the owner receives reportedBy on their own listing',
      (await request(app).get(`/api/items/${iid}`).set('Authorization', `Bearer ${owner.token}`)).body.item.reportedBy === owner.id);
    ck('B-3 a different authenticated user does not',
      (await request(app).get(`/api/items/${iid}`).set('Authorization', `Bearer ${mod.token}`)).body.item.reportedBy === undefined);

    /* ---- B-15 upload magic bytes ---- */
    const base = { title: 'Upload test', description: 'd', category: 'Other', customCategory: 'M', location: 'AB1', type: 'found', date: '2026-11-10' };
    const send = (img) => request(app).post('/api/items').set('Authorization', `Bearer ${owner.token}`).send({ ...base, imageUrl: img });
    ck('B-15 a valid PNG is accepted', (await send(uri('png', PNG))).status === 201);
    ck('B-15 a valid JPEG is accepted', (await send(uri('jpeg', JPG))).status === 201);
    ck('B-15 a valid WebP is accepted', (await send(uri('webp', WEBP))).status === 201);
    ck('B-15 arbitrary bytes labelled PNG are rejected', (await send(uri('png', Buffer.from('not an image')))).status === 400);
    ck('B-15 JPEG bytes labelled PNG are rejected', (await send(uri('png', JPG))).status === 400);
    ck('B-15 a listing with no photo is accepted', (await send('')).status === 201);

    /* ---- B-11 a returned listing cannot be reopened ---- */
    ck('B-11 a returned listing refuses reopening to open',
      await (async () => {
        await one(`update items set status='returned' where id=$1 returning id`, [iid]);
        const r = await request(app).patch(`/api/items/${iid}/status`).set('Authorization', `Bearer ${mod.token}`).send({ status: 'open' });
        return r.status === 403;
      })());

    console.log(results.join('\n'));
    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('SUITE ERROR:', e.message);
    console.log(results.join('\n'));
    console.log(`\n  ${pass} passed, ${fail} failed (aborted)`);
    process.exit(1);
  }
})();
