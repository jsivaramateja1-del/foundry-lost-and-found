/**
 * Auth-layer unit tests that need no database.
 *
 * Covers the university-domain rule and the email templates. The database-backed
 * flows (register, verify, login, reset) are exercised separately once a
 * Postgres instance is available.
 */
process.env.JWT_SECRET = 'test_secret_for_auth_v2_only';

const { isUniversityEmail } = require('../src/routes/auth.v2.routes');
const { templates, escapeHtml } = require('../src/lib/brevo');

let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ---- domain rule (b): any subdomain of the university domain ----
for (const email of [
  'student@saiuniversity.edu.in',
  'student@scds.saiuniversity.edu.in',
  'student@sas.saiuniversity.edu.in',
  'student@sol.saiuniversity.edu.in',
  'student@sahs.saiuniversity.edu.in',
  'someone@any.new.subdomain.saiuniversity.edu.in'
]) {
  check(`${email} is accepted`, isUniversityEmail(email) === true);
}

for (const email of [
  'someone@gmail.com',
  'someone@saiuniversity.edu.in.evil.com',
  'someone@saiuniversity.co',
  'someone@notsaiuniversity.edu.in',
  'someone@',
  'no-at-sign',
  ''
]) {
  check(`"${email}" is rejected`, isUniversityEmail(email) === false);
}

// Case and whitespace must not change the answer.
check('uppercase domain is accepted',
  isUniversityEmail('Student@SCDS.SaiUniversity.EDU.IN') === true);
check('a trailing dot domain is not silently accepted',
  isUniversityEmail('student@saiuniversity.edu.in.') === false);

// ---- templates ----
const EXPECTED = ['verification', 'welcome', 'signin', 'passwordReset',
  'itemVerified', 'itemClaimed', 'claimApproved'];
for (const name of EXPECTED) {
  const built = templates[name]({
    name: 'Test User', link: 'https://example.com/x', title: 'Black Earbuds',
    time: 'now', device: 'test'
  });
  check(`template "${name}" builds a subject and html`,
    Boolean(built.subject) && built.html.includes('Foundry'));
}

check('user-supplied values are escaped in the html', (() => {
  const built = templates.verification({
    name: '<script>alert(1)</script>', link: 'https://example.com/x'
  });
  return !built.html.includes('<script>') && built.html.includes('&lt;script&gt;');
})(), 'html injection not escaped');

check('escapeHtml handles quotes and ampersands',
  escapeHtml(`a&b<c>"d"'e'`) === 'a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');

check('an unknown template name throws rather than sending nothing',
  (() => { try { templates.nope({}); return false; } catch { return true; } })());

console.log('\n' + results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
