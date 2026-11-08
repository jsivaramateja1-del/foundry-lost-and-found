/**
 * Brevo transactional email.
 *
 * Uses Brevo's HTTP API (v3) rather than SMTP: one fetch, no extra dependency,
 * and the response tells us immediately whether the send was accepted.
 *
 * Configuration (names only — values live in the environment):
 *   BREVO_API_KEY   required to send
 *   BREVO_SENDER    the verified sender address, e.g. someone@example.com
 *   BREVO_SENDER_NAME  display name, defaults to "Foundry"
 *   APP_URL         used to build every link in these emails
 *
 * If BREVO_API_KEY is unset the module logs and returns { skipped: true }
 * instead of throwing: a missing mail key must not break registration.
 */

const API_URL = 'https://api.brevo.com/v3/smtp/email';

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const appUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/+$/, '');

/**
 * Shared shell. Inline styles only: email clients strip <style> blocks often
 * enough that a stylesheet-based design breaks in Outlook and Gmail apps.
 */
const shell = (heading, bodyHtml, footer) => `
<div style="margin:0;padding:32px 16px;background:#0a0a0b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#121214;border:1px solid rgba(242,240,234,.12);border-radius:16px;overflow:hidden;">
    <div style="padding:28px 32px 8px;">
      <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#8f8d86;">Foundry · Sai University</div>
      <h1 style="margin:12px 0 0;font-size:26px;line-height:1.25;color:#f2f0ea;font-weight:600;">${heading}</h1>
    </div>
    <div style="padding:8px 32px 28px;color:#d9d6cd;font-size:15px;line-height:1.65;">
      ${bodyHtml}
    </div>
    <div style="padding:18px 32px;border-top:1px solid rgba(242,240,234,.12);color:#8f8d86;font-size:12px;line-height:1.6;">
      ${footer}
    </div>
  </div>
  <div style="max-width:560px;margin:16px auto 0;color:#6f6d67;font-size:11px;text-align:center;">
    Foundry — Campus Lost &amp; Found, Sai University
  </div>
</div>`;

const button = (href, label) => `
<a href="${escapeHtml(href)}" style="display:inline-block;margin:18px 0 8px;padding:13px 26px;background:#d8ff5f;color:#0a0a0b;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>`;

const templates = {
  verification: ({ name, link }) => ({
    subject: 'Verify your Foundry account',
    html: shell(
      `Welcome, ${escapeHtml(name)}`,
      `<p style="margin:0 0 6px;">Confirm this address to finish setting up your Foundry account — the campus lost &amp; found board.</p>
       ${button(link, 'Verify my email')}
       <p style="margin:16px 0 0;color:#8f8d86;font-size:13px;">This link expires in 24 hours. If you did not sign up, ignore this email and no account will be activated.</p>
       <p style="margin:14px 0 0;color:#8f8d86;font-size:12px;word-break:break-all;">${escapeHtml(link)}</p>`,
      'You received this because someone registered with this address.'
    )
  }),

  welcome: ({ name }) => ({
    subject: 'Your Foundry account is ready',
    html: shell(
      `You're all set, ${escapeHtml(name)}`,
      `<p style="margin:0 0 6px;">Your email is verified and your account is active.</p>
       <p style="margin:0 0 6px;">Report something you lost, post something you found, and search the board before you buy a replacement.</p>
       ${button(`${appUrl()}/index.html`, 'Open the board')}`,
      'You received this because you created a Foundry account.'
    )
  }),

  signin: ({ name, time, device }) => ({
    subject: 'New sign-in to your Foundry account',
    html: shell(
      'New sign-in',
      `<p style="margin:0 0 6px;">Hello ${escapeHtml(name)}, your account was just signed in to.</p>
       <table style="margin:14px 0;border-collapse:collapse;font-size:14px;color:#d9d6cd;">
         <tr><td style="padding:4px 16px 4px 0;color:#8f8d86;">When</td><td>${escapeHtml(time)}</td></tr>
         <tr><td style="padding:4px 16px 4px 0;color:#8f8d86;">Device</td><td>${escapeHtml(device || 'Unknown')}</td></tr>
       </table>
       <p style="margin:0;">If this was you, nothing to do. If it was not, reset your password immediately.</p>
       ${button(`${appUrl()}/forgot-password.html`, 'Reset my password')}`,
      'You received this because someone signed in to your account.'
    )
  }),

  passwordReset: ({ name, link }) => ({
    subject: 'Reset your Foundry password',
    html: shell(
      'Reset your password',
      `<p style="margin:0 0 6px;">Hello ${escapeHtml(name)}, we received a request to reset your password.</p>
       ${button(link, 'Choose a new password')}
       <p style="margin:16px 0 0;color:#8f8d86;font-size:13px;">This link expires in 1 hour. If you did not ask for it, you can ignore this email — your password will not change.</p>`,
      'You received this because a password reset was requested for your account.'
    )
  }),

  // The three found-item notifications agreed with the project owner.
  itemVerified: ({ name, title, link }) => ({
    subject: `Your found listing was verified: ${title}`,
    html: shell(
      'Your listing was verified',
      `<p style="margin:0 0 6px;">Hello ${escapeHtml(name)}, a moderator verified your found listing <strong>${escapeHtml(title)}</strong>.</p>
       <p style="margin:0 0 6px;">Verified found items earn points and appear with a verified marker on the board.</p>
       ${button(link, 'View the listing')}`,
      'You received this because you posted a found item on Foundry.'
    )
  }),

  itemClaimed: ({ name, title, link }) => ({
    subject: `Someone claimed your found item: ${title}`,
    html: shell(
      'Someone claimed your item',
      `<p style="margin:0 0 6px;">Hello ${escapeHtml(name)}, a student has submitted a claim on <strong>${escapeHtml(title)}</strong>.</p>
       <p style="margin:0 0 6px;">Review the claim in your dashboard. If you approve it, you will get a six-digit handover code to give the claimant in person.</p>
       ${button(link, 'Review the claim')}`,
      'You received this because you posted a found item on Foundry.'
    )
  }),

  claimApproved: ({ name, title, link }) => ({
    subject: `Your claim was approved: ${title}`,
    html: shell(
      'Your claim was approved',
      `<p style="margin:0 0 6px;">Hello ${escapeHtml(name)}, your claim on <strong>${escapeHtml(title)}</strong> was approved.</p>
       <p style="margin:0 0 6px;">Your six-digit handover code is in your dashboard. Give it to the person holding the item when you meet — they enter it to confirm the return.</p>
       ${button(link, 'Open my dashboard')}`,
      'You received this because you submitted a claim on Foundry.'
    )
  })
};

/** Sends one templated email. Never throws; returns a result object. */
const send = async (type, to, data) => {
  const build = templates[type];
  if (!build) throw new Error(`Unknown email template: ${type}`);

  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER;
  if (!apiKey || !sender) {
    console.warn(`[email] ${type} not sent: BREVO_API_KEY or BREVO_SENDER is unset`);
    return { skipped: true, reason: 'not configured' };
  }

  const { subject, html } = build(data);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { email: sender, name: process.env.BREVO_SENDER_NAME || 'Foundry' },
        to: [{ email: to }],
        subject,
        htmlContent: html
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] ${type} failed: ${res.status} ${body.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    // A mail failure must never take down a request that already succeeded.
    console.error(`[email] ${type} threw: ${err.message}`);
    return { ok: false, error: err.message };
  }
};

module.exports = { send, templates, escapeHtml };
