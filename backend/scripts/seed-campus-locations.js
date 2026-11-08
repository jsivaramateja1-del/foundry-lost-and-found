/**
 * Seeds the one campus location that can be verified from public sources.
 *
 * Deliberately minimal: the university's published campus address and its
 * coordinates. Building-level markers are NOT seeded, because inventing them
 * would put fabricated places on a map. Administrators add real buildings
 * through POST /api/campus/locations, which requires a source for each one.
 *
 * Run with:  npm run seed:campus
 */
const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('../src/config/db');
const CampusLocation = require('../src/models/CampusLocation');

const CAMPUS = {
  name: 'Sai University Main Campus',
  kind: 'landmark',
  description: 'One Hub Road, Old Mahabalipuram Road, Paiyanur, Chennai 603104. 103-acre campus.',
  lat: 12.65416,
  lng: 80.15771,
  source: 'University contact page (saiuniversity.edu.in) and Wikipedia coordinates 12°39′15″N 80°09′28″E'
};

(async () => {
  try {
    await connectDB();
    const existing = await CampusLocation.findOne({ name: CAMPUS.name });
    if (existing) {
      console.log(`"${CAMPUS.name}" already exists. Nothing to do.`);
    } else {
      await CampusLocation.create(CAMPUS);
      console.log(`Created "${CAMPUS.name}".`);
    }
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
