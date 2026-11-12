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

const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role, tv: user.tokenVersion },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const publicUser = (u) => ({ ...users.toSafeObject(u), leaderboardOptOut: u.leaderboardOptOut });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  // A campus sits behind one NAT address, so an IP-only key meant twenty students
  // mistyping a password locked out everyone else — on exactly the network this
  // ships to. Keying on ip + account keeps brute-force protection per account
  // while letting every student sign in.
  keyGenerator: (req) => {
    const b = req.body || {};
    // Login and register carry an email; /verify-email and /reset-password carry
    // only a token. Without this fallback those routes keyed on "<ip>:" alone, so
    // every user behind one NAT shared a single bucket of 20 attempts.
    const who = b.email
      ? String(b.email).toLowerCase()
      : String(b.token || '').slice(-16) || 'anon';
    return `${req.ip}:${who}`;
  },
  message: { message: 'Too many attempts. Please try again in a few minutes.' }
});

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
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
    if (!isUniversityEmail(email)) {
      return res.status(400).json({ message: `Register with your Sai University address (@${PARENT_DOMAIN})` });
    }
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

    // Staff are not self-service: a faculty address creates a pending
    // application that an administrator must approve before it can be used.
    const faculty = isFacultyEmail(email);

    const hash = await bcrypt.hash(password, 10);
    const user = await users.create({
      name, email, password: hash,
      role: faculty ? 'faculty' : 'student',
      pendingApproval: faculty
    });
    if (!user) return res.status(409).json({ message: 'An account with that email already exists' });

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
router.get('/verify', async (req, res, next) => {
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
router.post('/verify-email', authLimiter, async (req, res, next) => {
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
router.post('/resend-verification', authLimiter, async (req, res, next) => {
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
router.post('/login', authLimiter, async (req, res, next) => {
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
router.post('/forgot-password', authLimiter, async (req, res, next) => {
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
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

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

/** POST /api/auth/logout — tokens are stateless, so this is an acknowledgement. */
router.post('/logout', protect, (req, res) => {
  res.status(200).json({ message: 'Signed out' });
});

/** GET /api/auth/me */
router.get('/me', protect, async (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.isUniversityEmail = isUniversityEmail;
module.exports.isFacultyEmail = isFacultyEmail;
