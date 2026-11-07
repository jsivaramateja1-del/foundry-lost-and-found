/**
 * Sends the verification email.
 *
 * nodemailer is only required when email verification is switched on, so a
 * deployment that does not use it does not need SMTP settings at all.
 * If verification is enabled but SMTP is not configured, server.js refuses to
 * start — this project must never pretend an email was sent.
 */
/**
 * Build a transport from the environment. nodemailer is required lazily so a
 * deployment that never sends mail does not need the dependency loaded.
 * Resend works through these same SMTP settings: host smtp.resend.com,
 * user "resend", password = the Resend API key.
 */
const buildTransport = () => {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP is not configured, so no email can be sent.');
  }
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  });
};

/**
 * Where the user-facing links point. The frontend and the API may be deployed
 * on different hosts, so FRONTEND_URL wins when it is set.
 */
const frontendBase = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');

const sendVerificationEmail = async (to, token) => {
  const transport = buildTransport();
  const base = frontendBase();
  const link = `${base}/auth.html?verify=${encodeURIComponent(token)}`;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Confirm your Foundry account',
    text: [
      'Welcome to Foundry, the Sai University campus lost and found portal.',
      '',
      'Confirm your address by opening this link:',
      link,
      '',
      'The link expires in 24 hours. If you did not create this account, ignore this email.'
    ].join('\n')
  });
};

/**
 * The reset email. The token is never logged and never returned by the API;
 * it exists only in this message.
 */
const sendPasswordResetEmail = async (to, token) => {
  const transport = buildTransport();
  const link = `${frontendBase()}/reset-password.html#token=${encodeURIComponent(token)}`;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Reset your Foundry password',
    text: [
      'Somebody asked to reset the password for this Foundry account.',
      '',
      'Choose a new password here:',
      link,
      '',
      'The link works once and expires in 15 minutes.',
      'If this was not you, ignore this email — your password has not changed.',
      '',
      'If you can no longer reach this mailbox, contact the Foundry administrator',
      'or university IT. There is no other way to recover the account.'
    ].join('\n')
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
