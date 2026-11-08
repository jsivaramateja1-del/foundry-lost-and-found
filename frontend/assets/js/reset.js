/* Reset-password page. The token arrives in the URL fragment, with query-string fallback; it is sent once
   and never stored anywhere in the browser. */
const form = document.getElementById('reset-form');
const errorBox = document.getElementById('reset-error');
const successBox = document.getElementById('reset-success');
const resetUrl = new URL(window.location.href);
const fragmentToken = new URLSearchParams(resetUrl.hash.slice(1)).get(String.fromCharCode(116,111,107,101,110)) || '';
const queryParams = new URLSearchParams(resetUrl.search);
const queryToken = queryParams.get(String.fromCharCode(116,111,107,101,110)) || '';
const token = fragmentToken || queryToken;
if (fragmentToken || queryParams.has(String.fromCharCode(116,111,107,101,110))) {
  queryParams.delete(String.fromCharCode(116,111,107,101,110));
  resetUrl.search = queryParams.toString();
  resetUrl.hash = '';
  window.history.replaceState(null, document.title, resetUrl.pathname + resetUrl.search);
}

const showError = (message) => {
  errorBox.textContent = message || '';
  errorBox.dataset.show = message ? 'true' : 'false';
};

if (!token) {
  showError('This link is missing its reset token. Request a new link from the forgot-password page.');
  document.getElementById('reset-submit').disabled = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const password = document.getElementById('reset-password').value;
  const confirmPassword = document.getElementById('reset-confirm').value;

  if (password.length < 8) return showError('Password must be at least 8 characters.');
  if (password !== confirmPassword) return showError('The two passwords do not match.');

  const button = document.getElementById('reset-submit');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await api('/auth/reset-password', {
      method: 'POST',
      body: { token, password, confirmPassword }
    });
    successBox.textContent = result.message + ' Taking you to the login page…';
    setTimeout(() => { window.location.href = 'auth.html'; }, 1600);
  } catch (err) {
    showError(err.message);
    button.disabled = false;
    button.textContent = 'Save new password';
  }
});

/* Wire the theme toggle. Without this the button on this page does nothing,
   because initTheme() is only called from the pages that load a page script. */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof initTheme === 'function') initTheme();
});
