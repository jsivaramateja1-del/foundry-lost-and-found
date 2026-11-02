/**
 * Read-only database diagnostics. Changes nothing.
 *
 * Run from the backend folder:
 *   npm run db:info
 *
 * Use it to answer "is the database I am connected to the same one the
 * deployed site uses?" — compare the host and database name printed here with
 * the "MongoDB Connected" line in the Render logs.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Item = require('../src/models/Item');
const Claim = require('../src/models/Claim');

(async () => {
  try {
    const conn = await connectDB();

    const [users, items, claims] = await Promise.all([
      User.countDocuments(),
      Item.countDocuments(),
      Claim.countDocuments()
    ]);

    console.log('\n--- Where am I connected? ---');
    console.log(`host     : ${conn.connection.host}`);
    console.log(`database : ${conn.connection.name}`);

    console.log('\n--- Counts ---');
    console.log(`users   : ${users}`);
    console.log(`items   : ${items}`);
    console.log(`claims  : ${claims}`);

    const byStatus = await Item.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    console.log('\n--- Items by status ---');
    byStatus.forEach((row) => console.log(`  ${row._id}: ${row.count}`));

    console.log('\n--- Who owns the existing listings? ---');
    const owners = await Item.aggregate([
      { $group: { _id: '$reportedBy', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    for (const owner of owners) {
      const user = await User.findById(owner._id).select('name email role');
      console.log(`  ${owner.count} listing(s) -> ${user ? `${user.name} <${user.email}> (${user.role})` : 'NO SUCH ACCOUNT (orphaned record)'}`);
    }

    const demoEmails = ['admin@saiuniversity.edu.in', 'student@saiuniversity.edu.in', 'priya@saiuniversity.edu.in'];
    const demoUsers = await User.find({ email: { $in: demoEmails } }).select('email');
    console.log('\n--- Old demo accounts ---');
    console.log(demoUsers.length
      ? `  found: ${demoUsers.map((u) => u.email).join(', ')}`
      : '  none of the three old demo emails exist in THIS database');

    const orphaned = await Item.countDocuments({ reportedBy: { $nin: await User.distinct('_id') } });
    console.log(`\n--- Listings whose reporter no longer exists: ${orphaned} ---`);

    console.log('\nNothing was changed by this command.');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('db:info failed:', err.message);
    process.exit(1);
  }
})();
