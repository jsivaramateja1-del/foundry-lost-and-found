/**
 * Seeds sample listings for the demo and the project report.
 *
 * The assignment requires at least 10 sample item records; the portal also
 * needs enough data for the Campus Explorer to show real counts on the plan.
 *
 * Safe to run more than once: every listing is keyed on its title, so a second
 * run skips what is already there instead of duplicating it.
 *
 *   npm run seed:demo
 *
 * To remove everything this script added:
 *
 *   delete from items where title in (select title from items where description = 'Sample listing seeded for the project demo.');
 *
 * Listings are attached to the first student account found. If there is no
 * account at all the script stops and tells you to register one first.
 */
require('dotenv').config();
const { connectDB, one, many, closeDB } = require('../src/config/pg');

const MARKER = 'Sample listing seeded for the project demo.';

// Spread across the campus places so the Explorer plan has something to show.
const ITEMS = [
  { title: 'Black wireless earbuds', category: 'Electronics', subcategory: 'Earphones',
    location: 'AB1', type: 'found', daysAgo: 1,
    description: 'Black case, small scuff on the lid. Found on a table in the reading area after the afternoon lecture.' },
  { title: 'Student ID card', category: 'IDs & Cards', subcategory: 'Student ID',
    location: 'AB2', type: 'lost', daysAgo: 2,
    description: 'Second year CSE. Lost somewhere between the second floor and the car park.' },
  { title: 'Blue steel water bottle', category: 'Bottles', subcategory: 'Water Bottle',
    location: 'Mamatha', type: 'found', daysAgo: 3,
    description: 'Blue steel bottle, dent near the base, name sticker half peeled off. Left in the common room.' },
  { title: 'Casio FX-991 calculator', category: 'Electronics', subcategory: 'Other Electronics',
    location: 'Guruvayur', type: 'lost', daysAgo: 4,
    description: 'Grey Casio, the cover has my roll number written on the inside in blue ink.' },
  { title: 'Grey hoodie', category: 'Clothing', subcategory: 'Jackets',
    location: 'Lords', type: 'found', daysAgo: 5,
    description: 'Plain grey hoodie, medium, left on the back of a chair in the TV room.' },
  { title: 'Prescription glasses', category: 'Keys & Accessories', subcategory: 'Spectacles',
    location: 'Sai Baba Temple', type: 'lost', daysAgo: 6,
    description: 'Thin black frame, left in a soft cloth pouch. Needed for reading the board.' },
  { title: 'Spiral notebook, Data Structures', category: 'Books & Notes', subcategory: 'Notebooks',
    location: 'AB1', type: 'found', daysAgo: 7,
    description: 'Spiral bound, green cover, full of tree and graph diagrams. Found in the first floor classroom.' },
  { title: 'Navy blue umbrella', category: 'Keys & Accessories', subcategory: 'Umbrellas',
    location: 'Outside Campus', type: 'lost', daysAgo: 8,
    description: 'Folding umbrella, navy with a wooden handle. Left in an auto on the way back to campus.' },
  { title: 'Silver bracelet', category: 'Keys & Accessories', subcategory: 'Other',
    location: 'Girls Hostel', type: 'found', daysAgo: 9,
    description: 'Thin silver bracelet with a small clasp. Found near the entrance steps.' },
  { title: 'Football, size 5', category: 'Other', subcategory: '',
    location: 'Football Ground', type: 'found', daysAgo: 10,
    description: 'Standard size 5, slightly worn, white and green panels. Left by the goal post.' },
  { title: 'Cricket bat, MRF', category: 'Other', subcategory: '',
    location: 'Cricket Nets', type: 'lost', daysAgo: 11,
    description: 'MRF bat with a red grip and my initials taped on the handle. Left after evening practice.' },
  { title: 'Lab coat, size M', category: 'Clothing', subcategory: 'Other',
    location: 'Animal Planet', type: 'lost', daysAgo: 12,
    description: 'White lab coat, medium, name written on the collar tag. Left in the chemistry lab.' }
];

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  try {
    await connectDB();

    const reporter = await one(
      "select id, name from users where role = 'student' order by created_at limit 1");
    if (!reporter) {
      console.error('No student account exists yet. Register one in the app, then run this again.');
      process.exit(1);
    }

    let created = 0;
    let skipped = 0;

    for (const it of ITEMS) {
      const existing = await one(
        'select id from items where title = $1 and description = $2',
        [it.title, it.description]);
      if (existing) { skipped += 1; continue; }

      await one(
        `insert into items
           (title, description, category, subcategory, location, date, type, status, reported_by)
         values ($1,$2,$3,$4,$5, current_date - $6::int, $7, 'open', $8)`,
        [it.title, it.description, it.category, it.subcategory, it.location,
         it.daysAgo, it.type, reporter.id]);
      created += 1;
    }

    const total = await one('select count(*)::int as n from items');
    const places = await one('select count(distinct location)::int as n from items');

    console.log(`Created ${created}, skipped ${skipped} (already present).`);
    console.log(`Database now holds ${total.n} listings across ${places.n} campus places.`);
    console.log(`Reporter account: ${reporter.name}`);
    if (total.n < 10) {
      console.log('WARNING: the assignment requires at least 10 sample records.');
    }
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDB().catch(() => {});
  }
})();
