/**
 * Frontend registration feedback tests.
 *
 * These run the REAL frontend/assets/js/auth.js inside a stub DOM, so a fault in
 * the submit handler is caught without a browser. That matters: a handler that
 * throws before calling the API produces no network request at all, which no
 * server-side suite can ever see.
 *
 * Run with:  npm run test:frontend
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed += 1; results.push(`  PASS  ${name}`); }
  else { failed += 1; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const AUTH_JS = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'auth.js');

/** Load auth.js in a fresh stub DOM and return the wiring it produced. */
function loadAuth({ search = '', apiImpl } = {}) {
  const src = fs.readFileSync(AUTH_JS, 'utf8');
  const makeEl = (id) => ({
    id, value: '', textContent: '', type: 'text', disabled: false, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { this._handlers[t] = fn; },
    _handlers: {}, querySelector() { return null; }
  });
  const els = {};
  ['tab-login', 'tab-register', 'form-login', 'form-register', 'login-email', 'login-password',
    'login-submit', 'register-name', 'register-email', 'register-password', 'register-confirm',
    'register-submit', 'register-error', 'login-error', 'password-strength',
    'password-strength-label', 'auth-notice', 'logout'].forEach((i) => { els[i] = makeEl(i); });

  const calls = [];
  const navigations = [];
  const ctx = {
    document: { getElementById: (id) => els[id] || null, querySelectorAll: () => [], addEventListener() {} },
    console,
    window: {
      location: { search, get href() { return navigations[0] || 'auth.html'; }, set href(v) { navigations.push(v); } },
      addEventListener() {}, confirm() { return true; }
    },
    URLSearchParams, setTimeout, clearTimeout,
    api: async (url, opts) => {
      calls.push({ url, opts });
      return apiImpl ? apiImpl(url, opts) : {};
    },
    Auth: { save() {}, clear() {}, token() { return null; }, user() { return null; } },
    initTheme() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { els, calls, navigations, handler: els['form-register']._handlers.submit };
}

const submit = (h) => h({ preventDefault() {} });
const fill = (els, { name = 'A Person', email = 'a@scds.saiuniversity.edu.in', pw = 'secret123', confirm = pw } = {}) => {
  els['register-name'].value = name;
  els['register-email'].value = email;
  els['register-password'].value = pw;
  els['register-confirm'].value = confirm;
};
const registerCalls = (calls) => calls.filter((c) => c.url === '/auth/register');

(async () => {
  // ---- the handler is attached at all ----
  {
    const { handler } = loadAuth();
    check('the registration submit handler is attached', typeof handler === 'function');
  }

  // ---- a faculty address reaches the API, exactly once ----
  {
    const { els, calls, handler } = loadAuth({
      apiImpl: (url) => (url === '/auth/register'
        ? { pendingApproval: true, message: 'Waiting for approval' }
        : {})
    });
    fill(els, { email: 'person@saiuniversity.edu.in' });
    await submit(handler);

    const posts = registerCalls(calls);
    check('a faculty address sends exactly one POST /auth/register', posts.length === 1, `${posts.length} call(s)`);
    check('it uses the POST method', posts[0] && posts[0].opts && posts[0].opts.method === 'POST');
    check('it sends the form values',
      posts[0] && posts[0].opts.body.email === 'person@saiuniversity.edu.in'
      && posts[0].opts.body.password === 'secret123');
    check('a pending faculty application is reported to the user',
      /Waiting for approval/.test(els['register-error'].textContent), els['register-error'].textContent);
    check('the submit button is restored after the pending response',
      els['register-submit'].disabled === false, `disabled=${els['register-submit'].disabled}`);
  }

  // ---- a student address gets a session ----
  {
    const { els, calls, handler, navigations } = loadAuth({
      apiImpl: (url) => (url === '/auth/register'
        ? { token: 'tok', user: { id: 'u1', name: 'S', role: 'student' } }
        : {})
    });
    fill(els, { email: 'a@scds.saiuniversity.edu.in' });
    await submit(handler);
    check('a student registration is sent once', registerCalls(calls).length === 1);
    check('a successful student registration navigates on',
      navigations.length === 1, `${navigations.length} navigation(s)`);
  }

  // ---- validation stops the request, with a visible message ----
  const invalid = [
    ['an external domain', { email: 'someone@gmail.com' }, /Sai University addresses/],
    ['a lookalike domain', { email: 'someone@sai.edu' }, /Sai University addresses/],
    ['a subdomain of the faculty domain', { email: 'a@sub.saiuniversity.edu.in' }, /Sai University addresses/],
    ['a short password', { pw: '123' }, /at least 6/],
    ['a mismatched confirmation', { confirm: 'different' }, /do not match/],
    ['an empty name', { name: '   ' }, /name/]
  ];
  for (const [label, overrides, pattern] of invalid) {
    const { els, calls, handler } = loadAuth();
    fill(els, overrides);
    let threw = null;
    try { await submit(handler); } catch (e) { threw = e; }
    check(`validation refuses ${label} without calling the API`,
      threw === null && registerCalls(calls).length === 0,
      threw ? `threw ${threw.message}` : `${registerCalls(calls).length} call(s)`);
    check(`validation explains ${label}`,
      pattern.test(els['register-error'].textContent), els['register-error'].textContent);
  }

  // ---- an API error is shown, not swallowed ----
  {
    const { els, handler } = loadAuth({
      apiImpl: (url) => { if (url === '/auth/register') { const e = new Error('That address is already registered.'); throw e; } return {}; }
    });
    fill(els, {});
    await submit(handler);
    check('an API error message reaches the user',
      /already registered/.test(els['register-error'].textContent), els['register-error'].textContent);
    check('the submit button is restored after an API error',
      els['register-submit'].disabled === false);
  }

  // ---- a second click while the first is in flight sends nothing ----
  {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { els, calls, handler } = loadAuth({
      apiImpl: async (url) => { if (url === '/auth/register') { await gate; return { pendingApproval: true }; } return {}; }
    });
    fill(els, {});
    const first = submit(handler);
    check('the button is disabled while the request is in flight', els['register-submit'].disabled === true);
    release();
    await first;
    check('one click produces one registration request', registerCalls(calls).length === 1,
      `${registerCalls(calls).length} call(s)`);
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Frontend suite crashed:', err.message);
  console.log(results.join('\n'));
  process.exit(1);
});
