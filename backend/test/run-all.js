#!/usr/bin/env node
/**
 * Run every test file and print one summary.
 *
 * Files that need a database skip themselves when TEST_DATABASE_URL is unset, so
 * `npm test` works on a fresh checkout with no setup and still covers everything
 * once a database is configured. A skipped file is reported as skipped, never as
 * passed, so the summary cannot overstate what ran.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

console.log(`Running ${files.length} test files\n`);

for (const file of files) {
  const out = spawnSync(process.execPath, [path.join(dir, file)], {
    encoding: 'utf8',
    env: process.env,
  });
  const text = (out.stdout || '') + (out.stderr || '');
  /* A file counts as skipped when it says so, or when it produced no assertions
     at all — the database-backed files return quietly without TEST_DATABASE_URL,
     and reporting those as "0 assertions passed" would overstate the run. */
  const noOutput = text.trim() === '';
  const skippedHere = /^\s*SKIP\b/m.test(text);
  const m = text.match(/(\d+) passed/);
  const n = m ? Number(m[1]) : (text.match(/^PASS/gm) || []).length;

  if (out.status !== 0) {
    failed += 1;
    failures.push(file);
    console.log(`  FAIL  ${file.replace('.test.js', '').padEnd(22)} ${text.trim().split('\n').pop().slice(0, 60)}`);
  } else if (skippedHere || n === 0) {
    skipped += 1;
    console.log(`  SKIP  ${file.replace('.test.js', '').padEnd(22)} needs TEST_DATABASE_URL`);
  } else {
    passed += n;
    console.log(`  ok    ${file.replace('.test.js', '').padEnd(22)} ${n} assertion(s)`);
  }
}

console.log(`\n${passed} assertions passed, ${failed} file(s) failed, ${skipped} file(s) skipped.`);
if (failed) {
  console.log('\nFailed files:');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(failed ? 1 : 0);
