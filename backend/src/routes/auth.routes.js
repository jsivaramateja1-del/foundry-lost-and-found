const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { protect, signToken } = require('../middleware/auth');

const router = express.Router();

// Slow down brute-force attempts on login/register
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' }
});

/**
 * POST /api/auth/register
 * Public. Creates a student account and returns a token.
 */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are all required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password });
    res.status(201).json({ token: signToken(user._id), user: user.toSafeObject() });
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
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
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
