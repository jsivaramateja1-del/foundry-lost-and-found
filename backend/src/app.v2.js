/**
 * Express app on PostgreSQL.
 *
 * This is the only entry point. The earlier MongoDB implementation was removed
 * during the migration; there is no src/app.js and no Mongoose dependency left
 * in the tree. Everything below the router mounts — helmet, CORS, static
 * hosting, error handling — is unchanged from that version.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'"],
      // Nothing embeds Foundry in a frame, so refuse to be framed at all rather
      // than helmet's default 'self'.
      'frame-ancestors': ["'none'"],
      // Google Fonts supplies the three typefaces; nothing else is external.
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://*.supabase.co'],
      'connect-src': ["'self'", 'https://*.tile.openstreetmap.org', 'https://*.supabase.co']
    }
  }
}));

/**
 * CORS allow-list.
 *
 * This used to reflect ANY origin outside production (`origin: true`) with
 * `credentials: true`. A dev build left running, or a staging deploy without
 * NODE_ENV=production, would then accept credentialed cross-origin requests
 * from any site on the internet.
 *
 * The allow-list now applies in every environment. CLIENT_ORIGIN is the source
 * of truth; when it is unset outside production the usual local dev origins are
 * allowed so `npm run dev` keeps working, and in production an unset
 * CLIENT_ORIGIN means no cross-origin access at all.
 */
const configured = String(process.env.CLIENT_ORIGIN || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

const DEV_ORIGINS = [
  'http://localhost:5000', 'http://127.0.0.1:5000',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5173', 'http://127.0.0.1:5173'
];

const origins = configured.length
  ? configured
  : (process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS);

app.use(cors({
  origin(origin, callback) {
    // No Origin header: same-origin navigation, curl, health checks.
    if (!origin) return callback(null, true);
    if (origins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  const { db } = require('./config/pg');
  let state = 'disconnected';
  try { state = db() ? 'connected' : 'disconnected'; } catch { state = 'disconnected'; }
  res.status(200).json({
    status: 'ok', service: 'foundry-api', time: new Date().toISOString(),
    db: { state, ok: state === 'connected' }
  });
});

app.get('/api/health/ready', async (req, res) => {
  // Must do a real round-trip. Checking that the pool object exists returns 200
  // for the whole life of the process, so a dead database would look healthy.
  const { db } = require('./config/pg');
  let ok = false;
  let reason = 'not connected';
  try {
    const pool = db();
    if (pool) { await pool.query('select 1'); ok = true; reason = 'ok'; }
  } catch (err) {
    // Log the real driver error server-side; never return it. err.message can
    // carry hostnames, ports, role names and TLS detail, and this endpoint is
    // unauthenticated.
    console.error('[health] readiness probe failed:', err && (err.code || err.message));
    reason = 'database unavailable';
  }
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ready' : 'not-ready', service: 'foundry-api',
    time: new Date().toISOString(),
    db: { state: ok ? 'connected' : 'disconnected', ok, reason }
  });
});

app.use('/api/auth', require('./routes/auth.v2.routes'));
app.use('/api/items', require('./routes/items.v2.routes'));
app.use('/api/claims', require('./routes/claims.v2.routes'));
app.use('/api/whatsapp', require('./routes/whatsapp.v2.routes'));
app.use('/api/conversations', require('./routes/conversations.v2.routes'));

const misc = require('./routes/misc.v2.routes');
app.use('/api/notifications', misc.notifications);
app.use('/api/dashboard', misc.dashboard);
app.use('/api/leaderboard', misc.leaderboard);
app.use('/api/campus', misc.campus);
app.use('/api/reports', misc.reports);
app.use('/api/admin', misc.admin);

const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.code === '23505') {
    return res.status(409).json({ message: 'That record already exists' });
  }
  // A CHECK constraint rejecting a value is the client's fault, not ours.
  // Without this a bad value surfaces as a 500 and logs a stack trace.
  if (err && err.code === '23514') {
    return res.status(400).json({ message: 'One of those values is not allowed' });
  }
  if (err && err.code === '22P02') {
    return res.status(400).json({ message: 'Invalid id' });
  }
  const status = err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? 'Something went wrong on our side.' : err.message
  });
});

module.exports = app;
