/**
 * WhatsApp Cloud API client — unit tests.
 *
 * No network: global.fetch is replaced with a stub, so every assertion here is
 * about what this module sends and how it handles a reply, not about Meta.
 * Nothing in this file proves a real message arrives; only a live token can.
 */

const assert = require('node:assert');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS ', name);
    pass += 1;
  } catch (err) {
    console.log('  FAIL ', name, '::', err.message);
    fail += 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log('  PASS ', name);
    pass += 1;
  } catch (err) {
    console.log('  FAIL ', name, '::', err.message);
    fail += 1;
  }
}

function clearEnv() {
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID;
  delete process.env.WHATSAPP_GROUP_ID;
  delete process.env.WHATSAPP_TEMPLATE;
  delete process.env.WHATSAPP_API_VERSION;
}

function load() {
  delete require.cache[require.resolve('../src/lib/whatsapp')];
  return require('../src/lib/whatsapp');
}

/** Replace fetch and record what was sent. */
function stubFetch(reply) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (reply && reply.throw) throw new Error(reply.throw);
    return {
      ok: reply ? reply.ok !== false : true,
      status: reply && reply.status ? reply.status : 200,
      json: async () => (reply && reply.body !== undefined ? reply.body : { messages: [{ id: 'wamid.TEST' }] })
    };
  };
  return calls;
}

async function main() {
  console.log('\nWhatsApp client');

  // ---- configuration gating ------------------------------------------------
  clearEnv();
  let wa = load();

  test('unconfigured: isConfigured() is false', () => {
    assert.strictEqual(wa.isConfigured(), false);
  });

  testAsync('unconfigured: sendTemplate skips instead of throwing', async () => {
    const r = await wa.sendTemplate('919876543210', ['x']);
    assert.strictEqual(r.skipped, true);
  });

  testAsync('unconfigured: sendToGroup skips', async () => {
    const r = await wa.sendToGroup('hello');
    assert.strictEqual(r.skipped, true);
  });

  // ---- phone normalisation -------------------------------------------------
  test('normalizePhone strips punctuation', () => {
    assert.strictEqual(wa.normalizePhone('+91 98765 43210'), '919876543210');
    assert.strictEqual(wa.normalizePhone('(91) 98765-43210'), '919876543210');
  });

  test('normalizePhone rejects too short and too long', () => {
    assert.strictEqual(wa.normalizePhone('12345'), null);
    assert.strictEqual(wa.normalizePhone('1234567890123456789'), null);
    assert.strictEqual(wa.normalizePhone(null), null);
    assert.strictEqual(wa.normalizePhone(''), null);
  });

  // ---- configured behaviour ------------------------------------------------
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_ID = '1234567890';
  wa = load();

  test('configured: isConfigured() is true', () => {
    assert.strictEqual(wa.isConfigured(), true);
  });

  await testAsync('sendTemplate posts a template payload to the right endpoint', async () => {
    const calls = stubFetch();
    const r = await wa.sendTemplate('+91 98765 43210', ['Bottle', 'lost', 'AB1']);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.id, 'wamid.TEST');
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /graph\.facebook\.com\/v21\.0\/1234567890\/messages$/);

    const b = calls[0].body;
    assert.strictEqual(b.messaging_product, 'whatsapp');
    assert.strictEqual(b.recipient_type, 'individual');
    assert.strictEqual(b.to, '919876543210');
    assert.strictEqual(b.type, 'template');
    assert.strictEqual(b.template.name, 'foundry_new_listing');
    assert.strictEqual(b.template.language.code, 'en');
    assert.deepStrictEqual(
      b.template.components[0].parameters.map((p) => p.text),
      ['Bottle', 'lost', 'AB1']
    );
  });

  await testAsync('sendTemplate sends the bearer token', async () => {
    const calls = stubFetch();
    await wa.sendTemplate('919876543210', ['x']);
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer test-token');
    assert.strictEqual(calls[0].init.headers['Content-Type'], 'application/json');
  });

  await testAsync('sendTemplate honours a custom template name and language', async () => {
    const calls = stubFetch();
    await wa.sendTemplate('919876543210', ['x'], { template: 'other_tpl', language: 'hi' });
    assert.strictEqual(calls[0].body.template.name, 'other_tpl');
    assert.strictEqual(calls[0].body.template.language.code, 'hi');
  });

  await testAsync('sendTemplate refuses an invalid number without calling the API', async () => {
    const calls = stubFetch();
    const r = await wa.sendTemplate('123', ['x']);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls.length, 0);
  });

  await testAsync('sendText posts a text payload', async () => {
    const calls = stubFetch();
    const r = await wa.sendText('919876543210', 'Your item was found');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls[0].body.type, 'text');
    assert.strictEqual(calls[0].body.text.body, 'Your item was found');
    assert.strictEqual(calls[0].body.text.preview_url, true);
  });

  await testAsync('sendText rejects an empty body', async () => {
    const calls = stubFetch();
    const r = await wa.sendText('919876543210', '   ');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls.length, 0);
  });

  // ---- failure handling ----------------------------------------------------
  await testAsync('a rejected send returns ok:false with the API message', async () => {
    stubFetch({ ok: false, status: 400, body: { error: { message: 'Template not found', type: 'OAuthException' } } });
    const r = await wa.sendTemplate('919876543210', ['x']);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.error, 'Template not found');
  });

  await testAsync('a network error is caught, never thrown', async () => {
    stubFetch({ throw: 'ECONNRESET' });
    const r = await wa.sendTemplate('919876543210', ['x']);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /ECONNRESET/);
  });

  await testAsync('a non-JSON error body still yields a usable error', async () => {
    global.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    const r = await wa.sendTemplate('919876543210', ['x']);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /502/);
  });

  // ---- group send ----------------------------------------------------------
  await testAsync('sendToGroup skips when no group id is configured', async () => {
    const calls = stubFetch();
    const r = await wa.sendToGroup('hello');
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(calls.length, 0);
  });

  await testAsync('sendToGroup uses recipient_type group when configured', async () => {
    process.env.WHATSAPP_GROUP_ID = 'GROUP123';
    const calls = stubFetch();
    const r = await wa.sendToGroup('hello group');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls[0].body.recipient_type, 'group');
    assert.strictEqual(calls[0].body.to, 'GROUP123');
    delete process.env.WHATSAPP_GROUP_ID;
  });

  // ---- fanout --------------------------------------------------------------
  await testAsync('notifyNewListing sends once per recipient', async () => {
    const calls = stubFetch();
    const r = await wa.notifyNewListing(
      [{ phone: '919876543210' }, { phone: '919876543211' }],
      { title: 'Bottle', type: 'lost', location: 'AB1' }
    );
    assert.strictEqual(r.sent, 2);
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(calls.length, 2);
  });

  await testAsync('notifyNewListing counts failures and keeps going', async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) };
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'ok' }] }) };
    };
    const r = await wa.notifyNewListing(
      [{ phone: '919876543210' }, { phone: '919876543211' }],
      { title: 'Bottle', type: 'found', location: 'AB2' }
    );
    assert.strictEqual(r.sent, 1);
    assert.strictEqual(r.failed, 1);
  });

  await testAsync('notifyNewListing skips invalid numbers without a request', async () => {
    const calls = stubFetch();
    const r = await wa.notifyNewListing([{ phone: '123' }], { title: 'x', type: 'lost', location: 'AB1' });
    assert.strictEqual(r.failed, 1);
    assert.strictEqual(calls.length, 0);
  });

  await testAsync('notifyNewListing with no recipients does nothing', async () => {
    const calls = stubFetch();
    const r = await wa.notifyNewListing([], { title: 'x' });
    assert.strictEqual(r.sent, 0);
    assert.strictEqual(calls.length, 0);
  });

  clearEnv();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
