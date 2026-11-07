/**
 * Re-create point awards that were never written.
 *
 * A business action can succeed while its award fails before the ledger row is
 * created — a dropped connection, a restart, a crash. Nothing in the ledger
 * records that, so reconciliation cannot see it. This script rebuilds the
 * missing rows from the business records themselves: found listings and
 * returned listings are eligible, and nothing else is.
 *
 * Every award goes through the same idempotent path the application uses, so
 * running it twice, running it while the site is live, or running two copies at
 * once cannot double-pay.
 *
 *   npm run recover:awards                       report only, all time
 *   npm run recover:awards -- --apply            create the missing awards
 *   npm run recover:awards -- --since-days 90 --apply    narrower window
 *   npm run recover:awards -- --batch-size 500 --apply   bigger pages (max 1000)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const {
  recoverMissingAwards,
  resolveBatchSize,
  MAX_BATCH_SIZE
} = require('../src/utils/gamification');
const { parsePositiveInt } = require('../src/utils/reconcile');

/** Read the value of a flag, refusing a missing one instead of guessing. */
const flagValue = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || String(value).startsWith('--')) {
    console.error(`\n${name} needs a value.`);
    process.exit(1);
  }
  return value;
};

const APPLY = process.argv.includes('--apply');
// No window by default: recovery looks at every eligible record, however old.
// --since-days narrows it deliberately.
const rawBatchSize = flagValue('--batch-size');
const rawSinceDays = flagValue('--since-days');

let batchSize;
try {
  // Reject nonsense loudly. Coercing it to a default hides operator mistakes.
  batchSize = resolveBatchSize(rawBatchSize);
} catch (err) {
  console.error(`\n${err.message}`);
  console.error(`--batch-size accepts a whole number from 1 to ${MAX_BATCH_SIZE}.`);
  process.exit(1);
}

let sinceDays = null;
if (rawSinceDays !== undefined) {
  try {
    sinceDays = parsePositiveInt(rawSinceDays, '--since-days');
  } catch (err) {
    console.error(`\n${err.message}`);
    console.error('Omit --since-days entirely to scan all time.');
    process.exit(1);
  }
}

(async () => {
  try {
    const conn = await connectDB();
    console.log(`\nConnected to host=${conn.connection.host} database=${conn.connection.name}`);
    const report = await recoverMissingAwards({ sinceDays, apply: APPLY, batchSize });

    console.log(`\nWindow:                   ${report.window}`);
    console.log(`Records scanned:          ${report.scanned} (${report.batches} page(s) of ${batchSize})`);
    console.log(`Eligible awards:          ${report.eligible}`);
    console.log(`Awards already recorded:  ${report.alreadyPresent}`);
    console.log(`Awards missing:           ${report.missing}`);

    if (report.missingSample.length) {
      console.log(`\nSample of missing awards (up to ${report.sampleLimit}):`);
      report.missingSample.forEach((key) => console.log(`  ${key}`));
      if (report.samplesTruncated) console.log('  ... the sample is capped; the count above is exact.');
    }

    if (!APPLY) {
      console.log('\nDRY RUN - nothing was written.');
      console.log('To create the missing awards: npm run recover:awards -- --apply');
    } else {
      console.log(`\nAwards created: ${report.awarded}`);
      console.log(`Failures:       ${report.failed}`);
      if (report.failedSample.length) {
        console.log('\nSample of failures:');
        report.failedSample.forEach((line) => console.log(`  ${line}`));
        if (report.samplesTruncated) console.log('  ... the sample is capped; the count above is exact.');
        console.log('These need attention; run again once the cause is fixed.');
      }
    }

    await mongoose.connection.close();
    process.exit(report.failed && APPLY ? 1 : 0);
  } catch (err) {
    console.error('Recovery failed:', err.message);
    process.exit(1);
  }
})();
