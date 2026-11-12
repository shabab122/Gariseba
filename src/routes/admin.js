'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { businessSettings } = require('../db');
const { clean, CATEGORIES, TYPES } = require('../lib/validate');
const { STATUSES } = require('../lib/business');
const { HttpError } = require('../lib/http');
const { deleteRequest, submitted } = require('../lib/requests');
const { testOpenAIConnection } = require('../lib/ai');
const config = require('../config');
const { dhakaDayStart } = require('../lib/request-dates');
const { statusEmail, emailReady } = require('../lib/notifications');
const { operationRoutes } = require('./operations');
const sec = require('../lib/security');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-gariseba-password', 12);
const pageSize = 20;
const staffProjection = {
  tracking_token_hash: 0, fingerprint: 0, 'photos.content': 0,
  'email_outbox.payload': 0, 'email_outbox.claim_token': 0, notification_lock_token: 0,
};
const missing = () => new HttpError(404, 'not_found', 'The record could not be found.');
const invalid = (message) => new HttpError(422, 'validation', message);
const conflict = () => new HttpError(409, 'conflict', 'The request changed. Refresh the details before saving again.');
const denied = () => new HttpError(401, 'auth', 'Incorrect username or password.');
const range = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

async function registerFailure(db, user, now) {
  const nextCount = { $add: [{ $ifNull: ['$failedLogins', 0] }, 1] };
  await db.adminUsers.updateOne({
    _id: user._id, authVersion: user.authVersion, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
  }, [{ $set: {
    failedLogins: { $cond: [{ $gte: [nextCount, 5] }, 0, nextCount] },
    lockedUntil: { $cond: [{ $gte: [nextCount, 5] }, new Date(now.getTime() + 15 * 60 * 1000), null] },
  } }]);
}

function adminRoutes(db, limits, testConnection = testOpenAIConnection, email = config.email) {
  const router = express.Router();
  const role = (name) => sec.requireAdmin(db, name);
  router.post('/login', limits.login, async (req, res) => {
    const username = clean(req.body?.username, 60).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = /^[a-z0-9._-]{3,40}$/.test(username) && await db.adminUsers.findOne({ _id: username });
    const now = new Date();
    if (user?.lockedUntil > now) throw new HttpError(429, 'locked', 'This account is temporarily locked. Try again later.');
    const validLength = Buffer.byteLength(password, 'utf8') <= 72;
    const valid = await bcrypt.compare(validLength ? password : '', user?.passwordHash || DUMMY_HASH);
    if (!user || !validLength || !valid) {
      if (user) await registerFailure(db, user, now);
      await sec.audit(db, req, user?._id || 'unknown', 'admin_login_failed');
      throw denied();
    }
    const reset = await db.adminUsers.updateOne({
      _id: user._id, authVersion: user.authVersion, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    }, { $set: { failedLogins: 0, lockedUntil: null } });
    if (!reset.matchedCount) throw denied();

    const draftId = req.session.draftId;
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.draftId = draftId;
    req.session.admin = { id: user._id, authVersion: user.authVersion };
    const csrf = sec.ensureSession(req);
    await sec.audit(db, req, user._id, 'admin_login');
    res.json({ csrf, user: { username: user._id, role: user.role } });
  });

  router.post('/logout', async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
    const { maxAge, ...clearOptions } = sec.cookie;
    res.clearCookie(sec.cookieName, clearOptions).json({ ok: true });
  });

  router.use(limits.admin, role('viewer'));
  router.get('/me', (req, res) => res.json({ user: req.admin }));
  router.use(operationRoutes(db));

  router.get('/queue-updates', async (req, res) => {
    const totalReceived = await db.audit.countDocuments({ event: 'request_created' });
    res.json({ totalReceived });
  });

  router.post('/ai/test', role('owner'), limits.aiTest, async (req, res) => {
    const result = await testConnection();
    await sec.audit(db, req, req.admin.username, 'ai_connection_tested', result.code);
    res.json(result);
  });

  router.get('/requests', async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const code = clean(req.query.code, 20).toUpperCase();
    const pageValue = Number(req.query.page);
    const page = range(pageValue, 1, 500) ? pageValue : 1;
    const { type = '', urgency = '' } = req.query;
    if (type !== '' && !TYPES.includes(type)) throw invalid('Choose a valid request type.');
    if (urgency !== '' && !['normal', 'urgent'].includes(urgency)) throw invalid('Choose a valid urgency.');
    const from = dhakaDayStart(req.query.from);
    const to = dhakaDayStart(req.query.to);
    if (from && to && from > to) throw invalid('The start date must be on or before the end date.');

    const criteria = { ...submitted };
    if (status) criteria.status = status;
    if (code) criteria.public_code = code;
    if (type) criteria.request_type = type;
    if (urgency) criteria.urgency = urgency;
    if (from || to) {
      criteria.created_at = {};
      if (from) criteria.created_at.$gte = from;
      if (to) criteria.created_at.$lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    }
    const [rows, stats] = await Promise.all([
      db.requests.aggregate([
        { $match: criteria }, { $sort: { created_at: -1, _id: -1 } },
        { $skip: (page - 1) * pageSize }, { $limit: pageSize + 1 },
        { $project: {
          public_code: 1, request_type: 1, urgency: 1, status: 1, customer_name: 1,
          location_text: 1, vehicle_make: 1, vehicle_model: 1, safety_flag: 1,
          correction_requested: 1, created_at: 1, photo_count: { $size: '$photos' },
          technician: 1,
        } },
      ]).toArray(),
      db.requests.aggregate([
        { $match: submitted }, { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray(),
    ]);
    res.json({
      requests: rows.slice(0, pageSize), page, hasNext: rows.length > pageSize,
      counts: Object.fromEntries(stats.map(({ _id, count }) => [_id, count])),
    });
  });

  router.get('/requests/:id', async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...submitted }, { projection: staffProjection });
    if (!row) throw missing();
    await sec.audit(db, req, req.admin.username, 'request_viewed', row.public_code);
    res.json({ request: row });
  });

  router.patch('/requests/:id', role('dispatcher'), async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...submitted }, {
      projection: { public_code: 1, status: 1, version: 1, technician: 1, language: 1, consent_status_email: 1, notification_email: 1 },
    });
    if (!row) throw missing();
    const body = req.body || {};
    if (body.version !== row.version) throw conflict();
    const fields = {};
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw invalid('Choose a valid status.');
      fields.status = body.status;
    }
    if (body.technician_id !== undefined && body.technician_id !== (row.technician?.id || '')) {
      if (body.technician_id === '' || body.technician_id === null) {
        fields.technician = null;
      } else {
        if (typeof body.technician_id !== 'string') throw invalid('Choose a valid technician.');
        const technician = await db.technicians.findOne({ _id: body.technician_id, active: true });
        if (!technician) throw invalid('Choose an active technician or refresh the technician list.');
        fields.technician = { id: technician._id, name: technician.name };
      }
    }
    for (const key of ['technician_notes', 'final_bill_note']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string') throw invalid('Notes must be text.');
        fields[key] = clean(body[key], 4000);
      }
    }
    if (body.correction_requested === false) fields.correction_requested = false;
    if (!Object.keys(fields).length) throw invalid('Nothing to update.');
    const now = new Date();
    const change = { $set: { ...fields, updated_at: now }, $inc: { version: 1 } };
    const statusChanged = fields.status && fields.status !== row.status;
    if (statusChanged) change.$push = { history: { status: fields.status, actor: req.admin.username, created_at: now } };
    if (statusChanged && row.consent_status_email && emailReady(email)) {
      change.$push.email_outbox = statusEmail(row, fields.status, email, now);
    }
    const result = await db.requests.updateOne({ _id: row._id, ...submitted, version: row.version }, change);
    if (!result.matchedCount) throw conflict();
    await sec.audit(db, req, req.admin.username, statusChanged ? 'status_change' : 'request_updated', row.public_code);
    if (Object.hasOwn(fields, 'technician')) await sec.audit(db, req, req.admin.username, 'technician_assigned', row.public_code);
    res.json({ ok: true });
  });

  router.delete('/requests/:id', role('owner'), async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...submitted }, { projection: { public_code: 1 } });
    if (!row || !await deleteRequest(db, row._id)) throw missing();
    await sec.audit(db, req, req.admin.username, 'request_deleted', row.public_code);
    res.json({ ok: true });
  });

  router.get('/photos/:uploadId', async (req, res) => {
    const key = req.params.uploadId;
    const row = await db.requests.findOne({ ...submitted, 'photos.upload_id': key }, {
      projection: { _id: 0, photos: { $elemMatch: { upload_id: key } } },
    });
    const photo = row?.photos?.[0];
    if (!photo) throw missing();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="photo.jpg"' });
    res.send(photo.content);
  });

  router.get('/config', async (req, res) => {
    const [settings, areas, pricing] = await Promise.all([
      businessSettings(db), db.areas.find().sort({ name_en: 1 }).toArray(), db.pricing.find().sort({ category: 1, _id: 1 }).toArray(),
    ]);
    res.json({ settings, areas, pricing });
  });

  router.put('/config/settings', role('owner'), async (req, res) => {
    const body = req.body || {};
    if (!range(body.battery_start_bdt, 0, 100000) || typeof body.pricing_is_sample !== 'boolean') {
      throw invalid('Enter a valid battery starting charge and pricing mode.');
    }
    await db.settings.updateOne({ _id: 'business' }, { $set: {
      battery_start_bdt: body.battery_start_bdt, pricing_is_sample: body.pricing_is_sample,
      outside_keywords: clean(body.outside_keywords, 2000).toLowerCase(),
    } }, { upsert: true });
    await sec.audit(db, req, req.admin.username, 'settings_updated');
    res.json({ ok: true });
  });

  router.post('/config/areas', role('owner'), async (req, res) => {
    const body = req.body || {};
    const en = clean(body.name_en, 80), bn = clean(body.name_bn, 80);
    if (!en || !bn || typeof body.active !== 'boolean') throw invalid('Enter both area names and select its active state.');
    const area = { name_en: en, name_bn: bn, keywords: clean(body.keywords, 1500).toLowerCase(), active: body.active };
    if (body.id !== undefined) {
      if (typeof body.id !== 'string') throw invalid('Invalid area.');
      const result = await db.areas.updateOne({ _id: body.id }, { $set: area });
      if (!result.matchedCount) throw missing();
    } else {
      await db.areas.insertOne({ _id: 'area-' + sec.randomToken(9), ...area });
    }
    await sec.audit(db, req, req.admin.username, 'area_saved');
    res.json({ ok: true });
  });

  router.post('/config/pricing', role('owner'), async (req, res) => {
    const body = req.body || {};
    const code = clean(body.code, 60).toLowerCase();
    const min = body.min_bdt, max = body.max_bdt;
    if (!/^[a-z0-9_]{2,60}$/.test(code) || !CATEGORIES.includes(body.category) ||
        !range(min, 0, 10000000) || !range(max, min, 10000000)) {
      throw invalid('Use a valid code, category and price range.');
    }
    const en = clean(body.label_en, 100), bn = clean(body.label_bn, 100);
    if (!en || !bn || typeof body.active !== 'boolean' || typeof body.sample !== 'boolean') {
      throw invalid('Enter both price labels and select the active and sample settings.');
    }
    await db.pricing.updateOne({ _id: code }, { $set: {
      category: body.category, label_en: en, label_bn: bn, min_bdt: min, max_bdt: max,
      note_en: clean(body.note_en, 200), note_bn: clean(body.note_bn, 200), active: body.active, sample: body.sample,
    } }, { upsert: true });
    await sec.audit(db, req, req.admin.username, 'pricing_saved', code);
    res.json({ ok: true });
  });

  router.delete('/config/pricing/:id', role('owner'), async (req, res) => {
    const result = await db.pricing.deleteOne({ _id: req.params.id });
    if (!result.deletedCount) throw missing();
    await sec.audit(db, req, req.admin.username, 'pricing_deleted', req.params.id);
    res.json({ ok: true });
  });

  router.get('/audit', role('owner'), async (req, res) => {
    const events = await db.audit.find({}, { projection: { ip_hash: 0 } }).sort({ at: -1 }).limit(150).toArray();
    res.json({ events });
  });
  return router;
}

module.exports = { adminRoutes };
