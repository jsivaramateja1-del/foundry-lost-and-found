/**
 * WhatsApp Cloud API notifications.
 *
 * Uses Meta's Graph API over plain fetch — no SDK, no extra dependency.
 *
 * Configuration (names only — values live in the environment):
 *   WHATSAPP_TOKEN         permanent System User access token
 *   WHATSAPP_PHONE_ID      the business phone number ID (not the number itself)
 *   WHATSAPP_API_VERSION   defaults to v21.0
 *   WHATSAPP_TEMPLATE      approved template name, defaults to foundry_new_listing
 *   WHATSAPP_TEMPLATE_LANG defaults to en
 *
 * If WHATSAPP_TOKEN or WHATSAPP_PHONE_ID is unset the module logs once and
 * returns { skipped: true } rather than throwing: a missing WhatsApp key must
 * never break listing creation, exactly as a missing mail key must not break
 * registration.
 *
 * ---------------------------------------------------------------------------
 * Two rules from Meta shape this module, and neither can be worked around:
 *
 * 1. A business cannot start a conversation with free text. Outside a 24-hour
 *    customer-service window the first message must be an APPROVED TEMPLATE.
 *    So the default path here is a template, and sendText() is offered only for
 *    replies inside a window the caller already knows is open.
 *
 * 2. Posting into an existing class WhatsApp group is not possible. The Groups
 *    API creates groups the business owns, is capped at 8 participants, and
 *    requires an Official Business Account. It cannot write into the group a
 *    student already uses. sendToGroup() is therefore gated behind an explicit
 *    WHATSAPP_GROUP_ID and documented as the limited thing it is.
 * ---------------------------------------------------------------------------
 */

const log = (...args) => console.log('[whatsapp]', ...args);

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const phoneId = () => process.env.WHATSAPP_PHONE_ID || '';
const token = () => process.env.WHATSAPP_TOKEN || '';

/** True when both pieces of configuration the API needs are present. */
function isConfigured() {
  return Boolean(token() && phoneId());
}

/**
 * Meta wants E.164 digits with no punctuation: 919876543210, not +91 98765 43210.
 * Returns null for anything that cannot be a phone number, so the caller can
 * skip that recipient instead of sending a request that is certain to fail.
 */
function normalizePhone(value) {
  if (value == null) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Mask a number for logs: keep the country code and last two digits. */
function mask(phone) {
  const p = String(phone || '');
  if (p.length < 5) return '***';
  return p.slice(0, 2) + '*'.repeat(Math.max(0, p.length - 4)) + p.slice(-2);
}

const endpoint = () => `https://graph.facebook.com/${apiVersion()}/${phoneId()}/messages`;

/**
 * One POST to the messages endpoint.
 *
 * Returns { skipped } when unconfigured, { ok, id } on acceptance, or
 * { ok: false, error } on rejection. It never throws: a notification failing
 * must not roll back the database work that triggered it.
 */
async function post(payload) {
  if (!isConfigured()) return { skipped: true };

  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }

    if (!res.ok) {
      const detail = (body && body.error && (body.error.message || body.error.type))
        || `HTTP ${res.status}`;
      log('send rejected:', res.status, detail);
      return { ok: false, status: res.status, error: detail };
    }

    const id = body && body.messages && body.messages[0] && body.messages[0].id;
    return { ok: true, id: id || null };
  } catch (err) {
    log('send failed:', err && err.message);
    return { ok: false, error: (err && err.message) || 'network error' };
  }
}

/**
 * Business-initiated message. This is the default path, because a new listing
 * notification is almost always the start of a conversation and therefore must
 * use a template Meta has already approved.
 *
 * `bodyParams` fills the template's {{1}}, {{2}} ... placeholders in order.
 */
async function sendTemplate(to, bodyParams, options) {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: 'invalid phone number' };

  const opts = options || {};
  const name = opts.template || process.env.WHATSAPP_TEMPLATE || 'foundry_new_listing';
  const lang = opts.language || process.env.WHATSAPP_TEMPLATE_LANG || 'en';

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name,
      language: { code: lang },
      components: [
        {
          type: 'body',
          parameters: (bodyParams || []).map((text) => ({ type: 'text', text: String(text) }))
        }
      ]
    }
  };

  log('template send to', mask(phone), 'template', name);
  return post(payload);
}

/**
 * Free-text reply. Only valid inside an open 24-hour customer-service window;
 * outside it Meta rejects the request and sendTemplate() is the correct call.
 */
async function sendText(to, body) {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: 'invalid phone number' };
  if (!body || !String(body).trim()) return { ok: false, error: 'empty body' };

  return post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: { preview_url: true, body: String(body) }
  });
}

/**
 * Group send. Present for completeness, not as the default: it needs a group
 * created through the Groups API, an Official Business Account, and it can
 * never target a group the students already belong to.
 */
async function sendToGroup(text) {
  const groupId = process.env.WHATSAPP_GROUP_ID || '';
  if (!groupId) return { skipped: true, reason: 'WHATSAPP_GROUP_ID is unset' };
  if (!isConfigured()) return { skipped: true };

  return post({
    messaging_product: 'whatsapp',
    recipient_type: 'group',
    to: groupId,
    type: 'text',
    text: { preview_url: true, body: String(text) }
  });
}

/**
 * Fan a new listing out to a set of opted-in numbers.
 *
 * Sequential rather than parallel on purpose: Meta rate-limits per phone number
 * and a burst of parallel requests is the fastest way to be throttled. Failures
 * are counted and returned, never thrown.
 */
async function notifyNewListing(recipients, item) {
  if (!isConfigured()) return { skipped: true, sent: 0, failed: 0 };
  if (!Array.isArray(recipients) || !recipients.length) return { sent: 0, failed: 0 };

  const place = item.location === 'Other' && item.customLocation
    ? item.customLocation
    : item.location;
  const params = [
    item.title || 'An item',
    item.type === 'lost' ? 'lost' : 'found',
    place || 'campus'
  ];

  let sent = 0;
  let failed = 0;

  for (const person of recipients) {
    const result = await sendTemplate(person.phone, params);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  log('new listing fanout:', sent, 'sent,', failed, 'failed');
  return { sent, failed };
}

module.exports = {
  isConfigured,
  normalizePhone,
  sendTemplate,
  sendText,
  sendToGroup,
  notifyNewListing
};
