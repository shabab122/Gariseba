'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/server');
const { connectDatabase, ensureDefaults } = require('../src/db');
const { deleteRequest } = require('../src/lib/requests');
const { paymentSummary, paymentFields } = require('../src/lib/payments');
const { slotFields, appointmentDay } = require('../src/lib/appointments');
const { validPassword } = require('../src/lib/customers');
const { sha256 } = require('../src/lib/security');
const password = 'CustomerPassword12345';
const input = { request_type: 'repair', customer_name: 'Test Driver', callback_phone: '01712345678', location_text: 'Mirpur 10, Dhaka', vehicle_make: 'Toyota', vehicle_model: 'Axio', symptoms: 'Flat tyre', consent_store: true };
const bill = { items: [{ description: 'সার্ভিস Service', quantity: 1, unit_bdt: '1000.10' }], discount_bdt: '0' };
const day = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka' }).format(date);
const tomorrow = () => day(new Date(Date.now() + 86400000));

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
  return { call, post: (path, body, extra) => call(path, { method: 'POST', body, ...extra }), cookie: () => cookie };
}
async function fixture(t) {
  const db = await connectDatabase({ uri: process.env.MONGODB_TEST_URI || undefined, dbName: 'gariseba_v28_' + randomUUID().replaceAll('-', '') });
  await ensureDefaults(db);
  const passwordHash = await bcrypt.hash('StaffPassword12345', 4);
  await db.adminUsers.insertMany(['owner', 'dispatcher', 'viewer'].map(role => ({ _id: role, role, passwordHash, authVersion: 1, failedLogins: 0, lockedUntil: null })));
  const server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); try { await db.db.dropDatabase(); } finally { await db.client.close(); } });
  const base = 'http://127.0.0.1:' + server.address().port;
  const guest = client(base), owner = client(base), dispatcher = client(base), viewer = client(base);
  for (const browser of [guest, owner, dispatcher, viewer]) await browser.call('/bootstrap');
  for (const [username, browser] of [['owner', owner], ['dispatcher', dispatcher], ['viewer', viewer]]) assert.equal((await browser.post('/admin/login', { username, password: 'StaffPassword12345' })).status, 200);
  async function customer(username) {
    const browser = client(base); await browser.call('/bootstrap');
    const response = await browser.post('/customer/register', { username, password, name: 'গ্রাহক ' + username });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return { browser, result: response.data };
  }
  async function submit(browser = guest) {
    const draft = randomUUID(); const response = await browser.post('/requests', input, { draft }); assert.equal(response.status, 201, JSON.stringify(response.data));
    const row = await db.requests.findOne({ public_code: response.data.code });
    return { row, receipt: response.data, draft, keys: { code: response.data.code, token: response.data.tracking_token } };
  }
  async function invoice(browser = guest) {
    const created = await submit(browser); await db.requests.updateOne({ _id: created.row._id }, { $set: { status: 'completed' } });
    assert.equal((await dispatcher.call('/admin/requests/' + created.row._id + '/invoice', { method: 'PUT', body: { ...bill, version: created.row.version } })).status, 200);
    return { ...created, row: await db.requests.findOne({ _id: created.row._id }) };
  }
  async function slot(hour = 10) {
    const response = await dispatcher.post('/admin/appointments', { date: tomorrow(), hour }); assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.slot;
  }
  return { db, guest, owner, dispatcher, viewer, base, customer, submit, invoice, slot };
}

test('new money, password and Dhaka slot validation reject malformed boundaries', () => {
  assert.equal(validPassword('a'.repeat(14)), false); assert.equal(validPassword('a'.repeat(15)), true); assert.equal(validPassword('ক'.repeat(25)), false);
  assert.equal(paymentSummary({ invoice: { total_poisha: 0 } }).status, 'paid');
  assert.equal(paymentSummary({ invoice: { total_poisha: 10000 }, payments: [{ amount_poisha: 4000, kind: 'payment' }] }).status, 'partially_paid');
  assert.equal(paymentSummary({}), null);
  for (const body of [null, [], {}, { operation_id: randomUUID(), kind: 'payment', method: 'cash', amount_bdt: '-1' }, { operation_id: randomUUID(), kind: 'refund', method: 'unknown', amount_bdt: '10' }]) assert.throws(() => paymentFields(body));
  assert.throws(() => slotFields(null));
  assert.throws(() => slotFields([]));
  assert.equal(appointmentDay('2026-11-16').toISOString(), '2026-11-15T18:00:00.000Z');
  for (const date of ['2026-02-30', '2026-13-01', 'bad']) assert.throws(() => appointmentDay(date));
  const fields = slotFields({ date: '2026-11-16', hour: 9 }, new Date('2026-11-15T00:00:00Z'));
  assert.equal(fields.starts_at.toISOString(), '2026-11-16T03:00:00.000Z'); assert.equal(+fields.ends_at - fields.starts_at, 3600000);
  assert.throws(() => slotFields({ date: '2026-11-16', hour: 9.5 }));
});

test('manual payments derive status exactly, prevent overpayment, enforce roles and version-safe refunds', { timeout: 30000 }, async t => {
  const { db, guest, dispatcher, viewer, invoice } = await fixture(t);
  const { row, keys } = await invoice(); const path = '/admin/requests/' + row._id + '/payments';
  const body = { version: row.version, operation_id: randomUUID(), kind: 'payment', method: 'cash', amount_bdt: '400.05', note: 'PRIVATE_PAYMENT_NOTE', reference: 'PRIVATE_REFERENCE' };
  assert.equal((await guest.post(path, body)).status, 401); assert.equal((await viewer.post(path, body)).status, 403);
  assert.equal((await dispatcher.post(path, body, { noCsrf: true })).status, 403);
  assert.equal((await dispatcher.post(path, { ...body, amount_bdt: '1000.11' })).status, 422);
  assert.equal((await dispatcher.post(path, body)).status, 201);
  assert.equal((await dispatcher.post(path, body)).status, 200);
  assert.equal((await dispatcher.post(path, { ...body, amount_bdt: '500' })).status, 409);
  let saved = await db.requests.findOne({ _id: row._id }); assert.equal(saved.payments.length, 1);
  let tracked = (await guest.post('/requests/lookup', keys)).data;
  assert.deepEqual(tracked.payment, { total_poisha: 100010, paid_poisha: 40005, balance_poisha: 60005, status: 'partially_paid' });
  assert.equal(tracked.payments, undefined); assert.ok(!JSON.stringify(tracked).includes('PRIVATE_'));
  const revision = await dispatcher.call('/admin/requests/' + row._id + '/invoice', { method: 'PUT', body: { ...bill, items: [{ description: 'Smaller bill', quantity: 1, unit_bdt: '300' }], version: saved.version } });
  assert.equal(revision.status, 422);
  const parallel = await Promise.all([0, 1].map(() => dispatcher.post(path, { ...body, operation_id: randomUUID(), version: saved.version, amount_bdt: '600.05' })));
  assert.deepEqual(parallel.map(r => r.status).sort(), [201, 409]);
  saved = await db.requests.findOne({ _id: row._id }); assert.equal(paymentSummary(saved).status, 'paid');
  assert.equal((await dispatcher.post(path, { ...body, operation_id: randomUUID(), version: saved.version, kind: 'refund', amount_bdt: '1000.11' })).status, 422);
  const refund = await dispatcher.post(path, { ...body, operation_id: randomUUID(), version: saved.version, kind: 'refund', amount_bdt: '1000.10' });
  assert.equal(refund.status, 201); assert.equal(refund.data.payment.status, 'unpaid');
  saved = await db.requests.findOne({ _id: row._id }); assert.equal(saved.payments.length, 3); assert.equal(saved.payments[2].actor, 'dispatcher');
  assert.equal((await guest.post('/requests/invoice', keys)).data.subarray(0, 5).toString(), '%PDF-');
});

test('same payment operation racing or retried after a lost response cannot create a duplicate ledger entry', { timeout: 25000 }, async t => {
  const { db, dispatcher, invoice } = await fixture(t); const { row } = await invoice();
  const body = { version: row.version, operation_id: randomUUID(), kind: 'payment', method: 'bkash', amount_bdt: '100.10', reference: 'TX-1' };
  const results = await Promise.all([0, 1].map(() => dispatcher.post('/admin/requests/' + row._id + '/payments', body)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  const saved = await db.requests.findOne({ _id: row._id }); assert.equal(saved.payments.length, 1); assert.equal(saved.version, row.version + 1);
});

test('customer registration uses separate identities, hashed credentials, rotated sessions and CSRF', { timeout: 30000 }, async t => {
  const { db, guest, customer, owner } = await fixture(t);
  assert.equal((await guest.post('/customer/register', { username: 'short', password: 'short', name: 'Test' })).status, 422);
  const before = guest.cookie();
  const register = await guest.post('/customer/register', { username: 'owner', password, name: 'Customer Owner' });
  assert.equal(register.status, 201); assert.notEqual(guest.cookie(), before);
  assert.equal(register.data.customer.username, 'owner'); assert.equal(register.data.customer.passwordHash, undefined);
  const row = await db.customers.findOne({ username: 'owner' }); assert.notEqual(row.passwordHash, password); assert.equal(row.recovery_hash, sha256(register.data.recovery_code));
  assert.equal((await owner.call('/admin/me')).data.user.role, 'owner');
  assert.equal((await guest.call('/admin/me')).status, 401);
  assert.equal((await guest.post('/customer/register', { username: 'OWNER', password, name: 'Other' })).status, 409);
  assert.equal((await guest.call('/bootstrap')).data.customer.username, 'owner');
  assert.equal((await guest.post('/customer/password', { current_password: password, new_password: password + 'new' }, { noCsrf: true })).status, 403);
  await guest.post('/customer/logout', {}); assert.equal((await guest.call('/customer/me')).data.customer, null);
  assert.equal((await guest.call('/customer/requests')).status, 401);
});

test('customer history attaches only signed-in requests and links older ones only with the correct private key', { timeout: 30000 }, async t => {
  const { db, guest, customer, submit } = await fixture(t);
  const legacy = await submit();
  const a = await customer('customer-a'), b = await customer('customer-b');
  const mine = await submit(a.browser), theirs = await submit(b.browser);
  assert.equal((await a.browser.call('/customer/requests')).data.requests.length, 1);
  assert.equal((await a.browser.call('/customer/requests/' + theirs.row._id)).status, 404);
  assert.equal((await a.browser.call('/customer/requests/' + theirs.row._id + '/invoice.pdf')).status, 404);
  assert.equal((await a.browser.post('/customer/requests/link', { ...legacy.keys, token: 'bad' })).status, 404);
  const raced = await Promise.all([a.browser.post('/customer/requests/link', legacy.keys), b.browser.post('/customer/requests/link', legacy.keys)]);
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  const ownerId = (await db.requests.findOne({ _id: legacy.row._id })).customer_id;
  const aId = (await db.customers.findOne({ username: 'customer-a' }))._id;
  const winningBrowser = ownerId === aId ? a.browser : b.browser;
  assert.equal((await winningBrowser.post('/customer/requests/link', legacy.keys)).status, 200);
  const detail = (await a.browser.call('/customer/requests/' + mine.row._id)).data.request;
  assert.equal(detail.tracking_token_hash, undefined); assert.equal(detail.customer_id, undefined); assert.equal(detail.technician_notes, undefined);
  assert.equal((await guest.post('/requests/lookup', legacy.keys)).status, 200);
  assert.equal((await a.browser.post('/requests', input, { draft: mine.draft })).status, 200);
  await deleteRequest(db, mine.row._id); assert.equal((await a.browser.call('/customer/requests/' + mine.row._id)).status, 404);
});

test('password changes and one-time recovery revoke earlier customer sessions without touching staff accounts', { timeout: 35000 }, async t => {
  const { db, base, customer, owner } = await fixture(t); const a = await customer('recover-me');
  const other = client(base); await other.call('/bootstrap'); assert.equal((await other.post('/customer/login', { username: 'recover-me', password })).status, 200);
  const changed = await a.browser.post('/customer/password', { current_password: password, new_password: password + '-new' }); assert.equal(changed.status, 200);
  assert.equal((await other.call('/customer/requests')).status, 401);
  assert.equal((await a.browser.call('/customer/requests')).status, 200);
  assert.equal((await other.post('/customer/recover', { username: 'recover-me', recovery_code: a.result.recovery_code, new_password: password + '-reset' })).status, 401);
  const recovered = await other.post('/customer/recover', { username: 'recover-me', recovery_code: changed.data.recovery_code, new_password: password + '-reset' });
  assert.equal(recovered.status, 200); assert.notEqual(recovered.data.recovery_code, changed.data.recovery_code);
  assert.equal((await a.browser.call('/customer/requests')).status, 401);
  assert.equal((await other.post('/customer/recover', { username: 'recover-me', recovery_code: changed.data.recovery_code, new_password: password + '-another' })).status, 401);
  assert.equal((await owner.call('/admin/me')).data.user.role, 'owner');
  const row = await db.customers.findOne({ username: 'recover-me' }); assert.equal(row.authVersion, 3); assert.equal(row.recovery_hash, sha256(recovered.data.recovery_code));
});

test('customer login locks repeated bad passwords and validates current session version', { timeout: 30000 }, async t => {
  const { db, customer } = await fixture(t); const a = await customer('lock-me');
  await a.browser.post('/customer/logout', {});
  for (let i = 0; i < 5; i++) assert.equal((await a.browser.post('/customer/login', { username: 'lock-me', password: 'wrong' })).status, 401);
  assert.equal((await a.browser.post('/customer/login', { username: 'lock-me', password })).status, 429);
  await db.customers.updateOne({ username: 'lock-me' }, { $set: { lockedUntil: new Date(Date.now() - 1) } });
  assert.equal((await a.browser.post('/customer/login', { username: 'lock-me', password })).status, 200);
  await db.customers.updateOne({ username: 'lock-me' }, { $set: { enabled: false } });
  assert.equal((await a.browser.call('/customer/requests')).status, 401);
  const refused = await a.browser.post('/requests', input, { draft: randomUUID() }); assert.equal(refused.status, 401);
});

test('appointment publication is staff controlled, uses Dhaka whole-hour slots and reveals no customer data', { timeout: 25000 }, async t => {
  const { guest, dispatcher, viewer, slot, submit } = await fixture(t);
  const payload = { date: tomorrow(), hour: 10 };
  assert.equal((await guest.post('/admin/appointments', payload)).status, 401); assert.equal((await viewer.post('/admin/appointments', payload)).status, 403);
  assert.equal((await dispatcher.post('/admin/appointments', payload, { noCsrf: true })).status, 403);
  const created = await slot();
  assert.equal((await dispatcher.post('/admin/appointments', payload)).status, 409);
  assert.equal((await dispatcher.post('/admin/appointments', { ...payload, hour: 24 })).status, 422);
  assert.equal((await dispatcher.post('/admin/appointments', { date: '2000-01-01', hour: 10 })).status, 422);
  const publicSlots = (await guest.call('/appointments/slots?date=' + tomorrow())).data.slots;
  assert.equal(publicSlots.length, 1); assert.equal(publicSlots[0].booking, undefined); assert.equal(publicSlots[0].active, undefined);
  assert.equal((await viewer.call('/admin/appointments?date=' + tomorrow())).data.slots.length, 1);
  const { keys } = await submit();
  assert.equal((await guest.post('/appointments/current', { ...keys, token: 'bad' })).status, 404);
  assert.equal((await guest.post('/appointments/book', { ...keys, slot_id: created._id, version: created.version })).status, 201);
  assert.equal((await guest.call('/appointments/slots?date=' + tomorrow())).data.slots.length, 0);
});

test('simultaneous slot booking permits one request and cancellation cannot remove a newer reservation', { timeout: 25000 }, async t => {
  const { db, guest, slot, submit } = await fixture(t); const first = await submit(), second = await submit(); const published = await slot();
  const results = await Promise.all([first, second].map(item => guest.post('/appointments/book', { ...item.keys, slot_id: published._id, version: published.version })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  let saved = await db.appointments.findOne({ _id: published._id }); const winner = saved.booking.request_id === first.row._id ? first : second;
  const loser = winner === first ? second : first; const oldBookingId = saved.booking.id;
  assert.equal((await guest.post('/appointments/cancel', { ...loser.keys, booking_id: oldBookingId })).status, 409);
  assert.equal((await guest.post('/appointments/cancel', { ...winner.keys, booking_id: oldBookingId })).status, 200);
  saved = await db.appointments.findOne({ _id: published._id });
  assert.equal((await guest.post('/appointments/book', { ...loser.keys, slot_id: saved._id, version: saved.version })).status, 201);
  assert.equal((await guest.post('/appointments/cancel', { ...winner.keys, booking_id: oldBookingId })).status, 409);
  assert.equal((await db.appointments.findOne({ _id: saved._id })).booking.request_id, loser.row._id);
});

test('one request cannot occupy two slots, and current bookings are safely replayable', { timeout: 25000 }, async t => {
  const { db, guest, slot, submit } = await fixture(t); const service = await submit(); const a = await slot(10), b = await slot(11);
  const results = await Promise.all([a, b].map(s => guest.post('/appointments/book', { ...service.keys, slot_id: s._id, version: s.version })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await db.appointments.countDocuments({ 'booking.request_id': service.row._id }), 1);
  const saved = await db.appointments.findOne({ 'booking.request_id': service.row._id });
  const replay = await guest.post('/appointments/book', { ...service.keys, slot_id: saved._id, version: 1 }); assert.equal(replay.status, 200);
  assert.equal(replay.data.appointment.booking_id, saved.booking.id);
});

test('bookings support account ownership, reject closed jobs, free deleted requests and allow staff cancellation', { timeout: 30000 }, async t => {
  const { db, guest, customer, submit, slot, dispatcher, viewer } = await fixture(t); const a = await customer('booker-a'), b = await customer('booker-b');
  const service = await submit(a.browser), published = await slot();
  assert.equal((await guest.post('/appointments/current', { request_id: service.row._id })).status, 401);
  assert.equal((await b.browser.post('/appointments/current', { request_id: service.row._id })).status, 404);
  assert.equal((await a.browser.post('/appointments/book', { request_id: service.row._id, slot_id: published._id, version: 1 })).status, 201);
  const own = (await a.browser.call('/customer/requests/' + service.row._id)).data; assert.equal(own.appointment.slot_id, published._id);
  const saved = await db.appointments.findOne({ _id: published._id });
  const body = { version: saved.version, booking_id: saved.booking.id };
  assert.equal((await viewer.post('/admin/appointments/' + saved._id + '/cancel', body)).status, 403);
  assert.equal((await dispatcher.call('/admin/appointments/' + saved._id, { method: 'PATCH', body: { version: saved.version, active: false } })).status, 409);
  assert.equal((await dispatcher.post('/admin/appointments/' + saved._id + '/cancel', body)).status, 200);
  let free = await db.appointments.findOne({ _id: saved._id });
  assert.equal((await a.browser.post('/appointments/book', { request_id: service.row._id, slot_id: free._id, version: free.version })).status, 201);
  await deleteRequest(db, service.row._id); assert.equal((await db.appointments.findOne({ _id: free._id })).booking, undefined);
  const closed = await submit(); await db.requests.updateOne({ _id: closed.row._id }, { $set: { status: 'completed' } });
  free = await db.appointments.findOne({ _id: saved._id });
  assert.equal((await guest.post('/appointments/book', { ...closed.keys, slot_id: free._id, version: free.version })).status, 409);
});

test('deletion while reserving an appointment cannot leave an orphan or resurrect request data', { timeout: 25000 }, async t => {
  const { db, guest, submit, slot } = await fixture(t); const service = await submit(), published = await slot();
  const original = db.appointments.findOneAndUpdate.bind(db.appointments);
  db.appointments.findOneAndUpdate = async (...args) => { const saved = await original(...args); if (saved?.booking) await deleteRequest(db, service.row._id); return saved; };
  const response = await guest.post('/appointments/book', { ...service.keys, slot_id: published._id, version: published.version });
  assert.equal(response.status, 409); assert.equal((await db.appointments.findOne({ _id: published._id })).booking, undefined);
  assert.equal((await db.requests.findOne({ _id: service.row._id })).state, 'deleted');
});

test('customer history paginates only owned records and serves only its own bill and payment summary', { timeout: 30000 }, async t => {
  const { db, customer, submit, invoice, dispatcher } = await fixture(t);
  const a = await customer('history-a'), b = await customer('history-b');
  const own = await invoice(a.browser), other = await submit(b.browser);
  const body = { operation_id: randomUUID(), version: own.row.version, kind: 'payment', method: 'cash', amount_bdt: '100' };
  assert.equal((await dispatcher.post('/admin/requests/' + own.row._id + '/payments', body)).status, 201);
  const detail = (await a.browser.call('/customer/requests/' + own.row._id)).data.request;
  assert.equal(detail.payment.paid_poisha, 10000); assert.equal(detail.payments, undefined);
  assert.equal((await a.browser.call('/customer/requests/' + own.row._id + '/invoice.pdf')).data.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await b.browser.call('/customer/requests/' + own.row._id + '/invoice.pdf')).status, 404);
  await db.requests.insertMany(Array.from({ length: 21 }, (_, index) => ({ ...own.row, _id: randomUUID(), public_code: 'LN-HIST' + String(index).padStart(2, '0'), created_at: new Date(Date.now() + index) })));
  const first = (await a.browser.call('/customer/requests?page=1')).data, second = (await a.browser.call('/customer/requests?page=2')).data;
  assert.equal(first.requests.length, 20); assert.equal(first.hasNext, true); assert.equal(second.requests.length, 2); assert.equal(second.hasNext, false);
  assert.equal(new Set([...first.requests, ...second.requests].map(row => row._id)).size, 22);
  assert.ok(!first.requests.concat(second.requests).some(row => row._id === other.row._id));
});
