const rateLimit = require('express-rate-limit');

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

const ipLimiter = (envName, fallback) =>
  rateLimit(options(
    positiveInt(envName, fallback),
    'Too many requests from this network. Please try again later.'
  ));

const accountLimiter = (envName, fallback) =>
  rateLimit({
    ...options(positiveInt(envName, fallback), 'You are doing that too often. Please try again later.'),
    keyGenerator: (req) => {

      const id = req.user && (req.user.id || req.user._id);
      if (!id) throw new Error('accountLimiter must be mounted after protect()');
      return String(id);
    }
  });

const itemIpLimit = ipLimiter('RATE_LIMIT_ITEMS_IP_MAX', 60);
const itemAccountLimit = accountLimiter('RATE_LIMIT_ITEMS_MAX', 20);
const claimIpLimit = ipLimiter('RATE_LIMIT_CLAIMS_IP_MAX', 60);
const claimAccountLimit = accountLimiter('RATE_LIMIT_CLAIMS_MAX', 20);
const reportIpLimit = ipLimiter('RATE_LIMIT_REPORTS_IP_MAX', 30);
const reportAccountLimit = accountLimiter('RATE_LIMIT_REPORTS_MAX', 10);

const whatsappIpLimit = ipLimiter('RATE_LIMIT_WHATSAPP_IP_MAX', 30);
const whatsappAccountLimit = accountLimiter('RATE_LIMIT_WHATSAPP_MAX', 10);

module.exports = {
  ipLimiter,
  accountLimiter,
  itemIpLimit,
  itemAccountLimit,
  claimIpLimit,
  claimAccountLimit,
  reportIpLimit,
  reportAccountLimit,
  whatsappIpLimit,
  whatsappAccountLimit
};
