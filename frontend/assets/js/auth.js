const params = new URLSearchParams(window.location.search);

const requestedNext = params.get('next') || '';

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

if (params.get('mode') === 'register') selectTab('register');

let authConfig = {
  allowedEmailDomains: ['scds.saiuniversity.edu.in', 'sas.saiuniversity.edu.in', 'sol.saiuniversity.edu.in', 'sahs.saiuniversity.edu.in'],
  allowedEmailDomain: 'scds.saiuniversity.edu.in',

  facultyDomains: ['saiuniversity.edu.in'],
  emailVerification: false
};

(async () => {
  try {
    authConfig = { ...authConfig, ...(await api('/auth/config')) };
  } catch {

  }

  const studentDomains = authConfig.allowedEmailDomains || [authConfig.allowedEmailDomain];
  const facultyDomains = authConfig.facultyDomains || [];
  const domains = [...studentDomains, ...facultyDomains];
  document.querySelectorAll('[data-allowed-domain]').forEach((node) => {
    node.textContent = domains.map((d) => `@${d}`).join(', ');
  });
})();

function acceptedDomains() {
  const student = authConfig.allowedEmailDomains || [authConfig.allowedEmailDomain];
  const faculty = authConfig.facultyDomains || [];
  return [...student, ...faculty].filter(Boolean).map((d) => String(d).toLowerCase());
}

function isAllowedEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return false;

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

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.classList.toggle('is-revealed', show);
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

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

const resendBtn = document.getElementById('resend-verification');
if (resendBtn) {
  resendBtn.addEventListener('click', async () => {

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

function showNotice(text) {
  const notice = document.getElementById('auth-notice');
  if (!notice) return;
  notice.className = 'form-success';
  notice.textContent = text;
  notice.dataset.show = 'true';
}

function showResend() {

    var wrap = document.getElementById('resend-wrap');
    if (wrap) wrap.hidden = false;
  }

initTheme();

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

    if (!data.token || !data.user) {
      showError('login-error', data.message
        || 'Sign-in did not complete. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Log in';
      return;
    }

    finish(data.token, data.user);
  } catch (err) {

    if (/verify your email/i.test(String(err.message || ''))) showResend();
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

    showError('register-error', err.message || 'Registration failed. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});
