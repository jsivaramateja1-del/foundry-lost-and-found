/**
 * PostgreSQL entry point. Same startup contract as server.js:
 * validate configuration, connect, then listen.
 */
require('dotenv').config();
const app = require('./src/app.v2');
const { connectDB } = require('./src/config/pg');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example).');
    }
    await connectDB();

    // Say once, at boot, whether mail can work. A missing key then shows up in
    // the deploy log instead of surfacing as a silent signup failure.
    if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
      console.log(`Email: configured (sender ${process.env.BREVO_SENDER})`);
    } else {
      console.warn('Email: NOT configured — set BREVO_API_KEY and BREVO_SENDER. ' +
        'Registration will create accounts but no verification email will be sent.');
    }
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT} (PostgreSQL)`);
    });

    // Without this, every restart abandons up to PG_POOL_MAX open pooler
    // connections. On a free tier that spins down often, they accumulate.
    const { closeDB } = require('./src/config/pg');
    const shutdown = async (signal) => {
      console.log(`${signal} received, shutting down`);
      server.close(async () => {
        await closeDB().catch(() => {});
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
})();
