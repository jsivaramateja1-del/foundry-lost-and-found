/* auth.js — login and registration */

const params = new URLSearchParams(window.location.search);

// Where to send the student after a successful login.
// Only accept a plain page on this site: a ?next= value such as
// "//evil.example/login" would otherwise redirect them off-site.
const requestedNext = params.get('next') || '';
const nextUrl = /^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(requestedNext) ? requestedNext : 'index.html';

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
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

/* ---------------- password strength ---------------- */

/**
 * A rough, explainable strength score: length first, then variety.
 * 0 = too short, 1 = weak, 2 = fair, 3 = good, 4 = strong.
 */
function scorePassword(value) {
  if (!value) return { score: 0, label: 'Use at least 6 characters' };
  if (value.length < 6) return { score: 0, label: 'Too short — at least 6 characters' };

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
    finish(data.token, data.user);
  } catch (err) {
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
  if (password.length < 6) return showError('register-error', 'Password must be at least 6 characters.');
  if (password !== confirm) return showError('register-error', 'The two passwords do not match.');

  const btn = document.getElementById('register-submit');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const data = await api('/auth/register', { method: 'POST', body: { name, email, password } });
    finish(data.token, data.user);
  } catch (err) {
    showError('register-error', err.message);
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});
