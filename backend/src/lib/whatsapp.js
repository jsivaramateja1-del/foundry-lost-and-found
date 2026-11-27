const log = (...args) => console.log('[whatsapp]', ...args);

const apiVersion = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const phoneId = () => process.env.WHATSAPP_PHONE_ID || '';
const token = () => process.env.WHATSAPP_TOKEN || '';

function isConfigured() {
  return Boolean(token() && phoneId());
}

function normalizePhone(value) {
  if (value == null) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function mask(phone) {
  const p = String(phone || '');
  if (p.length < 5) return '***';
  return p.slice(0, 2) + '*'.repeat(Math.max(0, p.length - 4)) + p.slice(-2);
}

const endpoint = () => `https://graph.facebook.com/${apiVersion()}/${phoneId()}/messages`;

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
    try { body = await res.json(); } catch (e) {  }

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
