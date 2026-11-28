#!/usr/bin/env node
/**
 * Attach photographs to listings that have none.
 *
 * The seeded demo listings were inserted without pictures, so the board shows
 * empty cards. This script reads images from a folder and attaches each one to
 * the listing whose title matches the filename.
 *
 *   node tools/add-listing-photos.js ./photos
 *
 * The folder should contain files named after the listing titles, for example:
 *
 *   photos/Blue Water Bottle.jpg
 *   photos/Boat Rockers Headset.jpg
 *   photos/Grey hoodie.jpg
 *
 * Matching ignores case, spacing and punctuation, so "blue-water-bottle.jpg"
 * also matches "Blue Water Bottle". A photo is shrunk to 1600px and 700 KB
 * before it is written, the same limits the browser enforces on upload.
 *
 * Only rows whose image_url is empty are touched, so a photograph you uploaded
 * through the application is never overwritten. Run with --dry-run to see what
 * would happen without writing anything.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { connectDB, many, one, closeDB } = require('../src/config/pg');

const MAX_SIDE = 1600;
const MAX_BYTES = 700 * 1024;

function normalise(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function shrink(file) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    throw new Error('This script needs sharp. Run: npm install sharp');
  }
  return sharp(file)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
    .then((buf) => {
      if (buf.length <= MAX_BYTES) return buf;
      return sharp(file)
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();
    })
    .then((buf) => {
      if (buf.length > MAX_BYTES) {
        throw new Error(`${path.basename(file)} is still ${Math.round(buf.length / 1024)} KB after shrinking`);
      }
      return 'data:image/jpeg;base64,' + buf.toString('base64');
    });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const folder = args.find((a) => !a.startsWith('--'));

  if (!folder) {
    console.error('Usage: node tools/add-listing-photos.js <folder> [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(folder)) {
    console.error('No such folder: ' + folder);
    process.exit(1);
  }

  const files = fs.readdirSync(folder)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => ({ file: path.join(folder, f), key: normalise(path.parse(f).name) }));

  if (!files.length) {
    console.error('No images found in ' + folder);
    process.exit(1);
  }

  await connectDB();

  const listings = await many(
    "select id, title from items where coalesce(image_url,'') = '' order by title"
  );

  if (!listings.length) {
    console.log('Every listing already has a photograph. Nothing to do.');
    await closeDB();
    return;
  }

  console.log(`${listings.length} listing(s) without a photograph, ${files.length} image(s) available.`);
  if (dryRun) console.log('DRY RUN — nothing will be written.\n');

  let attached = 0;
  let missed = [];

  for (const item of listings) {
    const key = normalise(item.title);
    const hit = files.find((f) => f.key === key) || files.find((f) => f.key.startsWith(key) || key.startsWith(f.key));

    if (!hit) {
      missed.push(item.title);
      continue;
    }

    try {
      const dataUrl = await shrink(hit.file);
      if (!dryRun) {
        await one('update items set image_url = $2 where id = $1', [item.id, dataUrl]);
      }
      console.log(`${dryRun ? 'would attach' : 'attached'}  ${path.basename(hit.file)}  ->  ${item.title}  (${Math.round(dataUrl.length / 1024)} KB)`);
      attached += 1;
    } catch (err) {
      console.error(`failed    ${item.title}: ${err.message}`);
    }
  }

  console.log(`\n${attached} of ${listings.length} listing(s) ${dryRun ? 'would be' : 'were'} given a photograph.`);

  if (missed.length) {
    console.log('\nNo matching image for these listings:');
    missed.forEach((t) => console.log('  - ' + t));
    console.log('\nName a file after the listing to include it, for example:');
    console.log('  ' + path.join(folder, missed[0] + '.jpg'));
  }

  await closeDB();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
