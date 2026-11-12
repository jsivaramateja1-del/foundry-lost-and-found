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
  { title: 'Black wireless earbuds',
    imageUrl: 'data:image/png;base64,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', category: 'Electronics', subcategory: 'Earphones',
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
  { title: 'Grey hoodie',
    imageUrl: 'data:image/png;base64,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', category: 'Clothing', subcategory: 'Jackets',
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
           (title, description, category, subcategory, location, date, type, status,
            reported_by, image_url)
         values ($1,$2,$3,$4,$5, current_date - $6::int, $7, 'open', $8, $9)`,
        [it.title, it.description, it.category, it.subcategory, it.location,
         it.daysAgo, it.type, reporter.id, it.imageUrl || null]);
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
