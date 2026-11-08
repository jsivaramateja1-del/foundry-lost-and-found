/**
 * Creates or promotes an administrator in PostgreSQL.
 *
 * This is the PostgreSQL replacement for scripts/create-admin.js, which still
 * uses Mongoose and cannot touch Supabase.
 *
 *   node scripts/create-admin-pg.js <email> [role]
 *
 * Role defaults to superadmin. If the address already exists it is promoted and
 * marked verified rather than duplicated. Prints nothing secret.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { connectDB, one, closeDB } = require('../src/config/pg');

const ROLES = ['student', 'moderator', 'admin', 'superadmin'];

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const role = String(process.argv[3] || 'superadmin').trim().toLowerCase();

  if (!email) {
    console.error('Usage: node scripts/create-admin-pg.js <email> [role]');
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Role must be one of: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  try {
    await connectDB();

    const existing = await one('select id, email, role from users where lower(email) = $1', [email]);
    if (existing) {
      await one(
        `update users set role = $2, email_verified = true, pending_approval = false,
                          suspended = false
          where id = $1`, [existing.id, role]);
      console.log(`Promoted existing account ${email} to ${role} (email marked verified).`);
    } else {
      // A random password: the operator sets a real one through the reset flow.
      const temp = crypto.randomBytes(24).toString('base64url');
      const hash = await bcrypt.hash(temp, 10);
      await one(
        `insert into users (name, email, password, role, email_verified, pending_approval)
         values ($1, $2, $3, $4, true, false)`,
        [email.split('@')[0], email, hash, role]);
      console.log(`Created ${role} ${email} with a random password.`);
      console.log('Use "forgot password" on the sign-in page to set your own.');
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDB().catch(() => {});
  }
})();
