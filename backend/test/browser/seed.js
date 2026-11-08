/**
 * Seeds a disposable Postgres database for the browser tests.
 *
 * Inserts one verified student with a known password and three listings, so the
 * UI has something real to render. Truncates first: this must only ever run
 * against TEST_DATABASE_URL, which is disposable by definition.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB, one, many, closeDB } = require('../../src/config/pg');

const PASSWORD = 'BrowserTest123';

(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    console.error('TEST_DATABASE_URL is required to seed the browser tests.');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.PG_NO_SSL = 'true';

  await connectDB();
  await many('truncate users, items, claims, notifications, point_events, reports, audit_logs, campus_locations restart identity cascade');

  const hash = await bcrypt.hash(PASSWORD, 10);
  const student = await one(
    `insert into users (name, email, password, role, email_verified, points, returns)
     values ('Browser Student', 'browser@scds.saiuniversity.edu.in', $1, 'student', true, 12, 1)
     returning id`, [hash]);

  const items = [
    ['Black Wireless Earbuds', 'found', 'Electronics', 'Library', '2026-11-01'],
    ['Student ID Card', 'lost', 'IDs & Cards', 'Main Block', '2026-11-02'],
    ['Blue Water Bottle', 'found', 'Bottles', 'Canteen', '2026-11-03']
  ];
  for (const [title, type, category, location, date] of items) {
    await one(
      `insert into items (title, description, category, location, date, type, reported_by, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'open')`,
      [title, `Seeded listing: ${title}`, category, location, date, type, student.id]);
  }

  // A notification, so the bell has something to show.
  await one(
    `insert into notifications (user_id, type, message, link)
     values ($1, 'seed', 'Welcome to the browser test seed', 'dashboard.html')`, [student.id]);

  console.log(`Seeded: ${student.id}, ${items.length} items, password ${PASSWORD}`);
  await closeDB();
})().catch((err) => { console.error(err); process.exit(1); });
