const crypto = require('crypto');

/**
 * Every rule about who is allowed to register lives here, in one place, as
 * plain functions with no database access — so they can be unit tested.
 */

// The only student domain. It can be overridden with an environment variable,
// but it is never widened automatically: no extra domains, no subdomains.
const DEFAULT_DOMAIN = 'scds.saiuniversity.edu.in';

const allowedDomain = () =>
  String(process.env.ALLOWED_EMAIL_DOMAIN || DEFAULT_DOMAIN)
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

/** Lowercase and trim. Used before storing, comparing and looking up. */
const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * True only when the address belongs to exactly the allowed domain.
 *
 * The comparison is exact on purpose:
 *   student@scds.saiuniversity.edu.in          -> allowed
 *   STUDENT@SCDS.SAIUNIVERSITY.EDU.IN          -> allowed (case-insensitive)
 *   student@saiuniversity.edu.in               -> refused (different domain)
 *   student@scds.saiuniversity.edu.in.evil.com -> refused (suffix trick)
 *   student@sub.scds.saiuniversity.edu.in      -> refused (subdomain)
 */
const isAllowedEmail = (value, domain = allowedDomain()) => {
  const email = normaliseEmail(value);
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const emailDomain = email.slice(at + 1);
  return emailDomain === String(domain).toLowerCase();
};

/** The message shown to anyone who tries a different domain. */
const emailDomainError = (domain = allowedDomain()) =>
  `Only Sai University addresses ending in @${domain} can register.`;

/* ---------------- email verification tokens ---------------- */

/**
 * A verification token is sent to the user and only its SHA-256 hash is
 * stored, so a database leak cannot be used to verify somebody else's address.
 */
const createVerificationToken = () => crypto.randomBytes(32).toString('hex');

const hashVerificationToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

const VERIFICATION_HOURS = 24;

const verificationExpiry = () =>
  new Date(Date.now() + VERIFICATION_HOURS * 60 * 60 * 1000);

/** Verification is off unless an administrator turns it on AND configures SMTP. */
const emailVerificationEnabled = () =>
  String(process.env.EMAIL_VERIFICATION || '').toLowerCase() === 'enabled';

module.exports = {
  DEFAULT_DOMAIN,
  allowedDomain,
  normaliseEmail,
  isAllowedEmail,
  emailDomainError,
  createVerificationToken,
  hashVerificationToken,
  verificationExpiry,
  VERIFICATION_HOURS,
  emailVerificationEnabled
};
