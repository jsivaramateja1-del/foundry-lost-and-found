/**
 * Authentication on PostgreSQL.
 *
 * Domain rule: an address on the parent domain itself (saiuniversity.edu.in,
 * no subdomain) registers as a PENDING FACULTY APPLICATION; any school
 * subdomain registers as a student. A pending account cannot sign in until an
 * administrator approves it, and an approved faculty account gains no staff
 * powers — it can do exactly what a student can.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const users = require('../repositories/users');
const mailer = require('../lib/brevo');
const { protect } = require('../middleware/auth.v2');

const router = express.Router();

const PARENT_DOMAIN = 'saiuniversity.edu.in';
const appUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/+$/, '');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');

/**
 * True when the address is on the parent domain itself, with no subdomain.
 * School addresses (scds., sas., sol., sahs.) are students; staff sit on the
 * parent domain. This mirrors isFacultyEmail in the retired Mongo code.
 */
const isFacultyEmail = (email) => {
  const at = String(email || '').toLowerCase().lastIndexOf('@');
  if (at < 1) return false;
  return String(email).toLowerCase().slice(at + 1) === PARENT_DOMAIN;
};

/** True for saiuniversity.edu.in itself or any subdomain of it — never a lookalike. */
const isUniversityEmail = (email) => {
  const at = String(email || '').toLowerCase().lastIndexOf('@');
  if (at < 1) return false;
  const domain = String(email).toLowerCase().slice(at + 1);
  return domain === PARENT_DOMAIN || domain.endsWith('.' + PARENT_DOMAIN);
};

/**
 * Password policy.
 *
 * bcrypt silently truncates its input at 72 bytes, so anything past that is not
 * part of the password — a 100-character passphrase and its first 72 bytes are
 * the same credential. Measuring UTF-8 bytes (not JavaScript characters) means a
 * multibyte password is judged on what bcrypt actually sees.
 *
 * The minimum stays at 8 characters; the maximum is enforced so the stated
 * policy matches the stored reality.
 */
const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_BYTES = 72;

const passwordProblem = (password) => {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_CHARS) {
    return `Password must be at least ${PASSWORD_MIN_CHARS} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} characters)`;
  }
  return null;
};

const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role, tv: user.tokenVersion },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const publicUser = (u) => ({ ...users.toSafeObject(u), leaderboardOptOut: u.leaderboardOptOut });

/**
 * Rate-limit bucket key.
 *
 * Login and register both trim and lowercase the email before looking the
 * account up. The limiter must normalise identically, or one account has two
 * keys: "victim@x.edu" and "victim@x.edu " landed in different buckets, so a
 * trailing space bought a fresh allowance of 20 attempts and password guessing
 * against one account was effectively unlimited. Exported so it is testable.
 */
function rateLimitKey(req) {
  const b = (req && req.body) || {};
  const who = b.email
    ? String(b.email).trim().toLowerCase()
    : String(b.token || '').trim().slice(-16) || 'anon';
  const ip = (req && req.ip) || 'unknown';
  return `${ip}:${who}`;
}

/**
 * Authentication rate limiting, three layers.
 *
 * A single `ip:account` bucket protects one account from one network, but it
 * leaves two holes:
 *
 *   - an attacker with a proxy pool gets a fresh 20 attempts per address
 *     against the same account, so there is no account-wide ceiling at all;
 *   - one address can work through an unlimited number of accounts, because
 *     each account is a separate bucket.
 *
 * So three buckets are mounted together. A request must pass all three.
 *
 *   1. ip:account  (20 / 15 min) — the original, unchanged. Stops ordinary
 *      guessing against one account from one place.
 *   2. account only (20 / 15 min) — closes the proxy-pool hole. A real student
 *      never types their password 20 times in a quarter of an hour.
 *   3. ip only (120 / 15 min) — closes the spray hole. Deliberately six times
 *      the account limit, because a whole campus shares one NAT address and a
 *      tight per-IP cap is exactly what locks out a lecture hall.
 *
 * All three are configurable so the limits can be tuned without a code change.
 */
const WINDOW_MS = 15 * 60 * 1000;
const positiveInt = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};

const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: positiveInt('RATE_LIMIT_AUTH_MAX', 20),
  standardHeaders: true,
  legacyHeaders: false,
  // A campus sits behind one NAT address, so an IP-only key meant twenty students
  // mistyping a password locked out everyone else — on exactly the network this
  // ships to. Keying on ip + account keeps brute-force protection per account
  // while letting every student sign in.
  keyGenerator: rateLimitKey,
  message: { message: 'Too many attempts. Please try again in a few minutes.' }
});

/**
 * Account-wide ceiling, independent of where the request comes from.
 *
 * Uses the same normalisation as `rateLimitKey` (trim + lowercase) so a
 * trailing space or different casing cannot mint a fresh bucket. Falls back to
 * the token, then to a shared 'anon' bucket, so a request with no email is
 * still counted rather than escaping the limiter.
 */
const authAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: positiveInt('RATE_LIMIT_AUTH_ACCOUNT_MAX', 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const b = (req && req.body) || {};
    const who = b.email
      ? String(b.email).trim().toLowerCase()
      : `token:${String(b.token || '').trim().slice(-16) || 'anon'}`;
    return who;
  },
  message: { message: 'Too many attempts. Please try again in a few minutes.' }
});

/**
 * Per-network ceiling across every account.
 *
 * Generous on purpose: this exists to stop one address spraying thousands of
 * accounts, not to police a shared campus connection.
 */
const authIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: positiveInt('RATE_LIMIT_AUTH_IP_MAX', 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts from this network. Please try again in a few minutes.' }
});

/** All three, in the order a request must pass them. */
const authLimits = [authIpLimiter, authAccountLimiter, authLimiter];

/** GET /api/auth/config — what the browser needs to validate before submitting. */
router.get('/config', (req, res) => {
  res.status(200).json({
    universityDomain: PARENT_DOMAIN,
    emailVerification: true,
    // Lets the UI and the operator see at a glance whether mail can actually be
    // sent. Without this, a missing key looks like "signup silently does nothing".
    emailConfigured: Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER),
    // Kept for the existing client, which validates against these lists.
    // The client validates with an exact match, so it needs the concrete
    // school subdomains as well as the parent domain.
    allowedEmailDomains: [PARENT_DOMAIN, 'scds.' + PARENT_DOMAIN, 'sas.' + PARENT_DOMAIN,
                          'sol.' + PARENT_DOMAIN, 'sahs.' + PARENT_DOMAIN],
    facultyDomains: [PARENT_DOMAIN]
  });
});

/** POST /api/auth/register */
router.post('/register', ...authLimits, async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
    if (!isUniversityEmail(email)) {
      return res.status(400).json({ message: `Register with your Sai University address (@${PARENT_DOMAIN})` });
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ message: pwProblem });

    // Staff are not self-service: a faculty address creates a pending
    // application that an administrator must approve before it can be used.
    const faculty = isFacultyEmail(email);

    const hash = await bcrypt.hash(password, 10);
    const user = await users.create({
      name, email, password: hash,
      role: faculty ? 'faculty' : 'student',
      pendingApproval: faculty
    });
    // Registration must not reveal whether an address already has an account.
    //
    // This used to answer 409 "An account with that email already exists",
    // which let anyone test a list of university addresses for membership. The
    // response is now identical in shape and status to a successful sign-up.
    //
    // The wording is deliberately true in both cases: it does NOT claim an
    // email was sent, because for an existing account none is. Someone who
    // genuinely owns the address is pointed at sign-in and password reset,
    // which is where they actually need to go.
    if (!user) {
      return res.status(201).json({
        message: 'If that address can be registered, check your email to verify it. '
               + 'If you already have an account, sign in or reset your password instead.',
        pendingVerification: true,
        verificationRequired: true
      });
    }

    const token = newToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await users.setVerificationToken(user.id, sha256(token), expires);

    const link = `${appUrl()}/auth.html?verify=${token}`;
    const sent = await mailer.send('verification', user.email, { name: user.name, link });

    // No JWT is issued here: the account is not usable until the address is proven.
    if (!sent.ok) {
      console.error(
        `[auth] verification email to ${user.email} was NOT sent ` +
        `(${sent.skipped ? 'Brevo not configured' : 'Brevo rejected the request'}). ` +
        'The account exists but cannot be verified until mail works.'
      );
    }
    // A faculty applicant is not simply verifying an address: they are waiting
    // on an administrator. Saying only 'check your email' leaves them unable to
    // understand why signing in still fails afterwards.
    const message = faculty
      ? (sent.ok
          ? 'Your faculty application has been received. Verify your email, then wait for an administrator to approve your account.'
          : 'Your application was recorded, but we could not send the verification email. Please contact an administrator.')
      : (sent.ok
          ? 'Check your email to verify your account.'
          : 'Your account was created, but we could not send the verification email. Please contact an administrator.');

    res.status(201).json({
      message,
      pendingVerification: true,
      verificationRequired: true,
      // The sign-in page branches on this to explain the application state
      // rather than telling the applicant to simply check their email.
      pendingApproval: faculty,
      role: user.role,
      emailSent: sent.ok === true
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/verify?token=... — used by links that carry the token in the URL. */
// Throttled like POST /verify-email. Tokens are 256-bit so guessing is
// infeasible, but an unthrottled public endpoint is free load.
router.get('/verify', ...authLimits, async (req, res, next) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return res.status(400).json({ message: 'A verification token is required' });

    const user = await users.findByVerificationHash(sha256(token));
    if (!user) {
      return res.status(400).json({ message: 'That link is invalid or has expired. Request a new one.' });
    }
    const verified = await users.markVerified(user.id);
    await mailer.send('welcome', verified.email, { name: verified.name });

    res.status(200).json({ message: 'Email verified. You can sign in now.', verified: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/verify-email — the endpoint the sign-in page calls, with the
 * token in the request body. The GET above stays for links that carry it in the
 * URL. Both run the same verification.
 */
router.post('/verify-email', ...authLimits, async (req, res, next) => {
  try {
    const raw = req.body && req.body.token;
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!token) return res.status(400).json({ message: 'A verification token is required' });

    const user = await users.findByVerificationHash(sha256(token));
    if (!user) {
      return res.status(400).json({ message: 'That link is invalid or has expired. Request a new one.' });
    }
    const verified = await users.markVerified(user.id);
    await mailer.send('welcome', verified.email, { name: verified.name });
    res.status(200).json({ message: 'Email verified. You can sign in now.', verified: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/resend-verification — issues a fresh verification link.
 *
 * Without this an applicant whose verification email never arrived is stuck:
 * they cannot sign in, cannot re-register (the email is taken), and the token
 * expires after 24 hours. Answers identically whether or not the account
 * exists, so it cannot be used to enumerate addresses.
 */
router.post('/resend-verification', ...authLimits, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = await users.findByEmail(email);

    if (user && !user.emailVerified) {
      const token = newToken();
      await users.setVerificationToken(
        user.id, sha256(token), new Date(Date.now() + 24 * 60 * 60 * 1000));
      await mailer.send('verification', user.email, {
        name: user.name, link: `${appUrl()}/auth.html?verify=${token}`
      });
    }
    res.status(200).json({
      message: 'If that address needs verifying, a new link is on its way.'
    });
  } catch (err) { next(err); }
});

/** POST /api/auth/login */
router.post('/login', ...authLimits, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const user = await users.findByEmail(email);
    // Same message whether the account is missing or the password is wrong, and
    // the same amount of work: without the dummy comparison, a missing account
    // returns far faster than a wrong password, which reveals who is registered.
    const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const ok = user
      ? await bcrypt.compare(password, user.password)
      : (await bcrypt.compare(password, DUMMY_HASH), false);
    if (!ok) return res.status(401).json({ message: 'Email or password is incorrect' });

    if (!user.emailVerified) {
      return res.status(403).json({ message: 'Verify your email address before signing in.' });
    }
    if (user.pendingApproval) {
      return res.status(403).json({ message: 'Your account is awaiting administrator approval.' });
    }
    if (user.suspended) {
      return res.status(403).json({
        message: user.suspendedReason
          ? `Your account is suspended: ${user.suspendedReason}`
          : 'Your account is suspended.'
      });
    }

    const token = signToken(user);
    // Fire-and-forget: the sign-in must not fail because mail is slow.
    mailer.send('signin', user.email, {
      name: user.name,
      time: new Date().toUTCString(),
      device: String(req.headers['user-agent'] || '').slice(0, 120)
    }).catch(() => {});

    res.status(200).json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/forgot-password — always answers the same way. */
router.post('/forgot-password', ...authLimits, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = await users.findByEmail(email);

    if (user) {
      const token = newToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await users.setResetToken(user.id, sha256(token), expires);
      await mailer.send('passwordReset', user.email, {
        name: user.name, // The token goes in the fragment, not the query string: a fragment is
        // never sent to the server, so it stays out of access logs and referrers.
        link: `${appUrl()}/reset-password.html#token=${token}`
      });
    }
    res.status(200).json({ message: 'If that address has an account, a reset link is on its way.' });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/reset-password */
router.post('/reset-password', ...authLimits, async (req, res, next) => {
  try {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ message: pwProblem });

    const user = await users.findByResetHash(sha256(token));
    if (!user) return res.status(400).json({ message: 'That link is invalid or has expired.' });

    const hash = await bcrypt.hash(password, 10);
    await users.setPasswordAndBumpVersion(user.id, hash);
    res.status(200).json({ message: 'Password updated. Sign in with your new password.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/auth/preferences — currently just the leaderboard opt-out.
 * Only students appear on the leaderboard, so only a student can change this.
 */
const updatePreferences = async (req, res, next) => {
  try {
    if (typeof req.body.leaderboardOptOut !== 'boolean') {
      return res.status(400).json({ message: 'leaderboardOptOut must be true or false' });
    }
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Only students have a leaderboard preference' });
    }
    const { one } = require('../config/pg');
    await one('update users set leaderboard_opt_out = $2 where id = $1',
      [req.user.id, req.body.leaderboardOptOut]);
    const updated = await users.findById(req.user.id);
    res.status(200).json({
      message: req.body.leaderboardOptOut
        ? 'You will no longer appear on the leaderboard.'
        : 'You will appear on the leaderboard again.',
      leaderboardOptOut: req.body.leaderboardOptOut,
      // The client re-saves this into localStorage; without it the cached
      // profile is overwritten with undefined and every role check degrades.
      user: publicUser(updated)
    });
  } catch (err) {
    next(err);
  }
};
router.patch('/preferences', protect, updatePreferences);
router.post('/preferences', protect, updatePreferences);

/**
 * POST /api/auth/logout
 *
 * This used to return a success message and change nothing, so a token copied
 * from localStorage or a shared machine kept working for the rest of its seven
 * days. It now increments token_version, which `protect` compares on every
 * authenticated request — every token already issued to this account stops
 * working immediately, and no other account is affected.
 *
 * The response is identical either way, so a failure to bump cannot be used to
 * probe whether a token was valid.
 */
router.post('/logout', protect, async (req, res, next) => {
  try {
    await users.bumpTokenVersion(req.user.id);
    res.status(200).json({ message: 'Signed out' });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me */
router.get('/me', protect, async (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.isUniversityEmail = isUniversityEmail;
module.exports.isFacultyEmail = isFacultyEmail;
module.exports.rateLimitKey = rateLimitKey;
module.exports.passwordProblem = passwordProblem;
module.exports.PASSWORD_MAX_BYTES = PASSWORD_MAX_BYTES;
