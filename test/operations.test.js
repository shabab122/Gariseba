'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/server');
const { connectDatabase, ensureDefaults } = require('../src/db');
const { processEmailJob, statusEmail } = require('../src/lib/notifications');
const { deleteRequest } = require('../src/lib/requests');
const { validateRequest } = require('../src/lib/validate');
const { sha256 } = require('../src/lib/security');
const { checkEmailDelivery } = require('../src/lib/email-delivery');

const email = { key: 'synthetic-email-key', from: 'updates@example.test' };
const input = {
  request_type: 'repair', customer_name: 'Test Driver', callback_phone: '01700000000',
  location_text: 'Mirpur 10, Dhaka', vehicle_make: 'Toyota', vehicle_model: 'Axio',
  symptoms: 'Flat tyre', consent_store: true,
};

function client(base) {
  let cookie, csrf;
  async function call(path, { method = 'GET', body, draft, withoutCsrf = false } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (csrf && !withoutCsrf) headers['X-CSRF-Token'] = csrf;
    if (draft) headers['X-Draft-Key'] = draft;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, { method, headers, body: JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    if (data.csrf) csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }
  return { call, post: (path, body, extra) => call(path, { method: 'POST', body, ...extra }) };
}

async function fixture(t, options = {}) {
  const db = await connectDatabase({ dbName: 'gariseba_operations_' + randomUUID().replaceAll('-', ''), uri: process.env.MONGODB_TEST_URI || undefined });
  await ensureDefaults(db);
  const password = 'SyntheticTestOnly123';
  const passwordHash = await bcrypt.hash(password, 4);
  await db.adminUsers.insertMany(['owner', 'dispatcher', 'viewer'].map((role) => ({
    _id: role, role, passwordHash, authVersion: 1, failedLogins: 0, lockedUntil: null,
  })));
  const server = createApp(db, { email, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    try { await db.db.dropDatabase(); } finally { await db.client.close(); }
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const customer = client(base), owner = client(base), dispatcher = client(base), viewer = client(base);
  for (const browser of [customer, owner, dispatcher, viewer]) await browser.call('/bootstrap');
  for (const [username, browser] of [['owner', owner], ['dispatcher', dispatcher], ['viewer', viewer]]) {
    assert.equal((await browser.post('/admin/login', { username, password })).status, 200);
  }
  return { db, customer, owner, dispatcher, viewer, base };
}

test('technician assignments are versioned, permission checked and compatible with existing requests', { timeout: 25000 }, async (t) => {
  const { db, customer, owner, dispatcher, viewer } = await fixture(t);
  assert.equal((await dispatcher.post('/admin/technicians', { name: 'Not allowed' })).status, 403);
  assert.equal((await viewer.post('/admin/technicians', { name: 'Not allowed' })).status, 403);
  assert.equal((await owner.post('/admin/technicians', { name: 'A', phone: 'bad' })).status, 422);
  const first = (await owner.post('/admin/technicians', { name: 'Technician A', phone: '01700000000' })).data.technician;
  const second = (await owner.post('/admin/technicians', { name: 'Technician B' })).data.technician;
  assert.equal((await viewer.call('/admin/technicians')).data.technicians.length, 2);
  const draft = randomUUID();
  const created = await customer.post('/requests', input, { draft });
  assert.equal(created.status, 201);
  let row = await db.requests.findOne({ public_code: created.data.code });
  const { consent_status_email, notification_email, ...oldValue } = validateRequest(input).value;
  assert.equal(row.fingerprint, sha256(JSON.stringify([oldValue, false])));
  assert.equal((await customer.post('/requests', input, { draft })).status, 200);
  assert.equal(row.notification_email, null);
  assert.equal((await viewer.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, technician_id: first._id } })).status, 403);
  assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, technician_id: first._id } })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.technician.name, first.name);
  assert.deepEqual(row.assignment_history[0], {
    from: null, to: { id: first._id, name: first.name }, actor: 'dispatcher', created_at: row.updated_at,
  });
  const results = await Promise.all([0, 1].map(() => dispatcher.call('/admin/requests/' + row._id, {
    method: 'PATCH', body: { version: row.version, technician_id: second._id, status: 'confirmed' },
  })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.technician.id, second._id);
  assert.equal(row.assignment_history.length, 2);
  assert.deepEqual(row.assignment_history[1].from, { id: first._id, name: first.name });
  assert.deepEqual(row.assignment_history[1].to, { id: second._id, name: second.name });
  assert.equal(row.email_outbox, undefined);
  assert.equal((await owner.call('/admin/technicians/' + first._id, { method: 'PATCH', body: { ...first, version: 1, active: false } })).status, 200);
  assert.equal((await owner.call('/admin/technicians/' + first._id, { method: 'PATCH', body: { ...first, version: 1, active: true } })).status, 409);
  assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, technician_id: first._id } })).status, 422);
  assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, technician_id: '' } })).status, 200);
  const cleared = await db.requests.findOne({ _id: row._id });
  assert.equal(cleared.technician, null);
  assert.equal(cleared.assignment_history.length, 3);
  assert.equal(cleared.assignment_history[2].to, null);
  const tracked = await customer.post('/requests/lookup', { code: created.data.code, token: created.data.tracking_token });
  assert.equal(tracked.status, 200);
  assert.equal(tracked.data.emailUpdates, false);
  assert.equal(tracked.data.technician, undefined);
  assert.equal(tracked.data.assignment_history, undefined);
});

test('technician queue filters combine with existing filters, paginate and include inactive and legacy unassigned records', { timeout: 25000 }, async (t) => {
  const { db, owner, dispatcher, viewer, customer } = await fixture(t);
  const first = (await owner.post('/admin/technicians', { name: 'First technician' })).data.technician;
  const inactive = (await owner.post('/admin/technicians', { name: 'Inactive technician', active: false })).data.technician;
  const base = {
    ...validateRequest(input).value, state: 'submitted', status: 'received', photos: [],
    urgency: 'urgent', created_at: new Date('2026-11-12T18:00:00Z'),
    technician: { id: first._id, name: first.name },
  };
  const rows = Array.from({ length: 22 }, (_, index) => ({
    ...base, _id: randomUUID(), public_code: 'LN-TECH' + String(index).padStart(2, '0'),
    created_at: new Date(base.created_at.getTime() + index),
  }));
  rows.push(
    { ...base, _id: randomUUID(), public_code: 'LN-BEFORE', created_at: new Date('2026-11-12T17:59:59.999Z') },
    { ...base, _id: randomUUID(), public_code: 'LN-AFTER', created_at: new Date('2026-11-13T18:00:00Z') },
    { ...base, _id: randomUUID(), public_code: 'LN-NORMAL', urgency: 'normal' },
    { ...base, _id: randomUUID(), public_code: 'LN-BATTERY', request_type: 'battery' },
    { ...base, _id: randomUUID(), public_code: 'LN-INACTIVE', technician: { id: inactive._id, name: inactive.name } },
    { ...base, _id: randomUUID(), public_code: 'LN-NULL', technician: null },
    { ...base, _id: randomUUID(), public_code: 'LN-EMPTY', technician: {} },
    { ...base, _id: randomUUID(), public_code: 'LN-DELETED', state: 'deleted' },
  );
  const legacy = { ...base, _id: randomUUID(), public_code: 'LN-LEGACY' };
  delete legacy.technician;
  rows.push(legacy);
  await db.requests.insertMany(rows);
  const query = '/admin/requests?technician=' + first._id + '&type=repair&urgency=urgent&status=received&from=2026-11-13&to=2026-11-13';
  const page1 = await viewer.call(query);
  assert.equal(page1.status, 200);
  assert.equal(page1.data.requests.length, 20);
  assert.equal(page1.data.hasNext, true);
  assert.equal(page1.data.counts.received, rows.length - 1);
  const page2 = await dispatcher.call(query + '&page=2');
  assert.deepEqual(page2.data.requests.map((row) => row.public_code), ['LN-TECH01', 'LN-TECH00']);
  assert.equal(page2.data.hasNext, false);
  assert.ok(page1.data.requests.every((row) => row.technician.id === first._id));
  const byCode = await owner.call(query + '&code=ln-tech00');
  assert.deepEqual(byCode.data.requests.map((row) => row.public_code), ['LN-TECH00']);
  const byInactive = await viewer.call('/admin/requests?technician=' + inactive._id);
  assert.deepEqual(byInactive.data.requests.map((row) => row.public_code), ['LN-INACTIVE']);
  const unassigned = await viewer.call('/admin/requests?technician=unassigned');
  assert.deepEqual(unassigned.data.requests.map((row) => row.public_code).sort(), ['LN-EMPTY', 'LN-LEGACY', 'LN-NULL']);
  assert.equal((await viewer.call('/admin/requests?technician=' + randomUUID())).data.requests.length, 0);
  assert.equal((await viewer.call('/admin/requests?technician=bad')).status, 422);
  assert.equal((await viewer.call('/admin/requests?technician=unassigned&technician=' + first._id)).status, 422);
  assert.equal((await viewer.post('/admin/requests/search', { technician: { $ne: null } })).status, 422);
  assert.equal((await customer.call('/admin/requests?technician=unassigned')).status, 401);
});

test('customer search matches literal names and normalized phone formats, combines filters and requires staff and CSRF', { timeout: 25000 }, async (t) => {
  const { db, owner, viewer, dispatcher, customer } = await fixture(t);
  const technician = (await owner.post('/admin/technicians', { name: 'Search technician' })).data.technician;
  const base = {
    ...validateRequest(input).value, state: 'submitted', status: 'received', photos: [],
    urgency: 'urgent', created_at: new Date('2026-11-12T18:00:00Z'),
  };
  const values = [
    ['LN-EN', 'Shabab Ahmed', '+8801712345678', { technician: { id: technician._id, name: technician.name } }],
    ['LN-BN', 'শাবাব আহমেদ', '০১৮১২-৩৪৫৬৭৮'],
    ['LN-LOCAL', 'Shabab Legacy', '01712 345678', { request_type: 'battery' }],
    ['LN-LITERAL', 'Driver .* [Test]', '+8801912345678'],
    ['LN-OTHER', 'Another Driver', '+8801612345000'],
    ['LN-HIDDEN', 'Shabab Deleted', '+8801712345678', { state: 'deleted' }],
  ];
  await db.requests.insertMany(values.map(([public_code, customer_name, callback_phone, fields]) => ({
    ...base, ...fields, _id: randomUUID(), public_code, customer_name, callback_phone,
  })));
  async function find(search, fields = {}, browser = viewer) {
    const response = await browser.post('/admin/requests/search', { search, ...fields });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data.requests.map((row) => row.public_code).sort();
  }
  assert.deepEqual(await find('sHaBaB'), ['LN-EN', 'LN-LOCAL']);
  assert.deepEqual(await find('Shabab   Ahmed'), ['LN-EN']);
  assert.deepEqual(await find('শাবাব'), ['LN-BN']);
  assert.deepEqual(await find('.*'), ['LN-LITERAL']);
  assert.deepEqual(await find('[Test]'), ['LN-LITERAL']);
  assert.deepEqual(await find('01712-345678'), ['LN-EN', 'LN-LOCAL']);
  assert.deepEqual(await find('+880 (17) 1234-5678'), ['LN-EN', 'LN-LOCAL']);
  assert.deepEqual(await find('০১৭১২৩৪৫৬৭৮'), ['LN-EN', 'LN-LOCAL']);
  assert.deepEqual(await find('+8801812345678'), ['LN-BN']);
  assert.deepEqual(await find('12345'), ['LN-BN', 'LN-EN', 'LN-LITERAL', 'LN-LOCAL', 'LN-OTHER']);
  assert.deepEqual(await find('Shabab', {
    technician: technician._id, type: 'repair', urgency: 'urgent', status: 'received',
    from: '2026-11-13', to: '2026-11-13', code: 'ln-en',
  }, dispatcher), ['LN-EN']);
  assert.deepEqual(await find('Shabab', { technician: 'unassigned' }), ['LN-LOCAL']);
  assert.deepEqual(await find('Nobody'), []);
  for (const search of ['12', '12345678901234', 'a'.repeat(81), ['Shabab'], { $ne: null }, null]) {
    assert.equal((await owner.post('/admin/requests/search', { search })).status, 422);
  }
  assert.equal((await viewer.post('/admin/requests/search', [])).status, 422);
  assert.equal((await viewer.post('/admin/requests/search', { search: 'Shabab' }, { withoutCsrf: true })).status, 403);
  assert.equal((await customer.post('/admin/requests/search', { search: 'Shabab' })).status, 401);
  const safe = await viewer.post('/admin/requests/search', { search: 'Shabab' });
  assert.equal(safe.headers.get('cache-control'), 'no-store');
  assert.ok(safe.data.requests.every((row) => !Object.hasOwn(row, 'callback_phone')));
});

test('legacy assignment history starts on the next change and remains atomic with status and consented email updates', { timeout: 25000 }, async (t) => {
  const { db, owner, dispatcher, viewer, customer } = await fixture(t);
  const first = (await owner.post('/admin/technicians', { name: 'Current technician' })).data.technician;
  const second = (await owner.post('/admin/technicians', { name: 'Replacement technician' })).data.technician;
  const receipt = (await customer.post('/requests', {
    ...input, consent_status_email: true, notification_email: 'driver@example.test',
  }, { draft: randomUUID() })).data;
  let row = await db.requests.findOne({ public_code: receipt.code });
  const snapshot = { id: first._id, name: 'Earlier saved name' };
  await db.requests.updateOne({ _id: row._id }, { $set: { technician: snapshot } });
  assert.equal((await viewer.call('/admin/requests/' + row._id)).data.request.assignment_history, undefined);
  const save = (body) => dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, ...body } });
  assert.equal((await save({ technician_id: first._id, technician_notes: 'Already assigned' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.assignment_history, undefined);
  assert.equal((await save({ technician_id: first._id })).status, 422);
  assert.equal((await save({ technician_id: second._id, status: 'confirmed' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.assignment_history.length, 1);
  assert.deepEqual(row.assignment_history[0], {
    from: snapshot, to: { id: second._id, name: second.name }, actor: 'dispatcher', created_at: row.updated_at,
  });
  assert.equal(row.history.at(-1).status, 'confirmed');
  assert.equal(row.email_outbox.length, 1);
  assert.equal((await save({ version: row.version - 1, technician_id: null })).status, 409);
  assert.equal((await save({ technician_id: null, status: 'in_progress' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.assignment_history.length, 2);
  assert.equal(row.assignment_history[1].to, null);
  assert.equal(row.email_outbox.length, 2);
  assert.equal((await save({ technician_id: null, technician_notes: 'Still unassigned' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal((await save({ technician_id: '', status: 'in_progress' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.assignment_history.length, 2);
  assert.equal(row.email_outbox.length, 2);
  assert.equal((await save({ technician_id: { $ne: null } })).status, 422);
  const details = (await viewer.call('/admin/requests/' + row._id)).data.request;
  assert.equal(details.assignment_history.length, 2);
  const tracking = await customer.post('/requests/lookup', { code: receipt.code, token: receipt.tracking_token });
  assert.equal(tracking.data.assignment_history, undefined);
  assert.equal(tracking.data.technician, undefined);
});

test('consented status emails queue atomically, retry safely, keep ordering and support customer opt-out', { timeout: 25000 }, async (t) => {
  const { db, customer, owner, dispatcher, viewer } = await fixture(t);
  const draft = randomUUID();
  const body = { ...input, language: 'bn', consent_status_email: true, notification_email: 'driver@EXAMPLE.TEST' };
  const created = await customer.post('/requests', body, { draft });
  assert.equal(created.status, 201);
  assert.equal((await customer.post('/requests', body, { draft })).status, 200);
  let row = await db.requests.findOne({ public_code: created.data.code });
  assert.deepEqual(row.email_outbox, []);
  for (const status of ['confirmed', 'in_progress', 'completed']) {
    assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, status } })).status, 200);
    row = await db.requests.findOne({ _id: row._id });
  }
  assert.equal(row.email_outbox.length, 3);
  assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version - 1, status: 'cancelled' } })).status, 409);
  const safe = (await owner.call('/admin/requests/' + row._id)).data.request;
  assert.equal(safe.email_outbox[0].payload, undefined);
  assert.equal(row.email_outbox[0].payload.to[0], 'driver@example.test');
  assert.doesNotMatch(row.email_outbox[0].payload.text, new RegExp(created.data.tracking_token));
  let sends = 0;
  const good = async (url, request) => {
    sends++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(request.headers.Authorization, 'Bearer ' + email.key);
    assert.equal(request.headers['Idempotency-Key'], row.email_outbox[0].id);
    assert.deepEqual(JSON.parse(request.body), row.email_outbox[0].payload);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return Response.json({ id: 'synthetic-provider-id' });
  };
  const concurrent = await Promise.all([processEmailJob(db, { email, fetcher: good }), processEmailJob(db, { email, fetcher: good })]);
  assert.deepEqual(concurrent.sort(), [false, true]);
  assert.equal(sends, 1);
  let retryKey, retryBody;
  await processEmailJob(db, { email, fetcher: async (url, request) => {
    retryKey = request.headers['Idempotency-Key'];
    retryBody = request.body;
    return Response.json({ error: email.key }, { status: 429, headers: { 'Retry-After': '120' } });
  } });
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.email_outbox[0].state, 'accepted');
  assert.equal(row.email_outbox[1].state, 'pending');
  assert.equal(row.email_outbox[1].last_error, 'email_http_429');
  assert.equal(await processEmailJob(db, { email, fetcher: async () => { throw new Error('Later statuses must wait'); } }), false);
  await processEmailJob(db, { email, now: row.email_outbox[1].next_attempt_at, fetcher: async (url, request) => {
    assert.equal(request.headers['Idempotency-Key'], retryKey);
    assert.equal(request.body, retryBody);
    return Response.json({ id: 'synthetic-retry-id' });
  } });
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.email_outbox[1].state, 'accepted');
  assert.equal((await viewer.post('/admin/requests/' + row._id + '/emails/' + row.email_outbox[2].id + '/retry')).status, 403);
  const keys = { code: created.data.code, token: created.data.tracking_token };
  assert.equal((await customer.post('/requests/privacy', { ...keys, token: 'wrong', action: 'stop_email' })).status, 404);
  assert.equal((await customer.post('/requests/privacy', { ...keys, action: 'stop_email' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.consent_status_email, false);
  assert.equal(row.email_outbox[2].state, 'cancelled');
  assert.equal((await customer.post('/requests/lookup', keys)).data.emailUpdates, false);
  assert.equal(await processEmailJob(db, { email, fetcher: async () => { throw new Error('Opted out'); } }), false);
  assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, status: 'confirmed' } })).status, 200);
  assert.equal((await db.requests.findOne({ _id: row._id })).email_outbox.length, 3);
});

test('email leases recover, permanent failures are visible, and deleting prevents queue resurrection', { timeout: 25000 }, async (t) => {
  const { db, dispatcher, owner } = await fixture(t);
  const now = new Date();
  const makeRow = (code) => {
    const row = { _id: randomUUID(), public_code: code, state: 'submitted', consent_status_email: true, notification_email: 'driver@example.test', language: 'en', created_at: now };
    row.email_outbox = [statusEmail(row, 'confirmed', email, now)];
    return row;
  };
  const row = makeRow('LN-LEASE1');
  row.notification_lock_until = new Date(now.getTime() - 1);
  row.notification_lock_token = 'old-claim';
  Object.assign(row.email_outbox[0], { state: 'sending', attempts: 1, claim_until: new Date(now.getTime() - 1), claim_token: 'old-claim' });
  await db.requests.insertOne(row);
  await processEmailJob(db, { email, now, fetcher: async (url, request) => {
    assert.equal(request.headers['Idempotency-Key'], row.email_outbox[0].id);
    return Response.json({ id: 'recovered-id' });
  } });
  assert.equal((await db.requests.findOne({ _id: row._id })).email_outbox[0].state, 'accepted');
  const failed = makeRow('LN-FAIL01');
  await db.requests.insertOne(failed);
  await processEmailJob(db, { email, now, fetcher: async () => Response.json({ error: email.key }, { status: 401 }) });
  assert.equal((await db.requests.findOne({ _id: failed._id })).email_outbox[0].state, 'failed');
  assert.equal((await dispatcher.post('/admin/requests/' + failed._id + '/emails/' + failed.email_outbox[0].id + '/retry')).status, 200);
  const retried = await db.requests.findOne({ _id: failed._id });
  await processEmailJob(db, { email, now: retried.email_outbox[0].next_attempt_at, fetcher: async () => Response.json({ id: 'fixed-key-id' }) });
  assert.equal((await db.requests.findOne({ _id: failed._id })).email_outbox[0].state, 'accepted');
  const expired = makeRow('LN-EXPIRE');
  expired.email_outbox[0].expires_at = new Date(now.getTime() - 1);
  await db.requests.insertOne(expired);
  await processEmailJob(db, { email, now, fetcher: async () => { throw new Error('Expired job must not send'); } });
  assert.equal((await db.requests.findOne({ _id: expired._id })).email_outbox[0].state, 'failed');
  assert.equal((await owner.post('/admin/requests/' + expired._id + '/emails/' + expired.email_outbox[0].id + '/retry')).status, 409);
  const removed = makeRow('LN-REMOVE');
  await db.requests.insertOne(removed);
  await processEmailJob(db, { email, now, fetcher: async () => {
    await deleteRequest(db, removed._id);
    return Response.json({ id: 'in-flight-id' });
  } });
  const marker = await db.requests.findOne({ _id: removed._id });
  assert.equal(marker.state, 'deleted');
  assert.equal(marker.email_outbox, undefined);
  const network = makeRow('LN-NET001');
  await db.requests.insertOne(network);
  let attempts = 0;
  for (let index = 0; index < 4; index++) {
    const current = await db.requests.findOne({ _id: network._id });
    await processEmailJob(db, { email, now: current.email_outbox[0].next_attempt_at, fetcher: async () => {
      attempts++;
      throw new Error('synthetic-private-key');
    } });
  }
  const stopped = await db.requests.findOne({ _id: network._id });
  assert.equal(attempts, 4);
  assert.equal(stopped.email_outbox[0].state, 'failed');
  assert.equal(stopped.email_outbox[0].last_error, 'email_network_error');
  assert.equal(await processEmailJob(db, { email, fetcher: async () => { throw new Error('Attempts exhausted'); } }), false);
});

test('owner reports and CSV use inclusive Dhaka dates and expose grouped counts', { timeout: 25000 }, async (t) => {
  const { db, customer, owner, dispatcher, viewer } = await fixture(t);
  const base = { state: 'submitted', request_type: 'repair', status: 'received', photos: [] };
  const data = [
    ['LN-BEFORE', '2026-11-09T17:59:59.999Z'],
    ['LN-START1', '2026-11-09T18:00:00.000Z'],
    ['LN-BAT001', '2026-11-10T00:00:00.000Z', { request_type: 'battery', status: 'confirmed' }],
    ['LN-BAT002', '2026-11-10T01:00:00.000Z', { request_type: 'battery', status: 'confirmed' }],
    ['LN-END001', '2026-11-10T17:59:59.999Z', { status: 'completed' }],
    ['LN-AFTER1', '2026-11-10T18:00:00.000Z'],
    ['LN-DRAFT1', '2026-11-10T00:00:00.000Z', { state: 'draft' }],
  ];
  await db.requests.insertMany(data.map(([public_code, created, fields]) => ({ ...base, ...fields, public_code, created_at: new Date(created) })));
  const query = '?from=2026-11-10&to=2026-11-10';
  assert.equal((await customer.call('/admin/reports' + query)).status, 401);
  assert.equal((await viewer.call('/admin/reports' + query)).status, 403);
  assert.equal((await dispatcher.call('/admin/reports.csv' + query)).status, 403);
  const report = await owner.call('/admin/reports' + query);
  assert.equal(report.status, 200);
  assert.equal(report.data.total, 4);
  assert.equal(report.data.rows.length, 3);
  assert.equal(report.data.rows.reduce((total, row) => total + row.count, 0), 4);
  assert.equal((await owner.call('/admin/reports' + query + '&type=repair')).data.total, 2);
  assert.equal((await owner.call('/admin/reports' + query + '&status=confirmed')).data.total, 2);
  const csv = await owner.call('/admin/reports.csv' + query);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.equal(csv.data.trim().split('\r\n').length, 4);
  assert.doesNotMatch(csv.data, /callback_phone|tracking_token|notification_email/);
  for (const bad of ['', '?from=2026-02-30&to=2026-03-01', '?from=2026-11-11&to=2026-11-10', '?from=2024-01-01&to=2026-11-10']) {
    assert.equal((await owner.call('/admin/reports' + bad)).status, 422);
  }
});

test('technician workload counts current open assignments, includes zero and inactive technicians, and follows versioned changes', { timeout: 25000 }, async (t) => {
  const { db, customer, owner, dispatcher, viewer } = await fixture(t);
  assert.equal((await customer.call('/admin/technician-workload')).status, 401);
  const empty = await viewer.call('/admin/technician-workload');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.technicians, []);
  assert.deepEqual(empty.data.unassigned, { waiting: 0, inProgress: 0, total: 0 });
  const first = (await owner.post('/admin/technicians', { name: 'Workload technician', phone: '01700000000' })).data.technician;
  const idle = (await owner.post('/admin/technicians', { name: 'No assigned work' })).data.technician;
  const inactive = (await owner.post('/admin/technicians', { name: 'Inactive technician', active: false })).data.technician;
  const unavailable = randomUUID();
  const base = {
    ...validateRequest(input).value, state: 'submitted', photos: [], history: [], version: 1,
    technician: { id: first._id, name: first.name }, created_at: new Date(),
  };
  const rows = ['received', 'confirmed', 'in_progress', 'completed', 'cancelled', 'out_of_area'].map((status, index) => ({
    ...base, _id: randomUUID(), public_code: 'LN-WORK' + index, status,
  }));
  rows.push(
    { ...base, _id: randomUUID(), public_code: 'LN-INACTIVE', status: 'in_progress', technician: { id: inactive._id, name: inactive.name } },
    { ...base, _id: randomUUID(), public_code: 'LN-NULL', status: 'confirmed', technician: null },
    { ...base, _id: randomUUID(), public_code: 'LN-PROGRESS', status: 'in_progress', technician: { id: '' } },
    { ...base, _id: randomUUID(), public_code: 'LN-UNAVAILABLE', status: 'received', technician: { id: unavailable, name: 'Saved technician name' } },
    { ...base, _id: randomUUID(), public_code: 'LN-DELETED', status: 'received', state: 'deleted' },
    { ...base, _id: randomUUID(), public_code: 'LN-DRAFT', status: 'in_progress', state: 'draft' },
  );
  const legacy = { ...base, _id: randomUUID(), public_code: 'LN-LEGACY', status: 'received' };
  delete legacy.technician;
  rows.push(legacy);
  await db.requests.insertMany(rows);
  const response = await dispatcher.call('/admin/technician-workload');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const workload = response.data;
  assert.deepEqual(workload.totals, { waiting: 5, inProgress: 3, total: 8 });
  assert.deepEqual(workload.unassigned, { waiting: 2, inProgress: 1, total: 3 });
  const byId = Object.fromEntries(workload.technicians.map((row) => [row.id, row]));
  assert.deepEqual([byId[first._id].waiting, byId[first._id].inProgress, byId[first._id].total], [2, 1, 3]);
  assert.equal(byId[idle._id].total, 0);
  assert.equal(byId[inactive._id].active, false);
  assert.equal(byId[inactive._id].total, 1);
  assert.equal(byId[unavailable].name, 'Saved technician name');
  assert.equal(byId[unavailable].active, null);
  assert.equal(byId[unavailable].total, 1);
  assert.ok(Number.isFinite(Date.parse(workload.generatedAt)));
  assert.ok(workload.technicians.every((row) => !Object.hasOwn(row, 'phone')));
  assert.equal(workload.technicians.reduce((sum, row) => sum + row.total, workload.unassigned.total), workload.totals.total);
  assert.equal((await dispatcher.call('/admin/requests/' + rows[0]._id, {
    method: 'PATCH', body: { version: 1, technician_id: inactive._id },
  })).status, 422);
  assert.equal((await dispatcher.call('/admin/requests/' + rows[0]._id, {
    method: 'PATCH', body: { version: 1, technician_id: idle._id, status: 'in_progress' },
  })).status, 200);
  const changed = (await viewer.call('/admin/technician-workload')).data;
  assert.deepEqual(changed.totals, { waiting: 4, inProgress: 4, total: 8 });
  assert.equal(changed.technicians.find((row) => row.id === first._id).total, 2);
  assert.equal(changed.technicians.find((row) => row.id === idle._id).inProgress, 1);
  assert.equal((await owner.call('/admin/requests/' + rows[0]._id, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await owner.call('/admin/technician-workload')).data.totals, { waiting: 4, inProgress: 3, total: 7 });
});

test('queue sorting preserves default order, prioritizes urgency with stable pagination, combines filters and validates both request methods', { timeout: 25000 }, async (t) => {
  const { db, owner, dispatcher, viewer } = await fixture(t);
  const technician = (await owner.post('/admin/technicians', { name: 'Sorting technician' })).data.technician;
  const now = new Date('2026-11-13T00:00:00Z');
  const base = {
    ...validateRequest(input).value, customer_name: 'Sort Driver', state: 'submitted',
    status: 'received', photos: [], created_at: now, urgency: 'urgent',
    technician: { id: technician._id, name: technician.name },
  };
  const urgentCodes = Array.from({ length: 24 }, (_, index) => 'LN-SORTU' + String(index).padStart(2, '0'));
  await db.requests.insertMany(urgentCodes.map((public_code, index) => ({
    ...base, _id: 'sort-u' + String(index).padStart(2, '0'), public_code,
  })).concat([
    { ...base, _id: 'sort-n0', public_code: 'LN-OLDNORMAL', urgency: 'normal', created_at: new Date(now.getTime() - 1000) },
    { ...base, _id: 'sort-n1', public_code: 'LN-NEWNORMAL', urgency: 'normal', created_at: new Date(now.getTime() + 1000) },
    { ...base, _id: 'sort-n2', public_code: 'LN-NEWEST', urgency: 'normal', created_at: new Date(now.getTime() + 2000) },
    { ...base, _id: 'sort-other', public_code: 'LN-OTHER', customer_name: 'Other Driver', request_type: 'battery', status: 'completed' },
    { ...base, _id: 'sort-deleted', public_code: 'LN-DELETED', state: 'deleted' },
  ]));
  const filters = { type: 'repair', status: 'received', technician: technician._id, from: '2026-11-13', to: '2026-11-13' };
  const query = '/admin/requests?' + new URLSearchParams(filters);
  const defaultView = await viewer.call(query);
  assert.equal(defaultView.status, 200);
  assert.equal(defaultView.data.sort, 'newest');
  assert.deepEqual(defaultView.data.requests.map((row) => row.public_code), ['LN-NEWEST', 'LN-NEWNORMAL', ...urgentCodes.slice(6).reverse()]);
  assert.deepEqual((await viewer.call(query + '&sort=newest')).data.requests, defaultView.data.requests);
  const oldest = await dispatcher.call(query + '&sort=oldest');
  assert.deepEqual(oldest.data.requests.map((row) => row.public_code), ['LN-OLDNORMAL', ...urgentCodes.slice(0, 19)]);
  const urgent = await owner.call(query + '&sort=urgent');
  assert.deepEqual(urgent.data.requests.map((row) => row.public_code), urgentCodes.slice(0, 20));
  assert.equal(urgent.data.hasNext, true);
  const second = await viewer.call(query + '&sort=urgent&page=2');
  assert.deepEqual(second.data.requests.map((row) => row.public_code), [...urgentCodes.slice(20), 'LN-OLDNORMAL', 'LN-NEWNORMAL', 'LN-NEWEST']);
  assert.equal(second.data.hasNext, false);
  assert.equal(new Set([...urgent.data.requests, ...second.data.requests].map((row) => row._id)).size, 27);
  const searched = await dispatcher.post('/admin/requests/search', { ...filters, search: 'sort driver', sort: 'urgent', page: 2 });
  assert.deepEqual(searched.data.requests, second.data.requests);
  const exact = await viewer.call(query + '&sort=urgent&code=ln-sortu23&urgency=urgent');
  assert.deepEqual(exact.data.requests.map((row) => row.public_code), ['LN-SORTU23']);
  assert.ok(urgent.data.requests.every((row) => row.urgency === 'urgent' && !Object.hasOwn(row, 'queue_priority')));
  assert.equal((await viewer.call(query + '&sort=urgent&sort=oldest')).status, 422);
  for (const sort of ['descending', ['urgent'], { $ne: null }, null, 1]) {
    assert.equal((await owner.post('/admin/requests/search', { ...filters, search: 'Sort Driver', sort })).status, 422);
  }
});

test('owners provision and suspend technician logins without changing existing staff credentials', { timeout: 30000 }, async (t) => {
  const { db, owner, dispatcher, viewer, customer, base } = await fixture(t);
  const original = await db.adminUsers.findOne({ _id: 'owner' });
  const a = (await owner.post('/admin/technicians', { name: 'Login technician' })).data.technician;
  const b = (await owner.post('/admin/technicians', { name: 'Other login technician' })).data.technician;
  const endpoint = '/admin/technicians/' + a._id + '/account';
  const body = { username: 'tech-login', password: 'SyntheticTech1234' };
  assert.equal((await owner.call(endpoint)).data.account, null);
  assert.equal((await viewer.post(endpoint, body)).status, 403);
  assert.equal((await dispatcher.post(endpoint, body)).status, 403);
  assert.equal((await customer.post(endpoint, body)).status, 401);
  assert.equal((await owner.post(endpoint, { ...body, password: 'short' })).status, 422);
  assert.equal((await owner.post(endpoint, { ...body, role: 'owner' })).status, 422);
  assert.equal((await owner.post(endpoint, body, { withoutCsrf: true })).status, 403);
  assert.equal((await owner.post(endpoint, body)).status, 201);
  assert.deepEqual((await owner.call(endpoint)).data.account, { username: body.username, enabled: true, version: 1 });
  assert.equal((await owner.post(endpoint, { ...body, username: 'tech-duplicate' })).status, 409);
  assert.equal((await owner.post('/admin/technicians/' + b._id + '/account', { ...body, username: 'owner' })).status, 409);
  const stored = await db.adminUsers.findOne({ _id: body.username });
  assert.notEqual(stored.passwordHash, body.password);
  assert.equal(await bcrypt.compare(body.password, stored.passwordHash), true);
  const tech = client(base);
  await tech.call('/bootstrap');
  assert.equal((await tech.post('/admin/login', body)).status, 200);
  assert.equal((await tech.call('/admin/me')).data.user.role, 'technician');
  for (const path of ['/admin/requests', '/admin/queue-updates', '/admin/config', '/admin/audit', '/admin/reports', '/admin/technician-workload', endpoint]) {
    assert.equal((await tech.call(path)).status, 403, path);
  }
  assert.equal((await owner.call('/admin/technicians/' + a._id, { method: 'PATCH', body: { ...a, active: false, version: 1 } })).status, 200);
  assert.equal((await tech.call('/admin/me')).status, 200, 'Availability and sign-in permission are separate');
  assert.equal((await owner.call(endpoint, { method: 'PATCH', body: { version: 1, enabled: false } })).status, 200);
  assert.equal((await tech.call('/admin/me')).status, 401);
  assert.equal((await tech.post('/admin/login', body)).status, 401);
  assert.equal((await owner.call(endpoint, { method: 'PATCH', body: { version: 1, enabled: true } })).status, 409);
  const newPassword = 'ReplacementTech1234';
  assert.equal((await owner.call(endpoint, { method: 'PATCH', body: { version: 2, enabled: true, password: newPassword } })).status, 200);
  assert.equal((await tech.post('/admin/login', body)).status, 401);
  assert.equal((await tech.post('/admin/login', { username: body.username, password: newPassword })).status, 200);
  assert.deepEqual(await db.adminUsers.findOne({ _id: 'owner' }), original);
});

test('technicians access only their own jobs and photos, and versioned work updates retain email and tracking behavior', { timeout: 30000 }, async (t) => {
  const { db, owner, dispatcher, customer, viewer, base } = await fixture(t);
  const a = (await owner.post('/admin/technicians', { name: 'Own jobs A' })).data.technician;
  const b = (await owner.post('/admin/technicians', { name: 'Own jobs B' })).data.technician;
  const password = 'SyntheticTech1234';
  const passwordHash = await bcrypt.hash(password, 4);
  await db.adminUsers.insertMany([['tech-a', a], ['tech-b', b]].map(([username, tech]) => ({
    _id: username, role: 'technician', technician_id: tech._id, enabled: true, passwordHash, authVersion: 1, failedLogins: 0, lockedUntil: null,
  })));
  const techA = client(base), techB = client(base);
  for (const [username, browser] of [['tech-a', techA], ['tech-b', techB]]) {
    await browser.call('/bootstrap');
    assert.equal((await browser.post('/admin/login', { username, password })).status, 200);
  }
  const receipt = (await customer.post('/requests', { ...input, consent_status_email: true, notification_email: 'driver@example.test' }, { draft: randomUUID() })).data;
  let row = await db.requests.findOne({ public_code: receipt.code });
  const photoId = randomUUID(), otherPhotoId = randomUUID();
  await db.requests.updateOne({ _id: row._id }, { $set: { technician: { id: a._id, name: a.name }, photos: [{ upload_id: photoId, label: 'vehicle', content: Buffer.from('synthetic-photo') }] } });
  const other = { ...row, _id: randomUUID(), public_code: 'LN-OTHERJOB', technician: { id: b._id, name: b.name }, photos: [{ upload_id: otherPhotoId, label: 'vehicle', content: Buffer.from('other-photo') }] };
  await db.requests.insertOne(other);
  assert.deepEqual((await techA.call('/admin/technician/requests?technician=' + b._id)).data.requests.map((item) => item._id), [row._id]);
  assert.equal((await techA.call('/admin/technician/requests/' + other._id)).status, 404);
  assert.equal((await techA.call('/admin/technician/requests/' + other._id, { method: 'PATCH', body: { version: 1, status: 'in_progress' } })).status, 404);
  assert.equal((await viewer.call('/admin/technician/requests')).status, 403);
  const safe = (await techA.call('/admin/technician/requests/' + row._id)).data.request;
  for (const field of ['tracking_token_hash', 'fingerprint', 'notification_email', 'email_outbox', 'assignment_history', 'final_bill_note']) assert.equal(safe[field], undefined, field);
  assert.equal(safe.photos[0].content, undefined);
  assert.equal((await techA.call('/admin/technician/photos/' + photoId)).status, 200);
  assert.equal((await techA.call('/admin/technician/photos/' + otherPhotoId)).status, 404);
  assert.equal((await techA.call('/admin/photos/' + photoId)).status, 403);
  const endpoint = '/admin/technician/requests/' + row._id;
  for (const change of [{ status: 'completed' }, { technician_id: b._id }, { final_bill_note: 'Not allowed' }, { customer_name: 'Not allowed' }]) {
    assert.equal((await techA.call(endpoint, { method: 'PATCH', body: { version: row.version, ...change } })).status, 422);
  }
  const eta = new Date(Date.now() + 40 * 60000).toISOString();
  assert.equal((await techA.call(endpoint, { method: 'PATCH', body: { version: row.version, arrival_eta: eta, technician_notes: 'Inspection planned' } })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  const keys = { code: receipt.code, token: receipt.tracking_token };
  assert.equal((await customer.post('/requests/lookup', keys)).data.arrival_eta, eta);
  const concurrent = await Promise.all([0, 1].map(() => techA.call(endpoint, { method: 'PATCH', body: { version: row.version, status: 'in_progress' } })));
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.history.at(-1).actor, 'tech-a');
  assert.equal(row.email_outbox.length, 1);
  assert.equal((await techA.call(endpoint, { method: 'PATCH', body: { version: row.version, status: 'completed' } })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.arrival_eta, null);
  assert.equal(row.email_outbox.length, 2);
  assert.equal((await customer.post('/requests/lookup', keys)).data.arrival_eta, null);
  assert.equal((await techA.call(endpoint, { method: 'PATCH', body: { version: row.version, technician_notes: 'Closed edit' } })).status, 409);
  const reassigned = { ...row, _id: randomUUID(), public_code: 'LN-REASSIGN', version: 1, status: 'confirmed', arrival_eta: new Date(eta), email_outbox: [] };
  await db.requests.insertOne(reassigned);
  assert.equal((await dispatcher.call('/admin/requests/' + reassigned._id, { method: 'PATCH', body: { version: 1, technician_id: b._id } })).status, 200);
  assert.equal((await techA.call('/admin/technician/requests/' + reassigned._id)).status, 404);
  assert.equal((await techA.call('/admin/technician/requests/' + reassigned._id, { method: 'PATCH', body: { version: 1, status: 'in_progress' } })).status, 404);
  assert.equal((await techB.call('/admin/technician/requests/' + reassigned._id)).status, 200);
  assert.equal((await db.requests.findOne({ _id: reassigned._id })).arrival_eta, null);
});

test('staff arrival estimates validate time and assignment, remain private and clear on reassignment or closing', { timeout: 25000 }, async (t) => {
  const { db, customer, owner, dispatcher, viewer } = await fixture(t);
  const a = (await owner.post('/admin/technicians', { name: 'ETA technician A' })).data.technician;
  const b = (await owner.post('/admin/technicians', { name: 'ETA technician B' })).data.technician;
  const receipt = (await customer.post('/requests', input, { draft: randomUUID() })).data;
  let row = await db.requests.findOne({ public_code: receipt.code });
  const endpoint = '/admin/requests/' + row._id;
  const save = (fields, browser = dispatcher) => browser.call(endpoint, { method: 'PATCH', body: { version: row.version, ...fields } });
  const eta = new Date(Date.now() + 30 * 60000).toISOString();
  assert.equal((await save({ arrival_eta: eta })).status, 422);
  assert.equal((await save({ technician_id: a._id, status: 'confirmed', arrival_eta: eta })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal((await save({ arrival_eta: null }, viewer)).status, 403);
  for (const value of [false, {}, [], 'not-a-date', '2026-02-30T10:00:00Z', '2026-11-14T10:00:00+06:00', new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() + 49 * 3600000).toISOString()]) {
    assert.equal((await save({ arrival_eta: value })).status, 422, String(value));
  }
  assert.equal((await customer.post('/requests/lookup', { code: receipt.code, token: 'incorrect' })).status, 404);
  assert.equal((await customer.post('/requests/lookup', { code: receipt.code, token: receipt.tracking_token })).data.arrival_eta, eta);
  const passed = new Date(Date.now() - 3600000);
  await db.requests.updateOne({ _id: row._id }, { $set: { arrival_eta: passed } });
  assert.equal((await save({ arrival_eta: passed.toISOString(), technician_notes: 'Keep existing estimate while reviewing' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal((await save({ technician_id: b._id, arrival_eta: eta })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.arrival_eta.toISOString(), eta);
  assert.equal((await save({ technician_id: a._id })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.arrival_eta, null);
  assert.equal((await save({ arrival_eta: eta })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal((await save({ status: 'completed', arrival_eta: eta })).status, 422);
  assert.equal((await save({ status: 'cancelled' })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  assert.equal(row.arrival_eta, null);
  assert.equal(row.email_outbox, undefined);
});

test('delivery checks are staff-only, read provider status safely, rate-limit duplicates and preserve request versions', { timeout: 25000 }, async (t) => {
  const providerId = randomUUID();
  let calls = 0, event = 'delivered';
  const { db, owner, dispatcher, viewer, customer } = await fixture(t, { deliveryFetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails/' + providerId);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer ' + email.key);
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return Response.json({ id: providerId, last_event: event, html: 'private-provider-content', to: ['driver@example.test'] });
  } });
  const receipt = (await customer.post('/requests', { ...input, consent_status_email: true, notification_email: 'driver@example.test' }, { draft: randomUUID() })).data;
  let row = await db.requests.findOne({ public_code: receipt.code });
  assert.equal((await dispatcher.call('/admin/requests/' + row._id, { method: 'PATCH', body: { version: row.version, status: 'confirmed' } })).status, 200);
  row = await db.requests.findOne({ _id: row._id });
  const job = row.email_outbox[0];
  const endpoint = '/admin/requests/' + row._id + '/emails/' + job.id + '/delivery';
  assert.equal((await owner.post(endpoint, {})).status, 409);
  assert.equal(calls, 0);
  await processEmailJob(db, { email, fetcher: async () => Response.json({ id: providerId }) });
  assert.equal((await viewer.post(endpoint, {})).status, 403);
  assert.equal((await customer.post(endpoint, {})).status, 401);
  assert.equal((await owner.post(endpoint, {}, { withoutCsrf: true })).status, 403);
  const checked = await owner.post(endpoint, {});
  assert.equal(checked.status, 200);
  assert.equal(checked.data.delivery.event, 'delivered');
  assert.equal(calls, 1);
  assert.equal((await dispatcher.post(endpoint, {})).status, 429);
  assert.equal(calls, 1);
  let saved = await db.requests.findOne({ _id: row._id });
  assert.equal(saved.version, row.version);
  assert.equal(saved.email_outbox[0].state, 'accepted');
  assert.doesNotMatch(JSON.stringify(saved), /private-provider-content/);
  assert.doesNotMatch(JSON.stringify(checked.data), /synthetic-email-key|driver@example/);
  await db.requests.updateOne({ _id: row._id }, { $unset: { 'email_outbox.0.delivery_next_check_at': '' } });
  event = 'bounced';
  const concurrent = await Promise.all([owner.post(endpoint, {}), dispatcher.post(endpoint, {})]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 429]);
  assert.equal(calls, 2);
  saved = (await viewer.call('/admin/requests/' + row._id)).data.request;
  assert.equal(saved.email_outbox[0].delivery.event, 'bounced');
  assert.equal(saved.email_outbox[0].payload, undefined);
});

test('provider lookup failures keep the last confirmed delivery and deleting during a lookup cannot restore data', { timeout: 25000 }, async (t) => {
  const { db } = await fixture(t);
  const providerId = randomUUID(), jobId = randomUUID(), requestId = randomUUID();
  const start = Date.now();
  await db.requests.insertOne({ _id: requestId, public_code: 'LN-DELIVERY', state: 'submitted', version: 5, email_outbox: [{
    id: jobId, state: 'accepted', provider_id: providerId, delivery: { event: 'delivered', checked_at: new Date(start - 1000) },
  }] });
  const cases = [
    [async () => Response.json({ secret: email.key }, { status: 403 }), 'email_delivery_http_403'],
    [async () => Response.json({}, { status: 429 }), 'email_delivery_http_429'],
    [async () => Response.json({ id: 'wrong-id', last_event: 'delivered' }), 'email_delivery_invalid_response'],
    [async () => Response.json({ id: providerId, last_event: 'not-supported' }), 'email_delivery_invalid_response'],
    [async () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), 'email_delivery_invalid_response'],
    [async () => { throw new Error(email.key); }, 'email_delivery_network'],
    [async () => { const e = new Error(email.key); e.name = 'TimeoutError'; throw e; }, 'email_delivery_timeout'],
  ];
  for (const [index, [fetcher, code]] of cases.entries()) {
    await assert.rejects(checkEmailDelivery(db, requestId, jobId, { email, fetcher, now: new Date(start + index * 31000) }), (error) => error.code === code && !error.message.includes(email.key));
    const row = await db.requests.findOne({ _id: requestId });
    assert.equal(row.email_outbox[0].delivery.event, 'delivered');
    assert.equal(row.email_outbox[0].delivery_error, code);
    assert.equal(row.version, 5);
  }
  await assert.rejects(checkEmailDelivery(db, requestId, jobId, { email, now: new Date(start + 7 * 31000), fetcher: async () => {
    await deleteRequest(db, requestId);
    return Response.json({ id: providerId, last_event: 'delivered' });
  } }), (error) => error.code === 'conflict');
  const deleted = await db.requests.findOne({ _id: requestId });
  assert.equal(deleted.state, 'deleted');
  assert.equal(deleted.email_outbox, undefined);
});
