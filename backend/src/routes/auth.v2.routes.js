const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { one } = require('../config/pg');
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

const isFacultyEmail = (email) => {
  const at = String(email || '').toLowerCase().lastIndexOf('@');
  if (at < 1) return false;
  return String(email).toLowerCase().slice(at + 1) === PARENT_DOMAIN;
};

const isUniversityEmail = (email) => {
  const at = String(email || '').toLowerCase().lastIndexOf('@');
  if (at < 1) return false;
  const domain = String(email).toLowerCase().slice(at + 1);
  return domain === PARENT_DOMAIN || domain.endsWith('.' + PARENT_DOMAIN);
};

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

function rateLimitKey(req) {
  const b = (req && req.body) || {};
  const who = b.email
    ? String(b.email).trim().toLowerCase()
    : String(b.token || '').trim().slice(-16) || 'anon';
  const ip = (req && req.ip) || 'unknown';
  return `${ip}:${who}`;
}

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

  keyGenerator: rateLimitKey,
  message: { message: 'Too many attempts. Please try again in a few minutes.' }
});

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

const authIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: positiveInt('RATE_LIMIT_AUTH_IP_MAX', 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts from this network. Please try again in a few minutes.' }
});

const authLimits = [authIpLimiter, authAccountLimiter, authLimiter];

router.get('/config', (req, res) => {
  res.status(200).json({
    universityDomain: PARENT_DOMAIN,
    emailVerification: true,

    emailConfigured: Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER),

    allowedEmailDomains: [PARENT_DOMAIN, 'scds.' + PARENT_DOMAIN, 'sas.' + PARENT_DOMAIN,
                          'sol.' + PARENT_DOMAIN, 'sahs.' + PARENT_DOMAIN],
    facultyDomains: [PARENT_DOMAIN]
  });
});

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

    const faculty = isFacultyEmail(email);

    const hash = await bcrypt.hash(password, 10);
    const user = await users.create({
      name, email, password: hash,
      role: faculty ? 'faculty' : 'student',
      pendingApproval: faculty
    });

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

    if (!sent.ok) {
      console.error(
        `[auth] verification email to ${user.email} was NOT sent ` +
        `(${sent.skipped ? 'Brevo not configured' : 'Brevo rejected the request'}). ` +
        'The account exists but cannot be verified until mail works.'
      );
    }

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

      pendingApproval: faculty,
      role: user.role,
      emailSent: sent.ok === true
    });
  } catch (err) {
    next(err);
  }
});

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

router.post('/login', ...authLimits, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const user = await users.findByEmail(email);

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

router.post('/forgot-password', ...authLimits, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const user = await users.findByEmail(email);

    if (user) {
      const token = newToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await users.setResetToken(user.id, sha256(token), expires);
      await mailer.send('passwordReset', user.email, {
        name: user.name,

        link: `${appUrl()}/reset-password.html#token=${token}`
      });
    }
    res.status(200).json({ message: 'If that address has an account, a reset link is on its way.' });
  } catch (err) {
    next(err);
  }
});

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

      user: publicUser(updated)
    });
  } catch (err) {
    next(err);
  }
};
router.patch('/preferences', protect, updatePreferences);
router.post('/preferences', protect, updatePreferences);

router.post('/logout', protect, async (req, res, next) => {
  try {
    await users.bumpTokenVersion(req.user.id);
    res.status(200).json({ message: 'Signed out' });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/avatar', protect, async (req, res, next) => {
  try {
    const raw = typeof req.body.avatar === 'string' ? req.body.avatar : '';
    if (raw === '') {
      await one('update users set avatar_url = null where id = $1', [req.user.id]);
      return res.status(200).json({ avatarUrl: null });
    }

    var isData = /^data:image\/(png|jpeg|webp);base64,/.test(raw);
    var isLink = /^https:\/\/[^\s]+$/i.test(raw);
    if (!isData && !isLink) {
      return res.status(400).json({ message: 'Choose a PNG, JPEG or WebP image, or paste a link to one' });
    }
    if (isData && raw.length > 400 * 1024) {
      return res.status(400).json({ message: 'That photo is too large (max 400 KB)' });
    }
    const row = await one('update users set avatar_url = $2 where id = $1 returning avatar_url', [req.user.id, raw]);
    if (!row) return res.status(404).json({ message: 'Your account could not be found' });
    res.status(200).json({ avatarUrl: row.avatar_url });
  } catch (err) { next(err); }
});

router.post('/heartbeat', protect, async (req, res, next) => {
  try {
    await one('update users set last_seen_at = now() where id = $1', [req.user.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/me', protect, async (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.isUniversityEmail = isUniversityEmail;
module.exports.isFacultyEmail = isFacultyEmail;
module.exports.rateLimitKey = rateLimitKey;
module.exports.passwordProblem = passwordProblem;
module.exports.PASSWORD_MAX_BYTES = PASSWORD_MAX_BYTES;
