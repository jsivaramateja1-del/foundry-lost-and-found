/**
 * Unit tests for the connection-string and TLS decisions.
 *
 * These paths broke a real deployment twice: an sslmode parameter silently
 * overriding the TLS settings, and the direct Supabase host being IPv6-only.
 * They need no database, so they run anywhere.
 */
process.env.JWT_SECRET = 'connection_test_secret';

const { resolveConnection } = require('../src/config/pg');

let passed = 0, failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const POOLER = 'postgresql://postgres.abc:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
const DIRECT = 'postgresql://postgres:secret@db.abc.supabase.co:5432/postgres';

// ---- sslmode must not override the explicit TLS settings ----
for (const mode of ['disable', 'no-verify', 'require', 'prefer']) {
  const r = resolveConnection(`${POOLER}?sslmode=${mode}`, {});
  check(`sslmode=${mode} is stripped from the connection string`,
    !r.connectTarget.includes('sslmode'), r.connectTarget);
  check(`sslmode=${mode} raises the ignored warning`, r.warnings.includes('sslmode-ignored'));
}

// ---- the IPv6 trap ----
check('the direct Supabase host is flagged',
  resolveConnection(DIRECT, {}).warnings.includes('direct-host'));
check('the pooler host is not flagged',
  !resolveConnection(POOLER, {}).warnings.includes('direct-host'));

// ---- TLS modes ----
check('default verifies the certificate',
  resolveConnection(POOLER, {}).ssl.rejectUnauthorized === true);
check('PG_NO_SSL disables TLS entirely',
  resolveConnection(POOLER, { PG_NO_SSL: 'true' }).ssl === false);
check('PG_SSL_NO_VERIFY accepts any certificate',
  resolveConnection(POOLER, { PG_SSL_NO_VERIFY: 'true' }).ssl.rejectUnauthorized === false);
check('PG_SSL_NO_VERIFY raises the warning',
  resolveConnection(POOLER, { PG_SSL_NO_VERIFY: 'true' }).warnings.includes('no-verify'));
check('PG_NO_SSL wins over PG_SSL_NO_VERIFY',
  resolveConnection(POOLER, { PG_NO_SSL: 'true', PG_SSL_NO_VERIFY: 'true' }).ssl === false);

// ---- an unreadable CA must be visible, not silent ----
const unreadable = resolveConnection(POOLER, { PG_CA_CERT_PATH: '/nonexistent/ca.crt' });
check('an unreadable CA is reported', unreadable.warnings.includes('ca-unreadable'));

// ---- a URL that will not parse must not throw here ----
let threw = false;
try { resolveConnection('not a url', {}); } catch { threw = true; }
check('an unparseable URL does not throw', threw === false);

console.log('\n' + results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
