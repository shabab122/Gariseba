'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateRequest, normalizePhone, normalizeEmail } = require('../src/lib/validate');
const { createAnalyzer, fallbackAnalyze, validateOutput, testOpenAIConnection } = require('../src/lib/ai');
const { matchArea, estimateFor } = require('../src/lib/business');
const { sniff } = require('../src/lib/images');
const { buildMessage } = require('../src/lib/whatsapp');
const { reportCsv } = require('../src/lib/reports');
const { statusEmail, emailReady } = require('../src/lib/notifications');

const input = {
  request_type: 'repair', customer_name: 'Sample Driver', callback_phone: '01700000000',
  location_text: 'Mirpur 10, Dhaka', vehicle_make: 'Toyota', vehicle_model: 'Axio',
  symptoms: 'The front tyre is flat', consent_store: true,
};

test('phone validation supports Bengali digits and local / international formats', () => {
  assert.equal(normalizePhone('০১৭০০০০০০০০'), '+8801700000000');
  assert.equal(normalizePhone('+880 (17) 0000-0000'), '+8801700000000');
  assert.equal(normalizePhone({ $ne: null }), null);
  assert.equal(normalizePhone('01200000000'), null);
});

test('email updates require consent and validate addresses without retaining opted-out input', () => {
  assert.equal(normalizeEmail(' Test+status@EXAMPLE.COM '), 'Test+status@example.com');
  assert.equal(normalizeEmail('a@example.com\r\nBcc:other@example.com'), null);
  assert.equal(normalizeEmail({ $ne: null }), null);
  assert.equal(normalizeEmail('a..b@example.com'), null);
  assert.equal(normalizeEmail('.driver@example.com'), null);
  assert.equal(validateRequest({ ...input, consent_status_email: true, notification_email: 'not-email' }).ok, false);
  assert.equal(validateRequest({ ...input, notification_email: 'private@example.com' }).value.notification_email, null);
  assert.equal(validateRequest({ ...input, consent_status_email: true, notification_email: 'driver@example.com' }).value.notification_email, 'driver@example.com');
  assert.equal(emailReady({ key: 'synthetic', from: 'updates@example.com' }), true);
  assert.equal(emailReady({ key: 'synthetic', from: 'invalid' }), false);
  const job = statusEmail({ public_code: 'LN-ABC234', language: 'bn', notification_email: 'driver@example.com' }, 'confirmed', { from: 'updates@example.com' });
  assert.equal(job.state, 'pending');
  assert.match(job.payload.text, /LN-ABC234/);
  assert.match(job.payload.subject, /GariSeba/);
  assert.equal(job.expires_at - job.created_at, 23 * 60 * 60 * 1000);
});

test('report CSV quotes data and neutralizes spreadsheet formulas', () => {
  const csv = reportCsv({ rows: [
    { date: '2026-11-10', type: '=HYPERLINK("https://invalid")', status: ' received, "checked"', count: 2 },
    { date: '2026-11-11', type: 'repair', status: '\t@unsafe', count: 1 },
  ] });
  assert.ok(csv.startsWith('\uFEFF"Date (Dhaka)"'));
  assert.match(csv, /'=HYPERLINK\(""https:\/\/invalid""\)/);
  assert.match(csv, /'\t@unsafe/);
  assert.match(csv, /" received, ""checked"""/);
  assert.ok(csv.endsWith('\r\n'));
});

test('request validation requires explicit consent and accepts a Bengali year', () => {
  const validated = validateRequest({ ...input, vehicle_year: '২০১৮' });
  assert.equal(validated.ok, true);
  assert.equal(validated.value.vehicle_year, 2018);
  assert.equal(validateRequest({ ...input, consent_store: 'true', vehicle_year: '2018x' }).ok, false);
});

test('request validation rejects incomplete or non-numeric coordinates and invalid photo IDs', () => {
  assert.equal(validateRequest({ ...input, map_lng: 90.4 }).ok, false);
  assert.equal(validateRequest({ ...input, map_lat: true, map_lng: 90.4 }).ok, false);
  assert.equal(validateRequest({ ...input, photo_ids: [{ $ne: 'x' }] }).ok, false);
  assert.equal(validateRequest({ ...input, map_lat: 23.8, map_lng: 90.4 }).ok, true);
});

test('location matching uses whole words, Unicode and configured outside keywords', async () => {
  const mock = {
    settings: { findOne: async () => ({ outside_keywords: 'সিলেট,khulna' }) },
    areas: { find: () => ({ sort: () => ({ toArray: async () => [
      { _id: 'dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা', keywords: '' },
      { _id: 'mirpur', name_en: 'Mirpur', name_bn: 'মিরপুর', keywords: 'pallabi' },
    ] }) }) },
  };
  assert.equal((await matchArea(mock, 'মিরপুর ১০, ঢাকা')).area._id, 'mirpur');
  assert.equal((await matchArea(mock, 'Dhaka Road, Khulna')).status, 'outside');
  assert.equal((await matchArea(mock, 'সিলেট')).status, 'outside');
  assert.equal((await matchArea(mock, 'dhakaville')).status, 'unknown');
});

test('sample pricing stays marked when the global flag is off', async () => {
  const mock = {
    settings: { findOne: async () => ({ pricing_is_sample: false }) },
    pricing: { find: () => ({ sort: () => ({ toArray: async () => [
      { _id: 'sample_test', min_bdt: 300, max_bdt: 500, label_en: 'Tyre', sample: true },
    ] }) }) },
  };
  assert.equal((await estimateFor(mock, 'tyre', 'en')).sample, true);
});

test('the assistant detects fire, smoke and brake failure in both languages', () => {
  for (const symptoms of ['Engine smoking', 'Brakes not working', 'ইঞ্জিন থেকে ধোঁয়া', 'ব্রেক কাজ করে না']) {
    const result = fallbackAnalyze({ symptoms, language: 'bn' });
    assert.equal(result.source, 'safety', symptoms);
    assert.match(result.next_step, /৯৯৯/);
  }
});

test('built-in follow-ups retain relevant history and favor a new explicit issue', () => {
  const base = { language: 'en', history: ['The tyre is flat'] };
  assert.equal(fallbackAnalyze({ ...base, symptoms: 'Can I drive?' }).category, 'tyre');
  assert.equal(fallbackAnalyze({ ...base, symptoms: 'My battery died' }).category, 'battery');
  assert.match(fallbackAnalyze({ ...base, symptoms: 'Can I drive?' }).summary, /cannot determine remotely/);
});

test('unsafe or malformed model replies are rejected', () => {
  const good = { summary: 'A circuit may need inspection.', next_step: 'Keep the car parked.', questions: ['Does it click?'], safety: false };
  assert.ok(validateOutput(good));
  assert.equal(validateOutput({ ...good, summary: 'It will cost ৫০০ টাকা.' }), null);
  assert.equal(validateOutput({ ...good, next_step: 'Wait 20 minutes.' }), null);
  assert.equal(validateOutput({ ...good, questions: ['Question?', { hidden: true }] }), null);
});

test('OpenAI adapter requires consent, redacts contact patterns and bypasses emergencies', async () => {
  let calls = 0;
  const model = { summary: 'The battery or starter could be involved.', next_step: 'Arrange an inspection.', questions: [], safety: false };
  const analyze = createAnalyzer({
    provider: { provider: 'openai', key: 'mock-key', model: 'mock-model' }, configured: true,
    fetcher: async (url, request) => {
      calls += 1;
      const body = JSON.parse(request.body);
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(body.store, false);
      assert.match(body.input, /\[phone\]/);
      assert.doesNotMatch(body.input, /01700000000/);
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(model) }] }] });
    },
  });
  const data = { symptoms: 'Battery low 01700000000', language: 'en' };
  assert.equal((await analyze(data)).source, 'fallback');
  assert.equal((await analyze({ ...data, consent_ai: true })).source, 'model');
  assert.equal((await analyze({ ...data, symptoms: 'Fire inside the car', consent_ai: true })).source, 'safety');
  assert.equal(calls, 1);
});

test('OpenAI failures return built-in guidance and log a diagnostic code', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const provider = { provider: 'openai', key: 'mock-key', model: 'mock-model' };
  const cases = [
    [Response.json({ error: 'mock-key' }, { status: 401 }), 'provider_http_401'],
    [Response.json({ error: 'quota' }, { status: 429 }), 'provider_http_429'],
    [Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'provider_incomplete_max_output_tokens'],
    [Response.json({ output: [] }), 'provider_empty_output'],
    [Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'mock-key' }] }] }), 'provider_invalid_output'],
  ];
  for (const [response, code] of cases) {
    const analyze = createAnalyzer({ provider, configured: true, fetcher: async () => response });
    const result = await analyze({ symptoms: 'Flat tyre', language: 'en', consent_ai: true });
    assert.equal(result.source, 'fallback');
    assert.equal(result.provider_unavailable, true);
    assert.deepEqual(warn.mock.calls.at(-1).arguments, ['[assistant] Provider request failed:', code]);
  }
});

test('Anthropic adapter handles a valid response and falls back on rejected output', async () => {
  const model = { summary: 'There may be a tyre puncture.', next_step: 'Arrange assistance.', questions: [], safety: false };
  const provider = { provider: 'anthropic', key: 'mock-key', model: 'mock-model' };
  const good = createAnalyzer({ provider, configured: true, fetcher: async (url, request) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(model) }] });
  } });
  const invalid = createAnalyzer({ provider, configured: true, fetcher: async () =>
    Response.json({ content: [{ type: 'text', text: JSON.stringify({ ...model, next_step: 'It costs 30 taka.' }) }] }),
  });
  const data = { symptoms: 'Flat tyre', language: 'en', consent_ai: true };
  assert.equal((await good(data)).source, 'model');
  assert.equal((await invalid(data)).provider_unavailable, true);
});

test('OpenAI connection check validates real response format and keeps credentials private', async () => {
  const provider = { provider: 'openai', key: 'synthetic-private-key', model: 'synthetic-model' };
  let calls = 0;
  const fetcher = async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(request.headers.Authorization, 'Bearer ' + provider.key);
    const body = JSON.parse(request.body);
    assert.equal(body.model, provider.model);
    assert.equal(body.store, false);
    assert.match(body.input, /My car clicks/);
    const model = { summary: 'The battery may need inspection.', next_step: 'Arrange an inspection.', questions: [], safety: false };
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(model) }] }] });
  };
  assert.equal((await testOpenAIConnection({ provider: { ...provider, provider: 'anthropic' }, fetcher })).code, 'provider_not_openai');
  assert.equal((await testOpenAIConnection({ provider: { ...provider, key: '' }, fetcher })).code, 'not_configured');
  assert.equal(calls, 0);
  const good = await testOpenAIConnection({ provider, fetcher });
  assert.equal(good.ok, true);
  assert.equal(good.code, 'connected');
  assert.ok(Number.isFinite(Date.parse(good.checkedAt)));
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(good), /synthetic-private-key/);

  for (const status of [400, 401, 403, 404, 429, 503]) {
    const result = await testOpenAIConnection({
      provider, fetcher: async () => Response.json({ error: { message: provider.key } }, { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, status === 503 ? 'provider_error' : 'provider_http_' + status);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-key/);
  }
  const timeout = await testOpenAIConnection({ provider, fetcher: async () => { throw new DOMException(provider.key, 'TimeoutError'); } });
  assert.equal(timeout.code, 'provider_timeout');
  assert.doesNotMatch(JSON.stringify(timeout), /synthetic-private-key/);
  const malformed = await testOpenAIConnection({ provider, fetcher: async () => new Response('not JSON') });
  assert.equal(malformed.code, 'provider_invalid_output');
});

test('file signatures and WhatsApp message exclude unsupported content and private key', () => {
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  const message = buildMessage({
    ...input, language: 'en', public_code: 'LN-ABC234', tracking_token_hash: 'secret-key',
    estimate: { min: 300, max: 800, sample: true }, next_step: 'technician', urgency: 'normal',
  }, { photoCount: 1 });
  assert.match(message, /LN-ABC234/);
  assert.match(message, /not attached/);
  assert.doesNotMatch(message, /secret-key|৳300/);
});
