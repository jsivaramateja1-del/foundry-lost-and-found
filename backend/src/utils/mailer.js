/**
 * Sends the verification email.
 *
 * nodemailer is only required when email verification is switched on, so a
 * deployment that does not use it does not need SMTP settings at all.
 * If verification is enabled but SMTP is not configured, server.js refuses to
 * start — this project must never pretend an email was sent.
 */
const sendVerificationEmail = async (to, token) => {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP is not configured, so a verification email cannot be sent.');
  }

  // Required lazily so the dependency is only needed when the feature is used
  const nodemailer = require('nodemailer');

  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  });

  const base = (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');
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

module.exports = { sendVerificationEmail };
