const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { protect, signToken } = require('../middleware/auth');
const {
  allowedDomain,
  studentDomains,
  isFacultyEmail,
  normaliseEmail,
  isAllowedEmail,
  emailDomainError,
  createVerificationToken,
  hashVerificationToken,
  verificationExpiry,
  emailVerificationEnabled
} = require('../utils/email');

const mailer = require('../utils/mailer');

const router = express.Router();

// Slow down brute-force attempts on login/register
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' }
});

// A tighter limit for "send me another verification email"
const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many verification emails requested. Try again later.' }
});

/**
 * GET /api/auth/config
 * Public. The rules the sign-up form has to display, so the frontend and the
 * backend can never disagree about which domain is allowed.
 */
router.get('/config', (req, res) => {
  res.status(200).json({
    // Every domain a student may use, plus the first one for older clients
    allowedEmailDomains: studentDomains(),
    allowedEmailDomain: allowedDomain(),
    emailVerification: emailVerificationEnabled()
  });
});

/**
 * POST /api/auth/register
 * Public. Creates a student account and returns a token.
 *
 * Only addresses on the Sai University student domain are accepted, and the
 * role is always "student" — it is never taken from the request body.
 */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, password } = req.body;
    const email = normaliseEmail(req.body.email);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are all required' });
    }
    // The server decides, whatever the browser said
    if (!isAllowedEmail(email)) {
      return res.status(400).json({ message: emailDomainError() });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const needsVerification = emailVerificationEnabled();
    const token = needsVerification ? createVerificationToken() : null;

    // A faculty address creates a faculty account that an administrator must
    // approve. It never carries administrative powers by itself.
    const faculty = isFacultyEmail(email);

    const user = await User.create({
      name: String(name).trim(),
      email,
      password,
      role: faculty ? 'faculty' : 'student',
      pendingApproval: faculty,
      emailVerified: !needsVerification,
      ...(needsVerification
        ? {
            verificationTokenHash: hashVerificationToken(token),
            verificationTokenExpires: verificationExpiry()
          }
        : {})
    });

    if (needsVerification) {
      try {
        await mailer.sendVerificationEmail(user.email, token);
      } catch (err) {
        // The account exists; the person can ask for another link. Never
        // pretend the email went out.
        console.error('Verification email failed:', err.message);
        return res.status(201).json({
          token: signToken(user._id, user.tokenVersion),
          user: user.toSafeObject(),
          verificationRequired: true,
          message: 'Account created, but the verification email could not be sent. Use "Resend verification email" once the mail server is reachable.'
        });
      }
    }

    res.status(201).json({
      token: signToken(user._id, user.tokenVersion),
      user: user.toSafeObject(),
      verificationRequired: needsVerification,
      pendingApproval: faculty
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/verify-email
 * Public. Consumes a verification token. Each token works once and expires.
 */
router.post('/verify-email', authLimiter, async (req, res, next) => {
  try {
    const token = String(req.body.token || '').trim();
    if (!token) return res.status(400).json({ message: 'A verification token is required' });

    const user = await User.findOne({
      verificationTokenHash: hashVerificationToken(token),
      verificationTokenExpires: { $gt: new Date() }
    }).select('+verificationTokenHash +verificationTokenExpires');

    if (!user) {
      return res.status(400).json({ message: 'That verification link is invalid or has expired.' });
    }

    user.emailVerified = true;
    user.verificationTokenHash = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'Email verified. You now have full access.', user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/resend-verification
 * Protected and rate limited. Issues a fresh token and invalidates the old one.
 */
router.post('/resend-verification', verifyLimiter, protect, async (req, res, next) => {
  try {
    if (!emailVerificationEnabled()) {
      return res.status(400).json({ message: 'Email verification is not enabled on this deployment.' });
    }
    if (req.user.emailVerified) {
      return res.status(400).json({ message: 'This address is already verified.' });
    }

    const token = createVerificationToken();
    const verificationTokenHash = hashVerificationToken(token);
    req.user.verificationTokenHash = verificationTokenHash;
    req.user.verificationTokenExpires = verificationExpiry();
    await req.user.save();

    try {
      await mailer.sendVerificationEmail(req.user.email, token);
    } catch (err) {
      console.error('Verification email failed:', err.message);
      try {
        await User.updateOne(
          { _id: req.user._id, verificationTokenHash },
          { $unset: { verificationTokenHash: 1, verificationTokenExpires: 1 } }
        );
      } catch (cleanupError) {
        console.error(cleanupError.message);
      }
      req.user.verificationTokenHash = undefined;
      req.user.verificationTokenExpires = undefined;
      return res.status(502).json({ message: 'The verification email could not be sent right now. Try again later.' });
    }

    res.status(200).json({ message: 'A new verification email is on its way.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Public. Returns a JWT on correct credentials.
 */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body.email);
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Existing accounts on other domains can still log in: the domain rule
    // applies to new registrations, not to people who already have an account.
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.suspended && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      user.suspended = false;
      user.suspendedUntil = undefined;
      user.suspendedReason = undefined;
      await user.save();
    }
    if (user.suspended) {
      return res.status(403).json({
        message: 'This account has been suspended. Contact the administrator if you think this is a mistake.'
      });
    }

    res.status(200).json({ token: signToken(user._id, user.tokenVersion), user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Protected. Used by the frontend to restore a session on refresh.
 */
router.get('/me', protect, async (req, res) => {
  res.status(200).json({ user: req.user.toSafeObject() });
});

/**
 * POST /api/auth/forgot-password
 * Public, rate limited. Always answers the same way, whether or not the address
 * has an account — otherwise this endpoint would be a way to discover who is
 * registered. The token is hashed before storage and never appears in the
 * response or in a log line.
 */
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  const generic = { message: 'If that address has a Foundry account, a reset link is on its way.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Enter the email address you registered with' });
    }

    const parts = email.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1].includes('.') || parts[1].startsWith('.') || parts[1].endsWith('.') || email.includes(' ')) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    try {
      await mailer.sendPasswordResetEmail(user.email, token);
    } catch (err) {
      try {
        await User.updateOne({ _id: user._id, resetTokenHash: user.resetTokenHash }, { $unset: { resetTokenHash: 1, resetTokenExpires: 1 } });
      } catch (cleanupError) {
        console.error('Could not clear an undelivered password reset token:', cleanupError.message);
      }
      // Never leak SMTP detail to the caller, and never log the token
      console.error('Password reset email could not be sent:', err.message);
    }
    return res.status(200).json(generic);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset-password
 * Public, rate limited. The token is single use: it is cleared in the same
 * save that changes the password, and tokenVersion is bumped so every session
 * issued before the reset stops working.
 */
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, password, confirmPassword } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'A reset link and a new password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ message: 'The two passwords do not match' });
    }

    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');

    // Hash before touching the account. The password hash, one-time token
    // consumption and token-version bump are then committed by one atomic write.
    // This avoids spending a valid link if a separate password save fails.
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await User.updateOne(
      { resetTokenHash: hash, resetTokenExpires: { $gt: new Date() } },
      {
        $set: { password: passwordHash },
        $unset: { resetTokenHash: '', resetTokenExpires: '' },
        $inc: { tokenVersion: 1 }
      },
      { runValidators: true }
    );

    if (result.modifiedCount !== 1) {
      return res.status(400).json({ message: 'That reset link is invalid or has expired. Request a new one.' });
    }

    res.status(200).json({ message: 'Password updated. You can log in with your new password.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/auth/preferences
 * Protected. The only preference a student may change is whether their name
 * appears on the public leaderboard. Points, returns and role are deliberately
 * not writable here, so this cannot be used to inflate a score or escalate.
 */
router.patch('/preferences', protect, async (req, res, next) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ message: 'Only students can update leaderboard preferences' });
    }
    const unexpectedFields = Object.keys(req.body || {}).filter((key) => key !== 'leaderboardOptOut');
    if (unexpectedFields.length > 0) {
      return res.status(400).json({ message: 'Unexpected preference fields' });
    }
    if (req.body.leaderboardOptOut === undefined) {
      return res.status(400).json({ message: 'Nothing to update' });
    }
    if (typeof req.body.leaderboardOptOut !== 'boolean') {
      return res.status(400).json({ message: 'leaderboardOptOut must be true or false' });
    }
    req.user.leaderboardOptOut = req.body.leaderboardOptOut;
    await req.user.save();
    res.status(200).json({
      message: req.body.leaderboardOptOut
        ? 'You are hidden from the leaderboard'
        : 'You appear on the leaderboard',
      user: req.user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 * Protected. JWTs are stateless, so this only confirms the client should
 * discard its token. Kept as a real endpoint so the flow is complete.
 */
router.post('/logout', protect, async (req, res) => {
  res.status(200).json({ message: 'Logged out. Discard the token on the client.' });
});

module.exports = router;
