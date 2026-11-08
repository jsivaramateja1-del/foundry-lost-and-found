/**
 * Authentication on PostgreSQL.
 *
 * Domain rule: any address on a subdomain of saiuniversity.edu.in registers as
 * a student. Faculty accounts are created or promoted by an administrator, so
 * there is no self-service path to a privileged role.
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
  message: { message: 'Too many attempts. Please try again in a few minutes.' }
});

/** GET /api/auth/config — what the browser needs to validate before submitting. */
router.get('/config', (req, res) => {
  res.status(200).json({
    universityDomain: PARENT_DOMAIN,
    emailVerification: true
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

    const hash = await bcrypt.hash(password, 10);
    const user = await users.create({ name, email, password: hash });
    if (!user) return res.status(409).json({ message: 'An account with that email already exists' });

    const token = newToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await users.setVerificationToken(user.id, sha256(token), expires);

    const link = `${appUrl()}/auth.html?verify=${token}`;
    const sent = await mailer.send('verification', user.email, { name: user.name, link });

    // No JWT is issued here: the account is not usable until the address is proven.
    res.status(201).json({
      message: 'Check your email to verify your account.',
      pendingVerification: true,
      emailSent: sent.ok === true
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/verify?token=... */
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

/** POST /api/auth/login */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const user = await users.findByEmail(email);
    // Same message whether the account is missing or the password is wrong.
    const ok = user && await bcrypt.compare(password, user.password);
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
        name: user.name, link: `${appUrl()}/reset-password.html?token=${token}`
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

/** GET /api/auth/me */
router.get('/me', protect, async (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.isUniversityEmail = isUniversityEmail;
