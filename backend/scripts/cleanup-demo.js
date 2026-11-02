/**
 * Removes demo data left behind by the old seed script.
 *
 * Two situations are handled separately, because they need different levels
 * of trust:
 *
 *   1. Demo accounts still exist. Their listings and the claims on them are
 *      unambiguous demo data.
 *   2. The demo accounts are gone but their listings remain ("orphaned"
 *      listings: the reporter id no longer resolves to any user). These are
 *      probably demo data, but not certainly, so they are only removed when
 *      you ask for them explicitly with --include-orphans.
 *
 * Dry run by default. Nothing is deleted until you pass --apply.
 *
 *   npm run cleanup:demo                          (report only)
 *   npm run cleanup:demo -- --apply               (delete demo accounts + their data)
 *   npm run cleanup:demo -- --apply --include-orphans
 *                                                 (also delete listings whose
 *                                                  reporter no longer exists)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Item = require('../src/models/Item');
const Claim = require('../src/models/Claim');
const Notification = require('../src/models/Notification');

const DEMO_EMAILS = [
  'admin@saiuniversity.edu.in',
  'student@saiuniversity.edu.in',
  'priya@saiuniversity.edu.in'
];

const APPLY = process.argv.includes('--apply');
const INCLUDE_ORPHANS = process.argv.includes('--include-orphans');

(async () => {
  try {
    const conn = await connectDB();
    console.log(`\nConnected to host=${conn.connection.host} database=${conn.connection.name}`);

    const demoUsers = await User.find({ email: { $in: DEMO_EMAILS } }).select('_id email name');
    const demoIds = demoUsers.map((u) => u._id);

    const demoItems = demoIds.length
      ? await Item.find({ reportedBy: { $in: demoIds } }).select('_id title')
      : [];
    const demoItemIds = demoItems.map((i) => i._id);

    // Listings whose reporter no longer exists in this database
    const existingUserIds = await User.distinct('_id');
    const orphanItems = await Item.find({ reportedBy: { $nin: existingUserIds } }).select('_id title');

    const claimsOnDemoItems = await Claim.find({
      $or: [{ item: { $in: demoItemIds } }, { claimant: { $in: demoIds } }]
    }).select('_id');

    console.log('\n--- What I found ---');
    if (demoUsers.length) {
      console.log(`Demo accounts (${demoUsers.length}):`);
      demoUsers.forEach((u) => console.log(`  ${u.email}  (${u.name})`));
    } else {
      console.log('Demo accounts: none of the three old demo emails exist in THIS database.');
    }
    console.log(`Listings owned by those demo accounts: ${demoItems.length}`);
    demoItems.slice(0, 10).forEach((i) => console.log(`  ${i.title}`));
    if (demoItems.length > 10) console.log(`  ... and ${demoItems.length - 10} more`);
    console.log(`Claims attached to them: ${claimsOnDemoItems.length}`);
    console.log(`Orphaned listings (reporter no longer exists): ${orphanItems.length}`);
    orphanItems.slice(0, 10).forEach((i) => console.log(`  ${i.title}`));

    if (!demoUsers.length && !orphanItems.length) {
      console.log('\nNothing to clean up in this database.');
      console.log('If the website still shows sample listings, you are looking at a');
      console.log('different database. Compare the host and database name above with');
      console.log('the "MongoDB Connected" line in the Render logs.');
      await mongoose.connection.close();
      process.exit(0);
    }

    if (!APPLY) {
      console.log('\nDRY RUN - nothing was deleted.');
      console.log('To delete the demo accounts and their listings:');
      console.log('  npm run cleanup:demo -- --apply');
      if (orphanItems.length && !INCLUDE_ORPHANS) {
        console.log('\nOrphaned listings are left alone by default. To remove them too:');
        console.log('  npm run cleanup:demo -- --apply --include-orphans');
      }
      await mongoose.connection.close();
      process.exit(0);
    }

    const itemIdsToDelete = [...demoItemIds, ...(INCLUDE_ORPHANS ? orphanItems.map((i) => i._id) : [])];

    const removedClaims = await Claim.deleteMany({
      $or: [{ item: { $in: itemIdsToDelete } }, { claimant: { $in: demoIds } }]
    });
    const removedItems = await Item.deleteMany({ _id: { $in: itemIdsToDelete } });
    const removedNotifications = demoIds.length
      ? await Notification.deleteMany({ user: { $in: demoIds } })
      : { deletedCount: 0 };
    const removedUsers = demoIds.length
      ? await User.deleteMany({ _id: { $in: demoIds } })
      : { deletedCount: 0 };

    console.log(`\nDeleted ${removedClaims.deletedCount} claims, ${removedItems.deletedCount} listings, ${removedNotifications.deletedCount} notifications, ${removedUsers.deletedCount} accounts.`);
    if (orphanItems.length && !INCLUDE_ORPHANS) {
      console.log(`${orphanItems.length} orphaned listing(s) were left in place.`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
})();
