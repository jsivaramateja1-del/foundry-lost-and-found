/**
 * JWT authentication on PostgreSQL.
 *
 * Reads the user fresh on every request so a role change, suspension or
 * password reset takes effect immediately rather than when the token expires.
 */
const jwt = require('jsonwebtoken');
const users = require('../repositories/users');

const ADMIN_ROLES = ['admin', 'superadmin'];
const MODERATION_ROLES = ['moderator', 'admin', 'superadmin'];

/**
 * Populates req.user when a valid token is present, and does nothing when it is
 * not. For routes that are public but can say more to a signed-in reader -
 * the board uses it to decide whether to offer a Message button.
 *
 * It never rejects: a bad token on a public route is treated as anonymous
 * rather than as an error, because the route does not require identity.
 */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await users.findByIdWithSecrets(decoded.id);
    if (!user) return next();
    const version = decoded.tv === undefined ? 0 : decoded.tv;
    if (version !== (user.tokenVersion || 0)) return next();
    if (user.pendingApproval || user.suspended) return next();
    req.user = user;
  } catch (e) {
    /* anonymous */
  }
  next();
};

const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ message: 'Not authorised. Please sign in.' });

    let decoded;
    try {
      // Pin the algorithm. Without this the verifier accepts any HMAC algorithm,
      // and any token minted with this secret for another purpose would pass.
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }

    const user = await users.findByIdWithSecrets(decoded.id);
    if (!user) return res.status(401).json({ message: 'Not authorised. Please sign in.' });

    // A password reset bumps token_version, retiring every older token.
    const version = decoded.tv === undefined ? 0 : decoded.tv;
    if (version !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
    if (user.pendingApproval) {
      return res.status(403).json({ message: 'Your account is awaiting administrator approval.' });
    }
    if (user.suspended) {
      return res.status(403).json({ message: 'Your account is suspended.' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authorised.' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to do that.' });
  }
  next();
};

module.exports = { protect, requireRole, ADMIN_ROLES, MODERATION_ROLES,
  optionalAuth
};
