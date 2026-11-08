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
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT} (PostgreSQL)`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
})();
