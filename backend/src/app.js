const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth.routes');
const itemRoutes = require('./routes/item.routes');
const claimRoutes = require('./routes/claim.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const adminRoutes = require('./routes/admin.routes');
const leaderboardRoutes = require('./routes/leaderboard.routes');
const notificationRoutes = require('./routes/notification.routes');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

// Security headers. crossOriginResourcePolicy is relaxed so the frontend
// can load images from this API.
// Render terminates TLS at its own proxy and forwards the client address in
// X-Forwarded-For. Without this, req.ip is the proxy's address, so every
// anonymous visitor shares one rate-limit bucket and one attacker can lock out
// everyone. Exactly ONE hop is trusted: Express then takes the address that
// Render itself appended and ignores anything a client puts further left, so a
// spoofed X-Forwarded-For cannot be used to dodge the limiter.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS - allow the configured frontend origins, or everything in development
const origins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    // In production the browser talks to this same origin, so cross-origin
    // access is not needed at all. Reflecting every origin when CLIENT_ORIGIN is
    // unset would silently allow any site to call the API with credentials, so
    // the default there is to allow none rather than all.
    origin: process.env.NODE_ENV === 'production' ? (origins.length ? origins : false) : true,
    credentials: true
  })
);

app.use(express.json({ limit: '2mb' })); // allows a small base64 image
app.use(express.urlencoded({ extended: true }));

// Simple request log in development
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.originalUrl}`);
    next();
  });
}

// Mongoose readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

const databaseStatus = () => {
  const state = mongoose.connection.readyState;
  return { state: DB_STATES[state] || 'unknown', ok: state === 1 };
};

/**
 * GET /api/health
 * Liveness. Always 200 while the process is running, so a host restarting the
 * service on a database outage cannot turn a recoverable blip into a crash
 * loop. The database state is reported alongside, not folded into the code.
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'foundry-api',
    time: new Date().toISOString(),
    db: databaseStatus()
  });
});

/**
 * GET /api/health/ready
 * Readiness. 200 only when the database is connected, 503 otherwise. This is
 * the endpoint a monitor should watch: it answers "can this instance serve
 * requests", which liveness cannot.
 */
app.get('/api/health/ready', (req, res) => {
  const db = databaseStatus();
  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ready' : 'not-ready',
    service: 'foundry-api',
    time: new Date().toISOString(),
    db
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/notifications', notificationRoutes);

// Serve the frontend from ../frontend when it exists (single-service deploy)
const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
