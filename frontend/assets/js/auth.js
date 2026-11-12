/* auth.js — login and registration */

const params = new URLSearchParams(window.location.search);

// Where to send the student after a successful login.
// Only accept a plain page on this site: a ?next= value such as
// "//evil.example/login" would otherwise redirect them off-site.
const requestedNext = params.get('next') || '';

// Where a successful login (or registration) lands when nothing more specific
// was asked for. A student who has just signed in wants their own dashboard,
// not the public board. A ?next= value still wins — that is how a protected
// page sends you back to where you were — and it is still validated against a
// plain page name, so it cannot be used to leave the site.
const DEFAULT_AFTER_LOGIN = 'dashboard.html';
const nextUrl = /^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(requestedNext)
  ? requestedNext
  : DEFAULT_AFTER_LOGIN;

const tabs = {
  login: { tab: document.getElementById('tab-login'), form: document.getElementById('form-login') },
  register: { tab: document.getElementById('tab-register'), form: document.getElementById('form-register') }
};

function selectTab(name) {
  Object.entries(tabs).forEach(([key, node]) => {
    const active = key === name;
    node.tab.setAttribute('aria-selected', String(active));
    node.form.dataset.active = String(active);
  });
}

tabs.login.tab.addEventListener('click', () => selectTab('login'));
tabs.register.tab.addEventListener('click', () => selectTab('register'));

// Open straight onto the register form with ?mode=register
if (params.get('mode') === 'register') selectTab('register');

/* ---------------- allowed email domain ---------------- */

// Filled from GET /api/auth/config so the browser and the server can never
// disagree about which domain is accepted. The default matches the backend.
let authConfig = {
  allowedEmailDomains: ['scds.saiuniversity.edu.in', 'sas.saiuniversity.edu.in', 'sol.saiuniversity.edu.in', 'sahs.saiuniversity.edu.in'],
  allowedEmailDomain: 'scds.saiuniversity.edu.in',
  // The faculty parent domain is part of the server's rule, so it belongs in the
  // fallback too: if /api/auth/config is briefly unavailable, a faculty member
  // must still be able to submit the form. This does not widen what the server
  // accepts — it mirrors it, and the server still rejects anything else.
  facultyDomains: ['saiuniversity.edu.in'],
  emailVerification: false
};

(async () => {
  try {
    authConfig = { ...authConfig, ...(await api('/auth/config')) };
  } catch {
    /* fall back to the built-in default; the server still enforces its own rule */
  }
  // The server also accepts the faculty parent domain, so validation uses both
  // lists. The hint shows the student schools; faculty are told separately.
  const studentDomains = authConfig.allowedEmailDomains || [authConfig.allowedEmailDomain];
  const facultyDomains = authConfig.facultyDomains || [];
  const domains = [...studentDomains, ...facultyDomains];
  document.querySelectorAll('[data-allowed-domain]').forEach((node) => {
    node.textContent = domains.map((d) => `@${d}`).join(', ');
  });
})();

/** Every domain the server accepts: the student schools and the faculty parent. */
function acceptedDomains() {
  const student = authConfig.allowedEmailDomains || [authConfig.allowedEmailDomain];
  const faculty = authConfig.facultyDomains || [];
  return [...student, ...faculty].filter(Boolean).map((d) => String(d).toLowerCase());
}

/** Same rule as the server: the domain must match exactly. */
function isAllowedEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return false;
  // Mirrors the server (isUniversityEmail): the parent domain and any
  // subdomain of it. An exact-match list rejected valid school addresses.
  const domain = value.slice(at + 1);
  return acceptedDomains().some((d) => domain === d || domain.endsWith('.' + d));
}

function showError(id, message) {
  const box = document.getElementById(id);
  box.textContent = message || '';
  box.dataset.show = message ? 'true' : 'false';
}

function finish(token, user) {
  Auth.save(token, user);
  window.location.href = nextUrl;
}

/* ---------------- show / hide password ---------------- */

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.classList.toggle('is-revealed', show);
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

/* ---------------- password strength ---------------- */

/**
 * A rough, explainable strength score: length first, then variety.
 * 0 = too short, 1 = weak, 2 = fair, 3 = good, 4 = strong.
 */
function scorePassword(value) {
  if (!value) return { score: 0, label: 'Use at least 8 characters' };
  if (value.length < 8) return { score: 0, label: 'Too short — at least 8 characters' };

  let score = 1;
  if (value.length >= 10) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  const capped = Math.min(score, 4);
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score: capped, label: labels[capped] };
}

const strengthBox = document.getElementById('password-strength');
const strengthLabel = document.getElementById('password-strength-label');
const registerPassword = document.getElementById('register-password');

registerPassword.addEventListener('input', () => {
  const { score, label } = scorePassword(registerPassword.value);
  strengthBox.dataset.strength = String(score);
  strengthLabel.textContent = label;
});

/* ---------------- resend the verification email ---------------- */

const resendBtn = document.getElementById('resend-verification');
if (resendBtn) {
  resendBtn.addEventListener('click', async () => {
    // Use the tab the user is actually on, so a leftover value from the other
    // form cannot win over the address they just typed.
    const onRegister = document.getElementById('tab-register')?.getAttribute('aria-selected') === 'true';
    const slot = onRegister ? 'register-error' : 'login-error';
    const email = ((onRegister
      ? document.getElementById('register-email')
      : document.getElementById('login-email'))?.value || '').trim();

    if (!email) {
      showError(slot, 'Enter your university email address first.');
      return;
    }
    resendBtn.disabled = true;
    const original = resendBtn.textContent;
    resendBtn.textContent = 'Sending…';
    try {
      const result = await api('/auth/resend-verification', { method: 'POST', body: { email } });
      showNotice(result.message || 'If that address needs verifying, a new link is on its way.');
    } catch (err) {
      showError(slot, err.message);
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = original;
    }
  });
}

/* ---------------- email verification link ---------------- */

const verifyToken = params.get('verify');
if (verifyToken) {
  const notice = document.getElementById('auth-notice');
  (async () => {
    try {
      const result = await api('/auth/verify-email', { method: 'POST', body: { token: verifyToken } });
      notice.textContent = result.message || 'Email verified. You can log in now.';
      notice.dataset.show = 'true';
    } catch (err) {
      notice.className = 'form-error';
      notice.textContent = err.message;
      notice.dataset.show = 'true';
    }
  })();
}

/** A neutral, non-alarming message: the action succeeded. */
function showNotice(text) {
  const notice = document.getElementById('auth-notice');
  if (!notice) return;
  notice.className = 'form-success';
  notice.textContent = text;
  notice.dataset.show = 'true';
}

/** Reveal the resend link once a verification email has been asked for. */
function showResend() {
    // The control is always available now: a returning applicant whose email
    // never arrived must be able to ask for another without registering again.
    // Kept as a named hook so existing call sites still read clearly.
    var wrap = document.getElementById('resend-wrap');
    if (wrap) wrap.hidden = false;
  }

initTheme();

/* ---------------- login ---------------- */

document.getElementById('form-login').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('login-error', '');

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showError('login-error', 'Enter your email and password.');

  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.textContent = 'Logging in…';

  try {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    // Registration no longer returns a session: the account must be verified
    // first. Guarding here means a missing token can never be written to
    // localStorage as the string "undefined".
    if (!data.token || !data.user) {
      showError('login-error', data.message
        || 'Sign-in did not complete. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Log in';
      return;
    }

    finish(data.token, data.user);
  } catch (err) {
    // A returning user whose verification email was lost had no way back in.
    if (/verify your email/i.test(String(err.message || ''))) showResend();
    showError('login-error', err.message);
    btn.disabled = false;
    btn.textContent = 'Log in';
  }
});

/* ---------------- registration ---------------- */

document.getElementById('form-register').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('register-error', '');

  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = registerPassword.value;
  const confirm = document.getElementById('register-confirm').value;

  if (!name) return showError('register-error', 'Please enter your name.');
  if (!email) return showError('register-error', 'Please enter your email.');
  if (!isAllowedEmail(email)) {
    return showError('register-error',
      `Registration is limited to Sai University addresses: ${acceptedDomains().map((d) => `@${d}`).join(', ')}.`);
  }
  if (password.length < 8) return showError('register-error', 'Password must be at least 8 characters.');
  if (password !== confirm) return showError('register-error', 'The two passwords do not match.');

  const btn = document.getElementById('register-submit');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const data = await api('/auth/register', { method: 'POST', body: { name, email, password } });

    // A faculty application is not a session: say so, leave the form usable.
    // Written to the neutral notice, not the red error slot — the account was
    // created successfully, and a red box at that moment reads as failure.
    if (data.pendingApproval) {
      showNotice(data.message
        || 'Your faculty application is waiting for administrator approval.');
      showResend();
      btn.disabled = false;
      btn.textContent = 'Create account';
      return;
    }

    if (data.verificationRequired) {
      showNotice(data.message
        || 'Account created. Check your university email for the verification link before signing in.');
      showResend();
      btn.disabled = false;
      btn.textContent = 'Create account';
      return;
    }

    finish(data.token, data.user);
  } catch (err) {
    // Never swallowed: the API's safe message is shown as-is.
    showError('register-error', err.message || 'Registration failed. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});
