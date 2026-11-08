/**
 * Seeds the campus locations that can be verified from public sources.
 *
 * Deliberately minimal, exactly as the MongoDB version was: the university's
 * published address and its coordinates, and nothing else. Building-level
 * markers are NOT seeded — inventing them would put fabricated places on a map.
 * Administrators add real buildings through POST /api/campus/locations, which
 * requires a source for each one.
 *
 * Idempotent: re-running changes nothing.
 *
 *   npm run seed:campus
 */
require('dotenv').config();
const { connectDB, one, closeDB } = require('../src/config/pg');

const CAMPUS = [
  {
    name: 'Sai University Main Campus',
    kind: 'landmark',
    description: 'One Hub Road, Old Mahabalipuram Road, Paiyanur, Chennai 603104. 103-acre campus.',
    lat: 12.65416,
    lng: 80.15771,
    source: 'University contact page (saiuniversity.edu.in) and Wikipedia coordinates 12°39′15″N 80°09′28″E',
    // The published page this address and coordinate come from. The API derives
    // `verified` from this field, so omitting it would publish the one location
    // we can actually vouch for as "Unverified".
    sourceUrl: 'https://www.saiuniversity.edu.in/sai-university-contact'
  }
];

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  try {
    await connectDB();

    for (const place of CAMPUS) {
      const existing = await one(
        'select id from campus_locations where lower(name) = lower($1)', [place.name]);

      if (existing) {
        console.log(`"${place.name}" already exists. Nothing to do.`);
        continue;
      }

      await one(
        `insert into campus_locations
           (name, kind, description, lat, lng, source, source_url)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [place.name, place.kind, place.description, place.lat, place.lng,
         place.source, place.sourceUrl]);
      console.log(`Created "${place.name}".`);
    }

    const total = await one('select count(*)::int as n from campus_locations');
    console.log(`campus_locations now holds ${total.n} row(s).`);
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDB().catch(() => {});
  }
})();
