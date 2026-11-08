const rateLimit = require('express-rate-limit');

/**
 * Rate limiting in two layers, because they answer two different questions.
 *
 *  1. IP layer  — mounted BEFORE authentication. It can only see the network,
 *                 so it stops unauthenticated floods without touching the
 *                 database. It is deliberately generous, because a whole
 *                 campus can share one NAT address.
 *
 *  2. Account layer — mounted AFTER `protect`, so `req.user` genuinely exists
 *                 and the limit is per account, not per network. This is the
 *                 one that stops a single signed-in account from spamming.
 *
 * Both run on every write route. Neither claims to be the other.
 */

const positiveInt = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const HOUR = 60 * 60 * 1000;

const options = (max, message) => ({
  windowMs: HOUR,
  limit: max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message }
});

/** IP-based limiter. Uses express-rate-limit's default key generator (the client IP). */
const ipLimiter = (envName, fallback) =>
  rateLimit(options(
    positiveInt(envName, fallback),
    'Too many requests from this network. Please try again later.'
  ));

/**
 * Account-based limiter. Only ever mounted after `protect`, so `req.user` is
 * guaranteed; if it were mounted earlier the key would be undefined and every
 * request would share one bucket.
 */
const accountLimiter = (envName, fallback) =>
  rateLimit({
    ...options(positiveInt(envName, fallback), 'You are doing that too often. Please try again later.'),
    keyGenerator: (req) => {
      // The Postgres user object exposes `id`; the Mongo one used `_id`. Keying
      // on the wrong field collapses every account into one shared bucket.
      const id = req.user && (req.user.id || req.user._id);
      if (!id) throw new Error('accountLimiter must be mounted after protect()');
      return String(id);
    }
  });

/* One instance per route, so the three write paths cannot exhaust each other. */
const itemIpLimit = ipLimiter('RATE_LIMIT_ITEMS_IP_MAX', 60);
const itemAccountLimit = accountLimiter('RATE_LIMIT_ITEMS_MAX', 20);
const claimIpLimit = ipLimiter('RATE_LIMIT_CLAIMS_IP_MAX', 60);
const claimAccountLimit = accountLimiter('RATE_LIMIT_CLAIMS_MAX', 20);
const reportIpLimit = ipLimiter('RATE_LIMIT_REPORTS_IP_MAX', 30);
const reportAccountLimit = accountLimiter('RATE_LIMIT_REPORTS_MAX', 10);

module.exports = {
  ipLimiter,
  accountLimiter,
  itemIpLimit,
  itemAccountLimit,
  claimIpLimit,
  claimAccountLimit,
  reportIpLimit,
  reportAccountLimit
};
