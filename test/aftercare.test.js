'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/server');
const { connectDatabase, ensureDefaults } = require('../src/db');
const { invoiceFields, makeInvoice, parseMoney, renderInvoice } = require('../src/lib/invoices');
const { feedbackFields } = require('../src/lib/feedback');
const { smsReady, readSmsConfig, processSmsJob, statusSms, checkSmsDelivery } = require('../src/lib/sms');
const { deleteRequest } = require('../src/lib/requests');
const { validateRequest } = require('../src/lib/validate');
const { sha256 } = require('../src/lib/security');

const sms = { enabled: true, accountSid: 'AC' + 'a'.repeat(32), authToken: 'b'.repeat(32), from: '+12025550123', messagingServiceSid: '' };
const providerId = 'SM' + 'c'.repeat(32);
const input = { request_type: 'repair', customer_name: 'রহিম Ahmed', callback_phone: '০১৭১২৩৪৫৬৭৮', location_text: 'Mirpur 10, Dhaka', vehicle_make: 'Toyota', vehicle_model: 'Axio', symptoms: 'Flat tyre', consent_store: true };
const bill = { items: [{ description: 'চাকা মেরামত / tyre repair', quantity: 2, unit_bdt: '500.15' }, { description: 'Parts', quantity: 1, unit_bdt: '100.10' }], discount_bdt: '50.20', notes: 'ধন্যবাদ। Thank you.' };
const accepted = (status = 'queued') => Response.json({ sid: providerId, account_sid: sms.accountSid, status, error_code: null });

function client(base) {
  let cookie, csrf;
  async function call(path, { method = 'GET', body, draft, noCsrf = false } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (csrf && !noCsrf) headers['X-CSRF-Token'] = csrf;
    if (draft) headers['X-Draft-Key'] = draft;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    if (data.csrf) csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }
  return { call, post: (path, body, extra) => call(path, { method: 'POST', body, ...extra }) };
}
async function fixture(t, options = {}) {
  const db = await connectDatabase({ uri: process.env.MONGODB_TEST_URI || undefined, dbName: 'gariseba_aftercare_' + randomUUID().replaceAll('-', '') });
  await ensureDefaults(db);
  const password = 'SyntheticTestOnly123';
  const passwordHash = await bcrypt.hash(password, 4);
  await db.adminUsers.insertMany(['owner', 'dispatcher', 'viewer'].map((role) => ({ _id: role, role, passwordHash, authVersion: 1, failedLogins: 0, lockedUntil: null })));
  const server = createApp(db, { sms, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); try { await db.db.dropDatabase(); } finally { await db.client.close(); } });
  const base = 'http://127.0.0.1:' + server.address().port;
  const customer = client(base), owner = client(base), dispatcher = client(base), viewer = client(base);
  for (const browser of [customer, owner, dispatcher, viewer]) await browser.call('/bootstrap');
  for (const [username, browser] of [['owner', owner], ['dispatcher', dispatcher], ['viewer', viewer]]) assert.equal((await browser.post('/admin/login', { username, password })).status, 200);
  async function submit(fields = {}) {
    const draft = randomUUID();
    const result = await customer.post('/requests', { ...input, ...fields }, { draft });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return { ...result.data, draft, keys: { code: result.data.code, token: result.data.tracking_token } };
  }
  return { db, customer, owner, dispatcher, viewer, base, submit };
}

test('bill and feedback validation keeps decimal arithmetic exact and rejects invalid charges', () => {
  assert.equal(parseMoney('০.১০'), 10);
  assert.equal(parseMoney('500.01'), 50001);
  for (const amount of ['-1', '1.005', '1e2', 'Infinity', '', null, true]) assert.throws(() => parseMoney(amount));
  const result = invoiceFields(bill);
  assert.equal(result.subtotal_poisha, 110040);
  assert.equal(result.discount_poisha, 5020);
  assert.equal(result.total_poisha, 105020);
  for (const payload of [{ items: [] }, { ...bill, discount_bdt: '999999' }, { items: [{ description: 'Part', quantity: 0, unit_bdt: '1' }] }, { ...bill, notes: 'a'.repeat(1501) }]) assert.throws(() => invoiceFields(payload));
  assert.deepEqual(feedbackFields({ rating: 5, comment: ' ভালো ' }), { rating: 5, comment: 'ভালো' });
  for (const rating of [0, 6, 4.5, '5', true]) assert.throws(() => feedbackFields({ rating }));
  assert.throws(() => feedbackFields({ rating: 5, comment: 'a'.repeat(1001) }));
  assert.equal(smsReady(sms), true);
  assert.equal(smsReady({ ...sms, enabled: false }), false);
  assert.equal(smsReady(readSmsConfig({})), false);
  assert.equal(smsReady({ ...sms, from: 'javascript:bad' }), false);
  assert.equal(smsReady({ ...sms, messagingServiceSid: 'invalid' }), false);
  assert.equal(smsReady({ ...sms, from: '', messagingServiceSid: 'MG' + 'd'.repeat(32) }), true);
});

test('issued PDF bills require completion, correct tracking key, staff role, CSRF and current version', { timeout: 25000 }, async (t) => {
  const { db, customer, dispatcher, viewer, submit } = await fixture(t);
  const receipt = await submit();
  let row = await db.requests.findOne({ public_code: receipt.code });
  const path = '/admin/requests/' + row._id + '/invoice';
  assert.equal((await customer.post('/requests/invoice', { ...receipt.keys, token: 'wrong' })).status, 404);
  assert.equal((await customer.post('/requests/invoice', receipt.keys)).status, 409);
  assert.equal((await customer.call(path, { method: 'PUT', body: { ...bill, version: 1 } })).status, 401);
  assert.equal((await viewer.call(path, { method: 'PUT', body: { ...bill, version: 1 } })).status, 403);
  assert.equal((await dispatcher.call(path, { method: 'PUT', body: { ...bill, version: 1 } })).status, 409);
  await db.requests.updateOne({ _id: row._id }, { $set: { status: 'completed', technician_notes: 'PRIVATE_INTERNAL_NOTE', final_bill_note: 'Legacy bill note' } });
  assert.equal((await dispatcher.call(path, { method: 'PUT', noCsrf: true, body: { ...bill, version: 1 } })).status, 403);
  const results = await Promise.all([0, 1].map(() => dispatcher.call(path, { method: 'PUT', body: { ...bill, version: 1 } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.invoice.total_poisha, 105020);
  assert.equal(row.invoice.revision, 1);
  assert.equal(row.final_bill_note, 'Legacy bill note');
  const tracked = (await customer.post('/requests/lookup', receipt.keys)).data;
  assert.equal(tracked.invoice.total_poisha, 105020);
  assert.equal(tracked.invoice.customer, undefined);
  assert.equal(tracked.invoice.issued_by, undefined);
  assert.equal(tracked.technician_notes, undefined);
  const pdf = await customer.post('/requests/invoice', receipt.keys);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.match(pdf.headers.get('cache-control'), /no-store/);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.data.length > 10000);
  assert.equal((await viewer.call(path + '.pdf')).status, 200);
  assert.equal((await dispatcher.call(path, { method: 'PUT', body: { ...bill, version: row.version } })).status, 200);
  const revised = await db.requests.findOne({ _id: row._id });
  assert.equal(revised.invoice.revision, 2);
  assert.equal(+revised.invoice.issued_at, +row.invoice.issued_at);
  await deleteRequest(db, row._id);
  assert.equal((await customer.post('/requests/invoice', receipt.keys)).status, 404);
  assert.equal((await viewer.call(path + '.pdf')).status, 404);
});

test('feedback is private, completed-only, atomic, one per request and idempotent on a lost response', { timeout: 25000 }, async (t) => {
  const { db, customer, viewer, submit } = await fixture(t);
  const receipt = await submit();
  const payload = { ...receipt.keys, rating: 5, comment: '<script>text only</script> ভালো সার্ভিস' };
  assert.equal((await customer.post('/requests/feedback', { ...payload, token: 'wrong' })).status, 404);
  assert.equal((await customer.post('/requests/feedback', payload)).status, 409);
  const row = await db.requests.findOne({ public_code: receipt.code });
  await db.requests.updateOne({ _id: row._id }, { $set: { status: 'completed' } });
  assert.equal((await customer.post('/requests/feedback', { ...payload, rating: 0 })).status, 422);
  assert.equal((await customer.post('/requests/feedback', payload, { noCsrf: true })).status, 403);
  const results = await Promise.all([customer.post('/requests/feedback', payload), customer.post('/requests/feedback', { ...payload, rating: 1 })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const saved = await db.requests.findOne({ _id: row._id });
  assert.equal(saved.version, row.version + 1);
  assert.equal((await customer.post('/requests/feedback', { ...payload, rating: saved.feedback.rating })).status, 200);
  assert.equal((await customer.post('/requests/lookup', receipt.keys)).data.feedback.rating, saved.feedback.rating);
  assert.equal((await viewer.call('/admin/requests/' + row._id)).data.request.feedback.comment, payload.comment);
  await deleteRequest(db, row._id);
  assert.equal((await db.requests.findOne({ _id: row._id })).feedback, undefined);
});

test('SMS opt-in is separate, old fingerprints still replay, and status updates enqueue once atomically', { timeout: 25000 }, async (t) => {
  const { db, customer, dispatcher, submit } = await fixture(t);
  const old = await submit();
  const row = await db.requests.findOne({ public_code: old.code });
  const { consent_status_email, notification_email, ...legacyValue } = validateRequest(input).value;
  assert.equal(row.fingerprint, sha256(JSON.stringify([legacyValue, false])));
  assert.equal((await customer.post('/requests', input, { draft: old.draft })).status, 200);
  assert.equal(row.consent_status_sms, undefined);
  const receipt = await submit({ consent_status_sms: true });
  let opted = await db.requests.findOne({ public_code: receipt.code });
  assert.ok(opted.sms_consent_at instanceof Date);
  const path = '/admin/requests/' + opted._id;
  const result = await Promise.all([0, 1].map(() => dispatcher.call(path, { method: 'PATCH', body: { version: opted.version, status: 'confirmed' } })));
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  opted = await db.requests.findOne({ _id: opted._id });
  assert.equal(opted.sms_outbox.length, 1);
  assert.equal(opted.sms_outbox[0].payload.to, '+8801712345678');
  assert.ok(!opted.sms_outbox[0].payload.text.includes(receipt.tracking_token));
  assert.equal((await customer.post('/requests/lookup', receipt.keys)).data.smsUpdates, true);
  await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, status: 'confirmed' } });
  assert.equal((await db.requests.findOne({ _id: row._id })).sms_outbox, undefined);
});

test('SMS worker leases prevent duplicate sends, 429 backs off, delivery check stores only a safe summary', { timeout: 25000 }, async (t) => {
  const { db, submit, dispatcher } = await fixture(t);
  const receipt = await submit({ consent_status_sms: true });
  const row = await db.requests.findOne({ public_code: receipt.code });
  const now = new Date();
  const first = statusSms(row, 'confirmed', now), second = statusSms(row, 'in_progress', new Date(+now + 1));
  await db.requests.updateOne({ _id: row._id }, { $set: { sms_outbox: [first, second] } });
  let calls = 0;
  const rateLimited = async (url, options) => { calls++; assert.match(url, /Messages\.json$/); assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(sms.accountSid + ':' + sms.authToken).toString('base64')); const body = new URLSearchParams(options.body); assert.equal(body.get('To'), '+8801712345678'); assert.equal(body.get('From'), sms.from); return new Response('', { status: 429 }); };
  const outcomes = await Promise.all([0, 1].map(() => processSmsJob(db, { sms, now, fetcher: rateLimited })));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(calls, 1);
  assert.equal(await processSmsJob(db, { sms, now: new Date(+now + 100), fetcher: rateLimited }), false);
  const later = new Date(+now + 31000);
  await processSmsJob(db, { sms, now: later, fetcher: async () => { calls++; return accepted(); } });
  let updated = await db.requests.findOne({ _id: row._id });
  assert.equal(updated.sms_outbox[0].state, 'accepted');
  assert.equal(updated.sms_outbox[1].attempts, 0);
  const summary = await checkSmsDelivery(db, row._id, first.id, { sms, now: new Date(+later + 6000), fetcher: async () => Response.json({ sid: providerId, account_sid: sms.accountSid, status: 'delivered', body: 'PRIVATE_PROVIDER_TEXT', authToken: sms.authToken }) });
  assert.equal(summary.delivery.status, 'delivered');
  updated = await db.requests.findOne({ _id: row._id });
  assert.equal(updated.sms_outbox[0].delivery.body, undefined);
  const detail = (await dispatcher.call('/admin/requests/' + row._id)).data.request;
  assert.equal(detail.sms_outbox[0].payload, undefined);
  assert.equal(detail.sms_outbox[0].claim_token, undefined);
  assert.equal(detail.sms_lock_token, undefined);
  await processSmsJob(db, { sms, now: later, fetcher: async () => accepted() });
  assert.equal((await db.requests.findOne({ _id: row._id })).sms_outbox[1].state, 'accepted');
});

test('SMS timeouts, malformed success, 5xx and expired send leases are never automatically replayed', { timeout: 25000 }, async (t) => {
  const { db, submit } = await fixture(t);
  const receipt = await submit({ consent_status_sms: true });
  const row = await db.requests.findOne({ public_code: receipt.code });
  const now = new Date();
  for (const fetcher of [async () => { throw new Error('network contained secret'); }, async () => new Response('', { status: 503 }), async () => Response.json({ sid: 'bad' })]) {
    const job = statusSms(row, 'confirmed', now);
    await db.requests.updateOne({ _id: row._id }, { $set: { sms_outbox: [job] } });
    let count = 0;
    await processSmsJob(db, { sms, now, fetcher: async (...args) => { count++; return fetcher(...args); } });
    const saved = (await db.requests.findOne({ _id: row._id })).sms_outbox[0];
    assert.equal(saved.state, 'unknown');
    assert.ok(!saved.last_error.includes('secret'));
    assert.equal(await processSmsJob(db, { sms, now, fetcher: async () => { count++; return accepted(); } }), false);
    assert.equal(count, 1);
  }
  const interrupted = { ...statusSms(row, 'confirmed', now), state: 'sending', claim_token: randomUUID(), claim_until: new Date(+now - 1), attempts: 1 };
  await db.requests.updateOne({ _id: row._id }, { $set: { sms_outbox: [interrupted] } });
  assert.equal(await processSmsJob(db, { sms, now, fetcher: () => { throw new Error('must not send'); } }), false);
  assert.equal((await db.requests.findOne({ _id: row._id })).sms_outbox[0].state, 'unknown');
});

test('SMS opt-out cancels waiting messages and deletion cannot resurrect a notification', { timeout: 25000 }, async (t) => {
  const { db, submit, customer, dispatcher, viewer } = await fixture(t);
  const receipt = await submit({ consent_status_sms: true });
  let row = await db.requests.findOne({ public_code: receipt.code });
  const job = statusSms(row, 'confirmed');
  await db.requests.updateOne({ _id: row._id }, { $set: { sms_outbox: [job] } });
  assert.equal((await viewer.post('/admin/requests/' + row._id + '/sms/' + job.id + '/retry', {})).status, 403);
  await processSmsJob(db, { sms, fetcher: async () => new Response('', { status: 401 }) });
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.sms_outbox[0].state, 'failed');
  assert.equal((await dispatcher.post('/admin/requests/' + row._id + '/sms/' + job.id + '/retry', {})).status, 200);
  assert.equal((await customer.post('/requests/privacy', { ...receipt.keys, action: 'stop_sms' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.consent_status_sms, false);
  assert.equal(row.sms_outbox[0].state, 'cancelled');
  assert.equal(await processSmsJob(db, { sms, fetcher: () => { throw new Error('must not send'); } }), false);
  assert.equal((await customer.post('/requests/lookup', receipt.keys)).data.smsUpdates, false);
  const second = await submit({ consent_status_sms: true });
  const next = await db.requests.findOne({ public_code: second.code });
  await db.requests.updateOne({ _id: next._id }, { $set: { sms_outbox: [statusSms(next, 'confirmed')] } });
  await processSmsJob(db, { sms, fetcher: async () => { await deleteRequest(db, next._id); return accepted(); } });
  assert.equal((await db.requests.findOne({ _id: next._id })).sms_outbox, undefined);
});

test('SMS stays unavailable without credentials and a saved multilingual long bill produces a PDF', { timeout: 25000 }, async (t) => {
  const { customer } = await fixture(t, { sms: { enabled: false } });
  assert.equal((await customer.call('/bootstrap')).data.integrations.statusSms, false);
  const denied = await customer.post('/requests', { ...input, consent_status_sms: true }, { draft: randomUUID() });
  assert.equal(denied.status, 422);
  const invoice = makeInvoice({ public_code: 'LN-LONG12', customer_name: 'আহমেদ Ahmed', callback_phone: '+8801712345678', vehicle_make: 'Toyota', vehicle_model: 'Axio' }, invoiceFields({ items: Array.from({ length: 20 }, (_, index) => ({ description: 'বাংলা সার্ভিসের বিবরণ Item ' + index + ' - ' + 'long text '.repeat(8), quantity: 1, unit_bdt: '10.10' })), notes: 'বিলের বিস্তারিত note. '.repeat(60) }), 'owner');
  const pdf = await renderInvoice(invoice);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10000);
});

test('assigned technician status changes queue SMS but cannot issue bills or change SMS consent', { timeout: 25000 }, async (t) => {
  const { db, submit, base } = await fixture(t);
  const technicianId = randomUUID();
  await db.technicians.insertOne({ _id: technicianId, name: 'Technician A', active: true, version: 1 });
  await db.adminUsers.insertOne({ _id: 'technician', role: 'technician', technician_id: technicianId, enabled: true,
    authVersion: 1, passwordHash: await bcrypt.hash('SyntheticTechOnly123', 4), failedLogins: 0, lockedUntil: null });
  const technician = client(base);
  await technician.call('/bootstrap');
  assert.equal((await technician.post('/admin/login', { username: 'technician', password: 'SyntheticTechOnly123' })).status, 200);
  const receipt = await submit({ consent_status_sms: true });
  let row = await db.requests.findOne({ public_code: receipt.code });
  await db.requests.updateOne({ _id: row._id }, { $set: { technician: { id: technicianId, name: 'Technician A' } } });
  const path = '/admin/technician/requests/' + row._id;
  assert.equal((await technician.call(path, { method: 'PATCH', body: { version: row.version, status: 'in_progress' } })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.sms_outbox.length, 1);
  assert.equal(row.sms_outbox[0].status, 'in_progress');
  assert.equal((await technician.call(path, { method: 'PATCH', body: { version: row.version, consent_status_sms: false } })).status, 422);
  assert.equal((await technician.call('/admin/requests/' + row._id + '/invoice', { method: 'PUT', body: { ...bill, version: row.version } })).status, 403);
  assert.equal((await technician.call('/admin/requests/' + row._id + '/invoice.pdf')).status, 403);
  const detail = (await technician.call(path)).data.request;
  assert.equal(detail.sms_outbox, undefined);
  assert.equal(detail.invoice, undefined);
});

test('concurrent SMS delivery checks cannot overwrite a newer result with an older response', { timeout: 25000 }, async (t) => {
  const { db, submit } = await fixture(t);
  const receipt = await submit({ consent_status_sms: true });
  const row = await db.requests.findOne({ public_code: receipt.code });
  const now = new Date();
  const job = { ...statusSms(row, 'completed', now), state: 'accepted', provider_id: providerId, provider_account: sms.accountSid,
    delivery: { status: 'sent', checked_at: new Date(+now - 20000) } };
  await db.requests.updateOne({ _id: row._id }, { $set: { sms_outbox: [job] } });
  const waiting = [];
  let ready;
  const bothReady = new Promise(resolve => { ready = resolve; });
  const fetcher = () => new Promise(resolve => { waiting.push(resolve); if (waiting.length === 2) ready(); });
  const first = checkSmsDelivery(db, row._id, job.id, { sms, now, fetcher });
  const second = checkSmsDelivery(db, row._id, job.id, { sms, now: new Date(+now + 1), fetcher }).catch(error => error);
  await bothReady;
  waiting[0](accepted('delivered'));
  // Either request may be the first DB reader. Observe a saved update before releasing the stale response.
  await Promise.race([first, second]);
  waiting[1](accepted('queued'));
  const outcomes = await Promise.allSettled([first, second]);
  assert.ok(outcomes.some(result => result.status === 'rejected' || result.value?.status === 409));
  assert.equal((await db.requests.findOne({ _id: row._id })).sms_outbox[0].delivery.status, 'delivered');
});
