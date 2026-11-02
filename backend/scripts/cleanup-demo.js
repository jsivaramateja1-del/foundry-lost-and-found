/**
 * Removes the demo data that the old seed script created.
 *
 * The old seed.js created three accounts with published passwords and twelve
 * sample listings. This script removes exactly that data and nothing else:
 * only items reported by those three demo accounts are touched, plus the
 * claims attached to them.
 *
 * Safe by default — it is a DRY RUN and deletes nothing:
 *   npm run cleanup:demo
 * Add --apply to actually delete:
 *   npm run cleanup:demo -- --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Item = require('../src/models/Item');
const Claim = require('../src/models/Claim');

// The exact accounts the old seed script created
const DEMO_EMAILS = [
  'admin@saiuniversity.edu.in',
  'student@saiuniversity.edu.in',
  'priya@saiuniversity.edu.in'
];

const APPLY = process.argv.includes('--apply');

(async () => {
  try {
    await connectDB();

    const demoUsers = await User.find({ email: { $in: DEMO_EMAILS } }).select('_id email name');
    if (!demoUsers.length) {
      console.log('No demo accounts found. Nothing to clean up.');
      await mongoose.connection.close();
      process.exit(0);
    }

    const ids = demoUsers.map((u) => u._id);
    const demoItems = await Item.find({ reportedBy: { $in: ids } }).select('_id title');
    const itemIds = demoItems.map((i) => i._id);

    const claimsOnDemoItems = await Claim.find({ item: { $in: itemIds } }).select('_id');
    const claimsByDemoUsers = await Claim.find({ claimant: { $in: ids } }).select('_id');
    const claimIds = [...new Set([...claimsOnDemoItems, ...claimsByDemoUsers].map((c) => String(c._id)))];

    console.log('Demo accounts found:');
    demoUsers.forEach((u) => console.log(`  ${u.email}  (${u.name})`));
    console.log(`Demo listings found: ${demoItems.length}`);
    demoItems.slice(0, 5).forEach((i) => console.log(`  ${i.title}`));
    if (demoItems.length > 5) console.log(`  ... and ${demoItems.length - 5} more`);
    console.log(`Claims to remove: ${claimIds.length}`);

    if (!APPLY) {
      console.log('\nDRY RUN - nothing was deleted.');
      console.log('Re-run with --apply to delete the records listed above:');
      console.log('  npm run cleanup:demo -- --apply');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Delete in dependency order: claims first, then items, then accounts
    const removedClaims = await Claim.deleteMany({ _id: { $in: claimIds } });
    const removedItems = await Item.deleteMany({ _id: { $in: itemIds } });
    const removedUsers = await User.deleteMany({ _id: { $in: ids } });

    console.log(`\nDeleted ${removedClaims.deletedCount} claims, ${removedItems.deletedCount} listings, ${removedUsers.deletedCount} accounts.`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
})();
