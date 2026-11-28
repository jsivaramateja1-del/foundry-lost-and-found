#!/usr/bin/env node
/**
 * Replace the photographs on listings.
 *
 *   node tools/listing-photos.js --clear              remove every listing photo
 *   node tools/listing-photos.js --fetch              download and attach
 *   node tools/listing-photos.js --from ./photos      attach your own files
 *   add --dry-run to any of the above to see what would happen
 *
 * --fetch matches each listing against the catalogue below by reading its title,
 * sub-category and category, then downloads the matching photograph from Pexels
 * (free licence; direct image URLs need no key).
 *
 * --from takes a folder of images named after the listing titles, for when you
 * want your own photographs instead.
 *
 * --fetch and --from only touch listings that have no photograph, so a picture
 * uploaded through the application is never overwritten. --clear removes them
 * all, which is what makes a full replacement possible.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const PEXELS = (id, ext) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext || 'jpeg'}?auto=compress&cs=tinysrgb&w=1200`;

/**
 * Catalogue: keywords -> Pexels photo id.
 *
 * Order matters: a listing is matched against the first entry it hits, and the
 * whole title, sub-category, category and description are searched together.
 * 'student id card' therefore has to come before the vehicle entry, or the 'car'
 * inside 'card' would match a car.
 *
 * Every id was opened and its own description read before being added, so each
 * depicts the thing it is attached to. Keyword lists are kept narrow: 'coat' is
 * not under the hoodie entry and 'earbud' is not under the headphones entry,
 * because a lab coat is not a hoodie and earbuds are not over-ear headphones.
 */
const CATALOGUE = [
  { keys: ['student id', 'id card', 'identity card', 'badge', 'lanyard'], id: 8761297 },
  { keys: ['football', 'soccer'], id: 12757100, ext: 'png' },
  { keys: ['cricket'], id: 35981347 },
  { keys: ['umbrella'], id: 9838761 },
  { keys: ['earbud', 'airpod', 'earphone'], id: 26550470 },
  { keys: ['headset', 'headphone'], id: 6587325 },
  { keys: ['calculator'], id: 8250936 },
  { keys: ['glasses', 'spectacles', 'eyeglass'], id: 9201657 },
  { keys: ['notebook', 'spiral'], id: 6353763 },
  { keys: ['bracelet'], id: 39076759 },
  { keys: ['lab coat'], id: 8851786 },
  { keys: ['water bottle', 'bottle', 'tumbler', 'flask'], id: 2832062 },
  { keys: ['hoodie', 'sweatshirt'], id: 6311642 },
  { keys: ['car', 'suv', 'vehicle'], id: 4149331 },
];

const MAX_SIDE = 1600;
const MAX_BYTES = 700 * 1024;

function normalise(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickPhoto(item) {
  const hay = [item.title, item.subcategory, item.category, item.description]
    .filter(Boolean).join(' ').toLowerCase();
  for (const entry of CATALOGUE) {
    if (entry.keys.some((k) => hay.includes(k))) return entry;
  }
  return null;
}

/**
 * Fetch a URL as a Buffer.
 *
 * curl is tried first because it honours HTTPS_PROXY, follows redirects and
 * handles TLS in one step. Node's own https module ignores the proxy, which is
 * fine on a laptop but fails anywhere behind one. https.get is the fallback for
 * machines without curl.
 */
function viaCurl(url) {
  const buf = execFileSync('curl',
    ['-sSL', '--max-time', '45', '-A', 'foundry-report/1.0', url],
    { maxBuffer: 20 * 1024 * 1024 });
  if (!buf || buf.length < 1000) throw new Error('curl returned nothing');
  return buf;
}

function viaHttps(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'foundry-report/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return viaHttps(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function download(url) {
  try {
    return viaCurl(url);
  } catch (e) {
    return viaHttps(url);
  }
}

function shrink(buffer, label) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    throw new Error('This script needs sharp. Run: npm install sharp');
  }
  const base = () => sharp(buffer).rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });

  return base().jpeg({ quality: 82 }).toBuffer()
    .then((buf) => (buf.length <= MAX_BYTES ? buf : base().jpeg({ quality: 60 }).toBuffer()))
    .then((buf) => {
      if (buf.length > MAX_BYTES) {
        throw new Error(`${label} is still ${Math.round(buf.length / 1024)} KB after shrinking`);
      }
      return 'data:image/jpeg;base64,' + buf.toString('base64');
    });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const clear = args.includes('--clear');
  const fetchMode = args.includes('--fetch');
  const fromIdx = args.indexOf('--from');
  const fromDir = fromIdx !== -1 ? args[fromIdx + 1] : null;

  if (!clear && !fetchMode && !fromDir) {
    console.error('Usage: node tools/listing-photos.js [--clear | --fetch | --from <folder>] [--dry-run]');
    process.exit(1);
  }
  if (fromDir && !fs.existsSync(fromDir)) {
    console.error('No such folder: ' + fromDir);
    process.exit(1);
  }

  const { connectDB, many, one, closeDB } = require('../src/config/pg');
  await connectDB();

  if (clear) {
    const before = await many("select id from items where coalesce(image_url,'') <> ''");
    if (!dryRun) await many("update items set image_url = '' where coalesce(image_url,'') <> ''");
    console.log(`${dryRun ? 'would clear' : 'cleared'} photographs on ${before.length} listing(s).`);
    if (!fetchMode && !fromDir) { await closeDB(); return; }
  }

  const listings = await many(
    "select id, title, description, category, subcategory from items where coalesce(image_url,'') = '' order by title"
  );
  if (!listings.length) {
    console.log('No listings are without a photograph.');
    await closeDB();
    return;
  }
  console.log(`${listings.length} listing(s) to photograph.`);

  let files = [];
  if (fromDir) {
    files = fs.readdirSync(fromDir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => ({ file: path.join(fromDir, f), key: normalise(path.parse(f).name) }));
  }

  let done = 0;
  const missed = [];

  for (const item of listings) {
    let source = null;
    let label = '';

    if (fromDir) {
      const key = normalise(item.title);
      const hit = files.find((f) => f.key === key)
        || files.find((f) => f.key.startsWith(key) || key.startsWith(f.key));
      if (hit) { source = () => Promise.resolve(fs.readFileSync(hit.file)); label = path.basename(hit.file); }
    } else {
      const photo = pickPhoto(item);
      if (photo) { source = () => download(PEXELS(photo.id, photo.ext)); label = 'pexels ' + photo.id; }
    }

    if (!source) { missed.push(item.title); continue; }

    try {
      const raw = await source();
      const dataUrl = await shrink(raw, item.title);
      if (!dryRun) await one('update items set image_url = $2 where id = $1', [item.id, dataUrl]);
      console.log(`${dryRun ? 'would attach' : 'attached'}  ${label}  ->  ${item.title}  (${Math.round(dataUrl.length / 1024)} KB)`);
      done += 1;
    } catch (err) {
      console.error(`failed    ${item.title}: ${err.message}`);
      missed.push(item.title);
    }
  }

  console.log(`\n${done} of ${listings.length} listing(s) ${dryRun ? 'would be' : 'were'} photographed.`);
  if (missed.length) {
    console.log('\nNo photograph available for these — add them to CATALOGUE, or use --from:');
    missed.forEach((t) => console.log('  - ' + t));
  }

  await closeDB();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
