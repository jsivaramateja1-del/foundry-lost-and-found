/**
 * Stage 1 regression tests — the six critical defects.
 * No database needed: exercises the two pure functions the fixes introduced,
 * plus the secret-resolution logic.
 */
process.env.JWT_SECRET = 'stage1_test_secret_that_is_definitely_long_enough_32';

const { rateLimitKey } = require('../src/routes/auth.v2.routes');
const { handoverCode, handoverKey } = require('../src/routes/claims.v2.routes');

let passed = 0, failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed++; results.push(`  PASS  ${name}`); }
  else { failed++; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const req = (body, ip = '10.0.0.1') => ({ ip, body });
const base = rateLimitKey(req({ email: 'victim@scds.saiuniversity.edu.in' }));
check('plain email produces a key', typeof base === 'string' && base.length > 0);
for (const v of ['victim@scds.saiuniversity.edu.in ', ' victim@scds.saiuniversity.edu.in',
  '  victim@scds.saiuniversity.edu.in  ', 'victim@scds.saiuniversity.edu.in\t',
  'victim@scds.saiuniversity.edu.in\n'])
  check(`whitespace variant ${JSON.stringify(v)} shares the bucket`, rateLimitKey(req({ email: v })) === base);
for (const v of ['VICTIM@SCDS.SAIUNIVERSITY.EDU.IN', 'Victim@Scds.SaiUniversity.Edu.In',
  'vIcTiM@sCdS.sAiUnIvErSiTy.EdU.iN'])
  check(`case variant ${JSON.stringify(v)} shares the bucket`, rateLimitKey(req({ email: v })) === base);
check('case AND whitespace together share the bucket',
  rateLimitKey(req({ email: '  ViCtIm@Scds.SaiUniversity.Edu.In  ' })) === base);
check('a different account gets a different bucket',
  rateLimitKey(req({ email: 'other@scds.saiuniversity.edu.in' })) !== base);
check('the same account from a different IP gets a different bucket',
  rateLimitKey(req({ email: 'victim@scds.saiuniversity.edu.in' }, '10.0.0.2')) !== base);
check('token-only requests key on the token',
  rateLimitKey(req({ token: 'a'.repeat(32) })) !== rateLimitKey(req({ token: 'b'.repeat(32) })));
check('a missing body does not throw', typeof rateLimitKey({ ip: '1.2.3.4' }) === 'string');

delete process.env.HANDOVER_SECRET;
const fromJwt = handoverCode('11111111-2222-3333-4444-555555555555');
check('falls back to JWT_SECRET when HANDOVER_SECRET is unset', /^\d{6}$/.test(fromJwt));
process.env.HANDOVER_SECRET = 'a_dedicated_handover_secret_for_stage_one';
const fromDedicated = handoverCode('11111111-2222-3333-4444-555555555555');
check('HANDOVER_SECRET takes precedence when set', /^\d{6}$/.test(fromDedicated));
check('the dedicated key produces a different code', fromDedicated !== fromJwt);
check('the same claim id and key are deterministic',
  handoverCode('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') === handoverCode('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
delete process.env.HANDOVER_SECRET;
const before = handoverCode('99999999-8888-7777-6666-555555555555');
process.env.JWT_SECRET = 'a_completely_different_secret_that_is_also_32_chars';
check('the code depends on the real secret, not a literal',
  before !== handoverCode('99999999-8888-7777-6666-555555555555'));
const saved = process.env.JWT_SECRET;
delete process.env.JWT_SECRET; delete process.env.HANDOVER_SECRET;
let threw = false; try { handoverKey(); } catch (e) { threw = true; }
check('throws when neither secret is configured', threw);
process.env.JWT_SECRET = saved;
let allSix = true;
for (let i = 0; i < 200; i++) if (!/^\d{6}$/.test(handoverCode(`claim-${i}`))) { allSix = false; break; }
check('200 generated codes are all exactly six digits', allSix);

console.log(results.join('\n'));
console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
