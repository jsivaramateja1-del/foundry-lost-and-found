/**
 * Creates the demo accounts the Postman collection and the viva need.
 *
 *   npm run seed:users
 *
 * Idempotent: running it twice updates the passwords rather than failing on the
 * unique email index. Every account is created verified and approved so it can
 * sign in immediately -- no email is sent, which is the point: this is for a
 * demonstration on a machine where Brevo may not be configured.
 *
 * The password comes from DEMO_PASSWORD, defaulting to a value that is only ever
 * acceptable for a local demo database. Do not run this against production with
 * the default.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { connectDB, one, closeDB } = require('../src/config/pg');

const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const DOMAIN = 'scds.saiuniversity.edu.in';

const USERS = [
  // The owner of the listing in the claim workflow.
  { name: 'Demo Student', email: `demo.student@${DOMAIN}`, role: 'student' },
  // The claimant -- a user cannot claim their own listing, so this one is needed.
  { name: 'Demo Other', email: `demo.other@${DOMAIN}`, role: 'student' },
  // Needed for every /api/admin request in the collection.
  { name: 'Demo Admin', email: `demo.admin@${DOMAIN}`, role: 'superadmin' }
];

(async () => {
  await connectDB();

  for (const u of USERS) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const existing = await one('select id from users where lower(email) = lower($1)', [u.email]);

    if (existing) {
      await one(
        // suspended_reason is NOT NULL DEFAULT '' -- writing null violates it.
        `update users set name = $2, password = $3, role = $4, email_verified = true,
                pending_approval = false, suspended = false, suspended_reason = ''
          where id = $1`,
        [existing.id, u.name, hash, u.role]);
      console.log(`  updated  ${u.email}  (${u.role})`);
    } else {
      await one(
        `insert into users (name, email, password, role, email_verified, pending_approval)
         values ($1, $2, $3, $4, true, false)`,
        [u.name, u.email, hash, u.role]);
      console.log(`  created  ${u.email}  (${u.role})`);
    }
  }

  await closeDB();
  console.log(`\nDone. Password for all three accounts: ${PASSWORD}`);
  console.log('Put these in the Postman environment before running the collection.\n');
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
