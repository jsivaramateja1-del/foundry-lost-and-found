/**
 * User persistence on PostgreSQL.
 *
 * Every query here is parameterised — no string concatenation ever reaches the
 * database, which removes the whole class of injection the Mongo filter code
 * had to defend against by hand.
 *
 * Column names are snake_case in Postgres and camelCase in JS; the two mappers
 * at the bottom are the only place that translation happens.
 */
const { one, many } = require('../config/pg');

const toUser = (row) => row && {
  id: row.id,
  name: row.name,
  email: row.email,
  password: row.password,
  role: row.role,
  points: row.points,
  returns: row.returns,
  leaderboardOptOut: row.leaderboard_opt_out,
  emailVerified: row.email_verified,
  pendingApproval: row.pending_approval,
  approvalNote: row.approval_note,
  suspended: row.suspended,
  suspendedReason: row.suspended_reason,
  suspendedUntil: row.suspended_until,
  verificationTokenHash: row.verification_token_hash,
  verificationTokenExpires: row.verification_token_expires,
  resetTokenHash: row.reset_token_hash,
  resetTokenExpires: row.reset_token_expires,
  tokenVersion: row.token_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at
};

/** What is safe to send to a client. Never includes the password or tokens. */
const toSafeObject = (user) => user && {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  points: user.points,
  returns: user.returns,
  leaderboardOptOut: user.leaderboardOptOut,
  emailVerified: user.emailVerified,
  pendingApproval: user.pendingApproval,
  // The admin table renders a suspended badge and picks Suspend vs Reinstate
  // from this flag, so omitting it silently broke both.
  suspended: user.suspended,
  suspendedReason: user.suspendedReason,
  createdAt: user.createdAt
};

const findByEmail = async (email) =>
  toUser(await one('select * from users where lower(email) = lower($1)', [email]));

const findById = async (id) =>
  toUser(await one('select * from users where id = $1', [id]));

const findByIdWithSecrets = async (id) =>
  toUser(await one('select * from users where id = $1', [id]));

/**
 * Inserts a user. Returns null when the email already exists — the unique index
 * raises 23505 and we translate it, rather than doing a check-then-insert race.
 */
const create = async ({ name, email, password, role = 'student', pendingApproval = false }) => {
  try {
    const row = await one(
      `insert into users (name, email, password, role, pending_approval, email_verified)
       values ($1, lower($2), $3, $4, $5, false)
       returning *`,
      [name, email, password, role, pendingApproval]
    );
    return toUser(row);
  } catch (err) {
    if (err.code === '23505') return null;
    throw err;
  }
};

const markVerified = async (id) =>
  toUser(await one(
    `update users
        set email_verified = true,
            verification_token_hash = null,
            verification_token_expires = null
      where id = $1
      returning *`, [id]));

const setVerificationToken = async (id, hash, expires) =>
  one(`update users set verification_token_hash = $2, verification_token_expires = $3
        where id = $1 returning id`, [id, hash, expires]);

const findByVerificationHash = async (hash) =>
  toUser(await one(
    `select * from users
      where verification_token_hash = $1 and verification_token_expires > now()`, [hash]));

const setResetToken = async (id, hash, expires) =>
  one(`update users set reset_token_hash = $2, reset_token_expires = $3
        where id = $1 returning id`, [id, hash, expires]);

const findByResetHash = async (hash) =>
  toUser(await one(
    `select * from users
      where reset_token_hash = $1 and reset_token_expires > now()`, [hash]));

/** Sets the new password AND retires every existing session in one statement. */
const setPasswordAndBumpVersion = async (id, hash) =>
  toUser(await one(
    `update users
        set password = $2,
            reset_token_hash = null,
            reset_token_expires = null,
            token_version = token_version + 1
      where id = $1
      returning *`, [id, hash]));

const approve = async (id) =>
  toUser(await one(
    `update users set pending_approval = false, suspended = false, approval_note = ''
      where id = $1 returning *`, [id]));

const reject = async (id, note) =>
  toUser(await one(
    `update users set pending_approval = false, suspended = true, suspended_reason = $2,
                      approval_note = $2
      where id = $1 returning *`, [id, note]));

module.exports = {
  toUser, toSafeObject,
  findByEmail, findById, findByIdWithSecrets, create,
  markVerified, setVerificationToken, findByVerificationHash,
  setResetToken, findByResetHash, setPasswordAndBumpVersion,
  approve, reject
};
