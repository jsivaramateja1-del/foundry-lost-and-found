/* auth.js — login and registration */

const params = new URLSearchParams(window.location.search);
const nextUrl = params.get('next') || 'index.html';

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

document.getElementById('form-register').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('register-error', '');

  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;

  if (!name) return showError('register-error', 'Please enter your name.');
  if (!email) return showError('register-error', 'Please enter your email.');
  if (password.length < 6) return showError('register-error', 'Password must be at least 6 characters.');

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
