require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    // Fail fast and loudly: a missing secret must never be silently replaced
    // by a default value, because anyone could then forge an admin token.
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example).');
    }
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
})();
