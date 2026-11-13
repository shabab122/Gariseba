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

async function fixture(t) {
  const db = await connectDatabase({ dbName: 'gariseba_operations_' + randomUUID().replaceAll('-', ''), uri: process.env.MONGODB_TEST_URI || undefined });
  await ensureDefaults(db);
  const password = 'SyntheticTestOnly123';
  const passwordHash = await bcrypt.hash(password, 4);
  await db.adminUsers.insertMany(['owner', 'dispatcher', 'viewer'].map((role) => ({
    _id: role, role, passwordHash, authVersion: 1, failedLogins: 0, lockedUntil: null,
  })));
  const server = createApp(db, { email }).listen(0, '127.0.0.1');
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
  return { db, customer, owner, dispatcher, viewer };
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
