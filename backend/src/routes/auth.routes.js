const express = require('express');
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
const { sendVerificationEmail } = require('../utils/mailer');

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
        await sendVerificationEmail(user.email, token);
      } catch (err) {
        // The account exists; the person can ask for another link. Never
        // pretend the email went out.
        console.error('Verification email failed:', err.message);
        return res.status(201).json({
          token: signToken(user._id),
          user: user.toSafeObject(),
          verificationRequired: true,
          message: 'Account created, but the verification email could not be sent. Use "Resend verification email" once the mail server is reachable.'
        });
      }
    }

    res.status(201).json({
      token: signToken(user._id),
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
    req.user.verificationTokenHash = hashVerificationToken(token);
    req.user.verificationTokenExpires = verificationExpiry();
    await req.user.save();

    try {
      await sendVerificationEmail(req.user.email, token);
    } catch (err) {
      console.error('Verification email failed:', err.message);
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
    if (user.suspended) {
      return res.status(403).json({
        message: 'This account has been suspended. Contact the administrator if you think this is a mistake.'
      });
    }

    res.status(200).json({ token: signToken(user._id), user: user.toSafeObject() });
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
 * POST /api/auth/logout
 * Protected. JWTs are stateless, so this only confirms the client should
 * discard its token. Kept as a real endpoint so the flow is complete.
 */
router.post('/logout', protect, async (req, res) => {
  res.status(200).json({ message: 'Logged out. Discard the token on the client.' });
});

module.exports = router;
