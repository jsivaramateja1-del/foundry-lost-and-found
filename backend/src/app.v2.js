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

      'frame-ancestors': ["'none'"],

      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://*.supabase.co'],
      'connect-src': ["'self'", 'https://*.tile.openstreetmap.org', 'https://*.supabase.co']
    }
  }
}));

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

  const { db } = require('./config/pg');
  let ok = false;
  let reason = 'not connected';
  try {
    const pool = db();
    if (pool) { await pool.query('select 1'); ok = true; reason = 'ok'; }
  } catch (err) {

    console.error('[health] readiness probe failed:', err && (err.code || err.message));
    reason = 'database unavailable';
  }
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ready' : 'not-ready', service: 'foundry-api',
    time: new Date().toISOString(),
    db: { state: ok ? 'connected' : 'disconnected', ok, reason }
  });
});

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
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
