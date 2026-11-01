const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * The signing secret. There is deliberately NO fallback value: a default
 * secret committed to the repository would let anyone mint an admin token.
 * If it is missing the server refuses to start (see server.js).
 */
const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example) and restart.');
  }
  return value;
};

/** Require a valid Bearer token and attach req.user */
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized, no token provided' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, secret());
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user no longer exists' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }
};

/** Require the authenticated user to be an admin */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

const signToken = (userId) =>
  jwt.sign({ id: userId }, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

module.exports = { protect, adminOnly, signToken };
