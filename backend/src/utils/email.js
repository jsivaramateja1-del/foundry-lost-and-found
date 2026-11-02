const crypto = require('crypto');

/**
 * Every rule about who is allowed to register lives here, in one place, as
 * plain functions with no database access — so they can be unit tested.
 *
 * There are four student domains, one per school, plus the faculty domain.
 * Nothing else is allowed, and no subdomain of these is allowed either.
 */

// Students, one domain per Sai University school
const STUDENT_DOMAINS = [
  'scds.saiuniversity.edu.in', // School of Computing and Data Science
  'sas.saiuniversity.edu.in',  // School of Arts and Sciences
  'sol.saiuniversity.edu.in',  // School of Law
  'sahs.saiuniversity.edu.in'  // School of Allied Health Sciences
];

// Faculty addresses use the parent domain
const FACULTY_DOMAINS = ['saiuniversity.edu.in'];

/**
 * The allowlist.
 *
 * ALLOWED_EMAIL_DOMAIN is a comma-separated override for a deployment that
 * needs different domains. When it is set it REPLACES the student list (it
 * does not add to it), and the faculty domain is only included if it is
 * listed explicitly — so a mistake in the environment cannot quietly widen
 * the rule.
 */
const configuredDomains = () => {
  const raw = process.env.ALLOWED_EMAIL_DOMAIN;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
  }
  return [...STUDENT_DOMAINS, ...FACULTY_DOMAINS];
};

/** Just the student domains, for display and for the registration hint. */
const studentDomains = () => {
  const raw = process.env.ALLOWED_EMAIL_DOMAIN;
  if (raw && String(raw).trim()) return configuredDomains();
  return STUDENT_DOMAINS;
};

const allowedDomains = () => configuredDomains();

/** The first allowed domain, kept for older clients that expect one value. */
const allowedDomain = () => allowedDomains()[0];

/** Lowercase and trim. Used before storing, comparing and looking up. */
const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * True only when the address belongs to exactly one of the allowed domains.
 *
 * The comparison is exact on purpose:
 *   student@scds.saiuniversity.edu.in          -> allowed
 *   STUDENT@SAS.SAIUNIVERSITY.EDU.IN           -> allowed (case-insensitive)
 *   student@saiuniversity.edu.in               -> allowed (faculty domain)
 *   student@gmail.com                          -> refused
 *   student@sai.edu                            -> refused
 *   student@scds.saiuniversity.edu.in.evil.com -> refused (suffix trick)
 *   student@sub.scds.saiuniversity.edu.in      -> refused (subdomain)
 */
const isAllowedEmail = (value, domains = allowedDomains()) => {
  const email = normaliseEmail(value);
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const emailDomain = email.slice(at + 1);
  const list = Array.isArray(domains) ? domains : [domains];
  return list.map((d) => String(d).toLowerCase()).includes(emailDomain);
};

/** True when the address is on the faculty (parent) domain. */
const isFacultyEmail = (value) => isAllowedEmail(value, FACULTY_DOMAINS);

/** The message shown to anyone who tries a different domain. */
const emailDomainError = (domains = studentDomains()) =>
  `Registration is limited to Sai University addresses. Use one of: ${domains.map((d) => `@${d}`).join(', ')}.`;

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
  STUDENT_DOMAINS,
  FACULTY_DOMAINS,
  allowedDomain,
  allowedDomains,
  studentDomains,
  normaliseEmail,
  isAllowedEmail,
  isFacultyEmail,
  emailDomainError,
  createVerificationToken,
  hashVerificationToken,
  verificationExpiry,
  VERIFICATION_HOURS,
  emailVerificationEnabled
};
