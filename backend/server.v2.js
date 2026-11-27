require('dotenv').config();
const app = require('./src/app.v2');
const { connectDB } = require('./src/config/pg');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example).');
    }

    if (String(process.env.JWT_SECRET).length < 32) {
      throw new Error('JWT_SECRET is shorter than 32 characters. ' +
        'Generate one with 48 random bytes, hex encoded.');
    }

    if (!process.env.HANDOVER_SECRET) {
      console.warn('HANDOVER_SECRET is not set: handover codes fall back to ' +
        'JWT_SECRET. Set it to keep the two key usages separate.');
    }
    await connectDB();

    try {
      const fs = require('fs');
      const path = require('path');
      const schemaPath = path.join(__dirname, 'db', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const sql = fs.readFileSync(schemaPath, 'utf8');
        const { db } = require('./src/config/pg');
        await db().query(sql);
        console.log('Schema: applied (additive only)');
      }
    } catch (err) {
      console.error('Schema: could not be applied —', err.message);
    }

    if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER) {
      console.log(`Email: configured (sender ${process.env.BREVO_SENDER})`);
    } else {
      console.warn('Email: NOT configured — set BREVO_API_KEY and BREVO_SENDER. ' +
        'Registration will create accounts but no verification email will be sent.');
    }
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT} (PostgreSQL)`);
    });

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
