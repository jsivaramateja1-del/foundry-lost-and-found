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
    // A password reset bumps tokenVersion, which retires every older token.
    // Tokens issued before this field existed carry no tv and count as 0, so
    // nobody is logged out by the upgrade itself.
    const tokenVersion = decoded.tv === undefined ? 0 : decoded.tv;
    if (tokenVersion !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
    // A temporary suspension expires on its own
    if (user.suspended && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      user.suspended = false;
      user.suspendedUntil = undefined;
      user.suspendedReason = undefined;
      user.suspendedAt = undefined;
      await user.save();
    }
    if (user.suspended) {
      return res.status(403).json({ message: 'This account has been suspended. Contact the administrator.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }
};

/**
 * Attach req.user when a valid Bearer token is present, but never refuse the
 * request. Public routes use this when they must show a little more to the
 * owner or to staff — a hidden listing, for example — while staying public.
 * An absent, invalid or expired token simply means "not identified".
 */
const identifyUser = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    const decoded = jwt.verify(header.split(' ')[1], secret());
    const user = await User.findById(decoded.id);
    // A deleted or suspended account is treated as anonymous here
    const tokenVersion = decoded.tv === undefined ? 0 : decoded.tv;
    if (user && tokenVersion === (user.tokenVersion || 0) && !user.suspended) req.user = user;
  } catch {
    /* not identified: the route continues as an anonymous request */
  }
  return next();
};

/**
 * Require a verified email address, but only when the deployment has email
 * verification switched on. With it off (the default) this is a no-op, so
 * existing accounts keep working exactly as before.
 */
const requireVerified = (req, res, next) => {
  const enabled = String(process.env.EMAIL_VERIFICATION || '').toLowerCase() === 'enabled';
  if (req.user.pendingApproval) {
    return res.status(403).json({
      message: 'Your account is waiting for an administrator to approve it. You can browse in the meantime.'
    });
  }
  if (enabled && !req.user.emailVerified) {
    return res.status(403).json({
      message: 'Confirm your email address before doing that. Check your inbox, or request a new link.'
    });
  }
  next();
};

/** Require one of the given roles. Always used after protect. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: `This action needs one of these roles: ${roles.join(', ')}` });
  }
  next();
};

/** Kept for backwards compatibility: any administrative role. */
const adminOnly = requireRole('admin', 'superadmin');

// The three tiers, named once so the routes read clearly
const ADMIN_ROLES = ['admin', 'superadmin'];
const MODERATION_ROLES = ['moderator', 'admin', 'superadmin'];
const SUPER_ROLES = ['superadmin'];

const signToken = (userId, tokenVersion = 0) =>
  jwt.sign({ id: userId, tv: tokenVersion }, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

module.exports = {
  protect,
  identifyUser,
  adminOnly,
  requireRole,
  requireVerified,
  signToken,
  ADMIN_ROLES,
  MODERATION_ROLES,
  SUPER_ROLES
};
