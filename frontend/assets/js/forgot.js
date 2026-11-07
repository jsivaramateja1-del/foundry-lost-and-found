/* Forgot-password page. The API deliberately answers the same way whether or
   not the address exists, so this page must not imply that it checked. */
const form = document.getElementById('forgot-form');
const errorBox = document.getElementById('forgot-error');
const successBox = document.getElementById('forgot-success');

const showError = (message) => {
  errorBox.textContent = message || '';
  errorBox.dataset.show = message ? 'true' : 'false';
  if (message) successBox.textContent = '';
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const emailInput = document.getElementById('forgot-email');
  const email = emailInput.value.trim();
  if (!email) return showError('Enter the email address you registered with.');
  if (!emailInput.checkValidity()) return showError('Enter a valid email address.');

  const button = document.getElementById('forgot-submit');
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const result = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    successBox.textContent = result.message;
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Send reset link';
  }
});
