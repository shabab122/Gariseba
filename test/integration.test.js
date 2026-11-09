'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/server');
const { connectDatabase, ensureDefaults } = require('../src/db');
const { sha256 } = require('../src/lib/security');
const { findTracked } = require('../src/lib/requests');
const { samplePricing } = require('../src/defaults');
const { importSqlite } = require('../scripts/import-sqlite');

const password = 'SyntheticTestOnly123';
const input = {
  request_type: 'repair', customer_name: 'Test Driver', callback_phone: '01700000000',
  location_text: 'Mirpur 10, Dhaka', vehicle_make: 'Toyota', vehicle_model: 'Axio',
  symptoms: 'The front tyre is flat', consent_store: true,
};

async function testDatabase(t) {
  const dbName = 'gariseba_test_' + randomUUID().replaceAll('-', '');
  const db = await connectDatabase({ dbName, uri: process.env.MONGODB_TEST_URI || undefined });
  t.after(async () => {
    try { await db.db.dropDatabase(); } finally { await db.client.close(); }
  });
  return db;
}
function client(base) {
  let cookie, csrf;
  async function call(url, { method = 'GET', body, draft, photoKey, noCsrf, multipart } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (csrf && !noCsrf) headers['X-CSRF-Token'] = csrf;
    if (draft) headers['X-Draft-Key'] = draft;
    if (photoKey) headers['X-Photo-Key'] = photoKey;
    if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + url, { method, headers, body: multipart || JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    if (data.csrf) csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  }
  return { call, ready: () => call('/bootstrap'), post: (url, body, extra) => call(url, { method: 'POST', body, ...extra }) };
}
async function jpeg() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: '#526d2b' } }).jpeg().toBuffer();
}
function multipart(content, name = 'dashboard.jpg') {
  const form = new FormData();
  form.append('photo', new Blob([content], { type: 'image/jpeg' }), name);
  form.append('label', 'dashboard');
  return form;
}

test('customer and staff workflows on a real MongoDB', { timeout: 45000 }, async (t) => {
  const db = await testDatabase(t);
  await ensureDefaults(db);
  await db.pricing.insertMany(samplePricing);
  const hash = await bcrypt.hash(password, 4);
  await db.adminUsers.insertMany(['owner', 'viewer', 'dispatcher', 'locktest'].map((role) => ({
    _id: role, role: role === 'locktest' ? 'viewer' : role, authVersion: 1, passwordHash: hash, failedLogins: 0, lockedUntil: null,
  })));
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const customer = client(base), other = client(base), owner = client(base), viewer = client(base), dispatcher = client(base), locked = client(base);
  const draft = randomUUID();
  const image = await jpeg();
  let photo, receipt, recordId, version;

  await t.test('health, session cookie and CSRF', async () => {
    assert.deepEqual((await customer.call('/health')).data, { ok: true });
    assert.equal((await customer.post('/location/check', input)).status, 403);
    const boot = await customer.ready();
    assert.equal(boot.status, 200);
    assert.equal(boot.data.batteryStartBdt, 500);
    assert.match(boot.headers.get('set-cookie'), /HttpOnly/);
    assert.match(boot.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal(boot.headers.get('cache-control'), 'no-store');
    assert.ok(boot.headers.get('content-security-policy'));
  });
  await t.test('Dhaka check rejects outside locations, asks confirmation for unknown addresses', async () => {
    assert.equal((await customer.post('/location/check', { location_text: 'সিলেট' })).data.status, 'outside');
    assert.equal((await customer.post('/location/check', input)).data.status, 'inside');
    assert.equal((await customer.post('/requests', { ...input, location_text: 'Sylhet', confirm_dhaka: true }, { draft })).data.error, 'outside_area');
    assert.equal((await customer.post('/requests', { ...input, location_text: 'A test landmark' }, { draft })).data.error, 'confirm_area');
    assert.equal((await customer.post('/requests', { ...input, consent_store: false }, { draft })).data.error, 'validation');
  });
  await t.test('assistant gives tentative guidance, sample estimates and local emergency advice', async () => {
    const normal = (await customer.post('/chat/analyze', { symptoms: 'Flat tyre', language: 'en' })).data;
    assert.equal(normal.analysis.source, 'fallback');
    assert.equal(normal.estimate.sample, true);
    const safety = (await customer.post('/chat/analyze', { symptoms: 'ইঞ্জিন থেকে ধোঁয়া', language: 'bn' })).data;
    assert.equal(safety.analysis.safety, true);
    assert.match(safety.analysis.next_step, /৯৯৯/);
    assert.equal(safety.estimate, null);
  });
  await t.test('photos are validated, idempotent, removable and isolated by session and draft', async () => {
    const key = randomUUID();
    const upload = (who, content, photoKey, draftKey) => who.call('/photos', { method: 'POST', draft: draftKey, photoKey, multipart: multipart(content) });
    assert.equal((await upload(customer, Buffer.from('not JPEG'), randomUUID(), draft)).status, 415);
    const [first, replay] = await Promise.all([upload(customer, image, key, draft), upload(customer, image, key, draft)]);
    assert.deepEqual([first.status, replay.status].sort(), [200, 201]);
    photo = first.data.upload_id;
    assert.equal(replay.data.upload_id, photo);
    const second = await upload(customer, image, randomUUID(), draft);
    await other.ready();
    assert.equal((await other.call('/photos/' + photo, { method: 'DELETE', draft })).status, 404);
    assert.equal((await customer.call('/photos/' + photo, { method: 'DELETE', draft: randomUUID() })).status, 404);
    assert.equal((await customer.call('/photos/' + second.data.upload_id, { method: 'DELETE', draft })).status, 200);
    assert.equal((await other.post('/requests', { ...input, photo_ids: [photo] }, { draft })).data.error, 'photos_changed');
  });
  await t.test('submit and retry return one reference and one private key', async () => {
    const body = { ...input, photo_ids: [photo], consent_whatsapp_share: true };
    const [one, two] = await Promise.all([customer.post('/requests', body, { draft }), customer.post('/requests', body, { draft })]);
    assert.deepEqual([one.status, two.status].sort(), [200, 201]);
    receipt = one.data;
    assert.equal(receipt.code, two.data.code);
    assert.equal(receipt.tracking_token, two.data.tracking_token);
    assert.equal(receipt.status, 'received');
    assert.equal(receipt.photos_attached, 1);
    assert.match(receipt.whatsapp.url, /^https:\/\/wa\.me\//);
    assert.ok(!receipt.whatsapp.message.includes(receipt.tracking_token));
    assert.equal(await db.requests.countDocuments({ state: 'submitted' }), 1);
    const row = await db.requests.findOne({ public_code: receipt.code });
    recordId = row._id;
    version = row.version;
    assert.equal(row.expiresAt, undefined);
    assert.equal(row.tracking_token_hash, sha256(receipt.tracking_token));
    assert.equal((await customer.post('/requests', { ...body, symptoms: 'Changed' }, { draft })).data.error, 'already_submitted');
  });
  await t.test('tracking requires both credentials and hides internal fields', async () => {
    assert.equal((await customer.post('/requests/lookup', { code: receipt.code, token: 'wrong' })).status, 404);
    const reply = (await customer.post('/requests/lookup', { code: receipt.code, token: receipt.tracking_token })).data;
    assert.equal(reply.technicianConfirmed, false);
    assert.equal(reply.history.length, 1);
    assert.equal(reply.customer_name, undefined);
    assert.equal(reply.history[0].actor, undefined);
    assert.equal(reply.liveTracking, 'unavailable');
  });
  await t.test('staff sessions, role boundaries and protected JPEG delivery', async () => {
    assert.equal((await other.call('/admin/photos/' + photo)).status, 401);
    assert.equal((await fetch(base + '/uploads/' + photo)).status, 404);
    for (const [role, browser] of [['owner', owner], ['viewer', viewer], ['dispatcher', dispatcher]]) {
      await browser.ready();
      const login = await browser.post('/admin/login', { username: role, password });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.role, role);
    }
    assert.equal((await owner.call('/admin/requests')).data.counts.received, 1);
    assert.equal((await viewer.call('/admin/requests/' + recordId, { method: 'PATCH', body: { version, status: 'confirmed' } })).status, 403);
    assert.equal((await dispatcher.call('/admin/requests/' + recordId, { method: 'DELETE' })).status, 403);
    assert.equal((await dispatcher.call('/admin/audit')).status, 403);
    const stored = await viewer.call('/admin/photos/' + photo);
    assert.equal(stored.status, 200);
    assert.match(stored.headers.get('content-type'), /image\/jpeg/);
    assert.equal((await sharp(stored.data).metadata()).format, 'jpeg');
    const details = (await owner.call('/admin/requests/' + recordId)).data.request;
    assert.equal(details.photos[0].content, undefined);
    assert.equal(details.tracking_token_hash, undefined);
  });
  await t.test('staff updates use version checks and tracking reveals the final bill only when complete', async () => {
    const update = await dispatcher.call('/admin/requests/' + recordId, { method: 'PATCH', body: {
      version, status: 'confirmed', technician_notes: 'Internal only', final_bill_note: 'Labour: 500 BDT',
    } });
    assert.equal(update.status, 200);
    assert.equal((await dispatcher.call('/admin/requests/' + recordId, { method: 'PATCH', body: { version, status: 'cancelled' } })).status, 409);
    const credentials = { code: receipt.code, token: receipt.tracking_token };
    let tracked = (await customer.post('/requests/lookup', credentials)).data;
    assert.equal(tracked.technicianConfirmed, true);
    assert.equal(tracked.final_bill_note, null);
    assert.equal(tracked.technician_notes, undefined);
    version = (await dispatcher.call('/admin/requests/' + recordId)).data.request.version;
    assert.equal((await dispatcher.call('/admin/requests/' + recordId, { method: 'PATCH', body: { version, status: 'completed' } })).status, 200);
    tracked = (await customer.post('/requests/lookup', credentials)).data;
    assert.deepEqual(tracked.history.map((row) => row.status), ['received', 'confirmed', 'completed']);
    assert.equal(tracked.final_bill_note, 'Labour: 500 BDT');
  });
  await t.test('correction requests reach staff and deleting removes the record and image together', async () => {
    const credentials = { code: receipt.code, token: receipt.tracking_token };
    assert.equal((await customer.post('/requests/privacy', { ...credentials, action: 'correct', note: 'Model is Allion' })).status, 200);
    const details = (await owner.call('/admin/requests/' + recordId)).data.request;
    assert.equal(details.correction_requested, true);
    assert.equal(details.corrections[0].note, 'Model is Allion');
    assert.equal((await customer.post('/requests/privacy', { ...credentials, action: 'delete' })).status, 200);
    assert.equal((await customer.post('/requests/lookup', credentials)).status, 404);
    assert.equal((await owner.call('/admin/photos/' + photo)).status, 404);
    const marker = await db.requests.findOne({ _id: recordId });
    assert.deepEqual(Object.keys(marker).sort(), ['_id', 'expiresAt', 'state']);
    assert.equal((await customer.post('/requests', { ...input, photo_ids: [photo], consent_whatsapp_share: true }, { draft })).data.error, 'draft_closed');
  });
  await t.test('owner updates rates and areas with audit events', async () => {
    const price = { code: 'real_tyre', category: 'tyre', label_en: 'Tyre', label_bn: 'টায়ার', min_bdt: 400, max_bdt: 650, active: true, sample: false };
    assert.equal((await viewer.post('/admin/config/pricing', price)).status, 403);
    assert.equal((await owner.post('/admin/config/pricing', { ...price, max_bdt: 100 })).status, 422);
    assert.equal((await owner.post('/admin/config/pricing', price)).status, 200);
    assert.equal((await owner.call('/admin/config/pricing/sample_tyre', { method: 'DELETE' })).status, 200);
    assert.equal((await owner.call('/admin/config/settings', { method: 'PUT', body: {
      battery_start_bdt: 600, pricing_is_sample: false, outside_keywords: 'sylhet,সিলেট',
    } })).status, 200);
    assert.equal((await owner.post('/admin/config/areas', { name_en: 'Test Area', name_bn: 'পরীক্ষার এলাকা', active: true, keywords: 'test landmark' })).status, 200);
    assert.equal((await customer.post('/location/check', { location_text: 'Test Landmark' })).data.status, 'inside');
    assert.equal((await customer.ready()).data.batteryStartBdt, 600);
    const est = (await customer.post('/chat/analyze', { symptoms: 'Flat tyre' })).data.estimate;
    assert.deepEqual([est.min, est.max, est.sample], [400, 650, false]);
    const events = (await owner.call('/admin/audit')).data.events;
    assert.ok(events.some((item) => item.event === 'status_change'));
    assert.ok(events.some((item) => item.event === 'area_saved'));
  });
  await t.test('unknown-area opt-in and WhatsApp opt-out work; owner can delete a request', async () => {
    const body = { ...input, location_text: 'Unmapped intersection', confirm_dhaka: true, request_type: 'battery' };
    const result = await customer.post('/requests', body, { draft: randomUUID() });
    assert.equal(result.status, 201);
    assert.equal(result.data.whatsapp, null);
    assert.equal(result.data.estimate, null);
    const row = await db.requests.findOne({ public_code: result.data.code });
    assert.equal(row.in_service_area, false);
    assert.equal((await owner.call('/admin/requests/' + row._id, { method: 'DELETE' })).status, 200);
  });
  await t.test('failed login lockout, account reset revocation and logout', async () => {
    await locked.ready();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await locked.post('/admin/login', { username: 'locktest', password: 'wrong' })).status, 401);
    }
    assert.equal((await locked.post('/admin/login', { username: 'locktest', password })).status, 429);
    await db.adminUsers.updateOne({ _id: 'viewer' }, { $inc: { authVersion: 1 } });
    assert.equal((await viewer.call('/admin/me')).status, 401);
    assert.equal((await owner.post('/admin/logout')).status, 200);
    assert.equal((await owner.call('/admin/me')).status, 401);
  });
});

test('legacy SQLite import preserves tracking, roles, history, and private photos', { timeout: 25000 }, async (t) => {
  const db = await testDatabase(t);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gariseba-import-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'legacy.db');
  const legacy = new DatabaseSync(file);
  try {
    legacy.exec(await fs.readFile(path.join(__dirname, 'fixtures', 'legacy-schema.sql'), 'utf8'));
    legacy.prepare('INSERT INTO admin_users (username,password_hash,role) VALUES (?,?,?)').run('old_owner', await bcrypt.hash(password, 4), 'owner');
    legacy.prepare("INSERT INTO settings (key,value) VALUES ('battery_start_bdt','550')").run();
    legacy.prepare("INSERT INTO service_areas (name_en,name_bn,keywords) VALUES ('Dhaka','ঢাকা','mirpur')").run();
    legacy.prepare(`INSERT INTO requests (public_code,tracking_token_hash,request_type,customer_name,callback_phone,
      location_text,vehicle_make,vehicle_model,symptoms,status,area_id)
      VALUES ('LN-ABC234',?,'repair','Fixture','+8801700000000','Mirpur','Toyota','Axio','Flat tyre','confirmed',1)`).run(sha256('fixture-secret'));
    legacy.prepare("INSERT INTO status_history (request_id,status,actor) VALUES (1,'confirmed','old_owner')").run();
    legacy.prepare("INSERT INTO photos (upload_id,draft_token_hash,request_id,stored_name,mime,bytes,label) VALUES ('legacy-photo-00000000','unused',1,?,'image/jpeg',200,'vehicle')").run('a'.repeat(48) + '.jpg');
  } finally { legacy.close(); }
  await assert.rejects(importSqlite(db, file, temp), { code: 'ENOENT' });
  await fs.writeFile(path.join(temp, 'a'.repeat(48) + '.jpg'), await jpeg());
  assert.deepEqual(await importSqlite(db, file, temp), { requests: 1, photos: 1 });
  assert.deepEqual(await importSqlite(db, file, temp), { alreadyImported: true });
  const row = await db.requests.findOne({ public_code: 'LN-ABC234' });
  assert.equal((await findTracked(db, 'LN-ABC234', 'fixture-secret')).status, 'confirmed');
  assert.equal(row.tracking_token_hash, sha256('fixture-secret'));
  assert.equal(row.history[0].status, 'confirmed');
  assert.equal(row.area_id, 'legacy-area-1');
  assert.equal((await sharp(row.photos[0].content).metadata()).format, 'jpeg');
  assert.equal((await db.adminUsers.findOne({ _id: 'old_owner' })).role, 'owner');
  assert.equal((await db.settings.findOne({ _id: 'business' })).battery_start_bdt, 550);
});
