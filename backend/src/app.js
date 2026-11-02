const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

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
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS - allow the configured frontend origins, or everything in development
const origins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: origins.length && process.env.NODE_ENV === 'production' ? origins : true,
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

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'foundry-api', time: new Date().toISOString() });
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
