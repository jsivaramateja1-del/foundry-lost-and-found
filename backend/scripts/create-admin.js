/**
 * Creates the first administrator account.
 *
 * This project deliberately ships with NO default accounts and NO default
 * passwords. The first admin is created from environment variables, so no
 * password ever exists in the repository or in the database dump.
 *
 * Run from the backend folder:
 *   set ADMIN_NAME=Your Name
 *   set ADMIN_EMAIL=you@saiuniversity.edu.in
 *   set ADMIN_PASSWORD=a-long-password-you-choose
 *   npm run create-admin
 *
 * Running it again with an email that already exists promotes that existing
 * account to admin. It never changes a password.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

const MIN_PASSWORD = 8;

(async () => {
  const name = String(process.env.ADMIN_NAME || '').trim();
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');

  if (!name || !email || !password) {
    console.error('ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD must all be set.');
    console.error('Example:  set ADMIN_EMAIL=you@saiuniversity.edu.in');
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD) {
    console.error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters.`);
    process.exit(1);
  }

  try {
    await connectDB();

    const existing = await User.findOne({ email });

    if (existing) {
      if (existing.role === 'admin') {
        console.log(`${email} is already an administrator. Nothing to do.`);
      } else {
        existing.role = 'admin';
        await existing.save();
        console.log(`${email} already had an account, so it was promoted to admin.`);
        console.log('Its password was left unchanged.');
      }
    } else {
      // The User model hashes the password in a pre-save hook
      const admin = await User.create({ name, email, password, role: 'admin' });
      console.log(`Administrator created: ${admin.email}`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Could not create the administrator:', err.message);
    process.exit(1);
  }
})();
