'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { HttpError } = require('../lib/http');
const { clean } = require('../lib/validate');
const { findTracked, trackView } = require('../lib/requests');
const { sendInvoice } = require('../lib/invoices');
const { usernameOf, validPassword, publicCustomer, currentCustomer, requireCustomer, rotateCustomerSession } = require('../lib/customers');
const sec = require('../lib/security');
const dummyHash = bcrypt.hashSync('SyntheticPasswordForTimingOnly', 12);
const denied = () => new HttpError(401, 'customer_auth', 'Incorrect username or password.');
const missing = () => new HttpError(404, 'not_found', 'This request is not in your service history.');

function customerRoutes(db, limits) {
  const router = express.Router();
  router.get('/me', async (req, res) => res.json({ customer: publicCustomer(await currentCustomer(db, req)) }));
  router.post('/register', limits.customerRegister, async (req, res) => {
    const username = usernameOf(req.body?.username), name = clean(req.body?.name, 80), password = req.body?.password;
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) || name.length < 2 || !validPassword(password)) {
      throw new HttpError(422, 'validation', 'Use a 3-40 character username, your name, and a password of at least 15 characters and at most 72 UTF-8 bytes.');
    }
    const recoveryCode = sec.randomToken(24);
    const row = { _id: randomUUID(), username, name, passwordHash: await bcrypt.hash(password, 12),
      recovery_hash: sec.sha256(recoveryCode), authVersion: 1, enabled: true, failedLogins: 0, lockedUntil: null, created_at: new Date() };
    try { await db.customers.insertOne(row); }
    catch (error) { if (error.code === 11000) throw new HttpError(409, 'username_unavailable', 'Choose another customer username.'); throw error; }
    const csrf = await rotateCustomerSession(req, row);
    await sec.audit(db, req, 'customer:' + row._id, 'customer_registered');
    res.status(201).json({ customer: publicCustomer(row), csrf, recovery_code: recoveryCode });
  });
  router.post('/login', limits.customerLogin, async (req, res) => {
    const username = usernameOf(req.body?.username), password = req.body?.password;
    const row = /^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) ? await db.customers.findOne({ username }) : null;
    const now = new Date();
    if (row?.lockedUntil > now) throw new HttpError(429, 'locked', 'This customer account is temporarily locked. Try again later.');
    const fits = typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 72;
    const valid = await bcrypt.compare(fits ? password : '', row?.passwordHash || dummyHash);
    if (!row || !fits || !valid || !row.enabled) {
      if (row) {
        const next = { $add: [{ $ifNull: ['$failedLogins', 0] }, 1] };
        await db.customers.updateOne({ _id: row._id, authVersion: row.authVersion, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, [{ $set: {
          failedLogins: { $cond: [{ $gte: [next, 5] }, 0, next] },
          lockedUntil: { $cond: [{ $gte: [next, 5] }, new Date(+now + 15 * 60000), null] },
        } }]);
      }
      throw denied();
    }
    const reset = await db.customers.updateOne({ _id: row._id, authVersion: row.authVersion, enabled: true,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, { $set: { failedLogins: 0, lockedUntil: null } });
    if (!reset.matchedCount) throw denied();
    res.json({ customer: publicCustomer(row), csrf: await rotateCustomerSession(req, row) });
  });
  router.post('/recover', limits.customerRecovery, async (req, res) => {
    const username = usernameOf(req.body?.username), code = req.body?.recovery_code;
    if (!validPassword(req.body?.new_password)) throw new HttpError(422, 'validation', 'Use a new password of at least 15 characters and at most 72 UTF-8 bytes.');
    const row = /^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) && typeof code === 'string' && /^[A-Za-z0-9_-]{32}$/.test(code) ? await db.customers.findOne({ username, enabled: true }) : null;
    if (!row || !sec.safeEqualHex(row.recovery_hash || sec.sha256('invalid'), sec.sha256(code))) throw new HttpError(401, 'customer_auth', 'Incorrect username or recovery code.');
    const recoveryCode = sec.randomToken(24);
    const result = await db.customers.findOneAndUpdate({ _id: row._id, authVersion: row.authVersion, recovery_hash: row.recovery_hash, enabled: true }, {
      $set: { passwordHash: await bcrypt.hash(req.body.new_password, 12), recovery_hash: sec.sha256(recoveryCode), failedLogins: 0, lockedUntil: null }, $inc: { authVersion: 1 },
    }, { returnDocument: 'after', projection: { username: 1, name: 1, authVersion: 1 } });
    if (!result) throw new HttpError(409, 'conflict', 'The account changed. Try signing in again.');
    await sec.audit(db, req, 'customer:' + row._id, 'customer_recovered');
    res.json({ customer: publicCustomer(result), csrf: await rotateCustomerSession(req, result), recovery_code: recoveryCode });
  });
  router.post('/logout', async (req, res) => res.json({ ok: true, csrf: await rotateCustomerSession(req, null) }));
  router.use(requireCustomer(db));
  router.post('/password', limits.customerRecovery, async (req, res) => {
    if (!validPassword(req.body?.new_password) || typeof req.body?.current_password !== 'string' || Buffer.byteLength(req.body.current_password) > 72) throw new HttpError(422, 'validation', 'Enter your current password and a new password of at least 15 characters and at most 72 UTF-8 bytes.');
    const row = await db.customers.findOne({ _id: req.customer._id, authVersion: req.customer.authVersion, enabled: true });
    if (!row || !await bcrypt.compare(req.body.current_password, row.passwordHash)) throw denied();
    const recoveryCode = sec.randomToken(24);
    const changed = await db.customers.findOneAndUpdate({ _id: row._id, authVersion: row.authVersion, enabled: true }, {
      $set: { passwordHash: await bcrypt.hash(req.body.new_password, 12), recovery_hash: sec.sha256(recoveryCode), failedLogins: 0, lockedUntil: null }, $inc: { authVersion: 1 },
    }, { returnDocument: 'after', projection: { username: 1, name: 1, authVersion: 1 } });
    if (!changed) throw new HttpError(409, 'conflict', 'The account changed. Sign in again.');
    await sec.audit(db, req, 'customer:' + row._id, 'customer_password_changed');
    res.json({ ok: true, csrf: await rotateCustomerSession(req, changed), recovery_code: recoveryCode });
  });
  router.post('/requests/link', limits.lookup, async (req, res) => {
    const row = await findTracked(db, req.body?.code, req.body?.token);
    if (!row) throw missing();
    if (row.customer_id === req.customer._id) return res.json({ ok: true });
    if (row.customer_id) throw new HttpError(409, 'request_owned', 'This request is already linked to another customer account.');
    const saved = await db.requests.updateOne({ _id: row._id, state: 'submitted', customer_id: null }, {
      $set: { customer_id: req.customer._id, updated_at: new Date() }, $inc: { version: 1 },
    });
    if (!saved.matchedCount) throw new HttpError(409, 'conflict', 'The request changed or was linked to another account.');
    await sec.audit(db, req, 'customer:' + req.customer._id, 'customer_request_linked', row.public_code);
    res.json({ ok: true });
  });
  const own = req => ({ state: 'submitted', customer_id: req.customer._id });
  router.get('/requests', async (req, res) => {
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 500) throw new HttpError(422, 'validation', 'Choose a valid history page.');
    const rows = await db.requests.find(own(req), { projection: { public_code: 1, status: 1, request_type: 1, created_at: 1, updated_at: 1, vehicle_make: 1, vehicle_model: 1 } })
      .sort({ created_at: -1, _id: -1 }).skip((page - 1) * 20).limit(21).toArray();
    res.json({ requests: rows.slice(0, 20), page, hasNext: rows.length > 20 });
  });
  router.get('/requests/:id', async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...own(req) }, { projection: { public_code: 1, status: 1, language: 1, request_type: 1, created_at: 1, updated_at: 1,
      history: 1, final_bill_note: 1, consent_status_email: 1, consent_status_sms: 1, arrival_eta: 1, invoice: 1, payments: 1, feedback: 1, customer_name: 1, vehicle_make: 1, vehicle_model: 1, symptoms: 1 } });
    if (!row) throw missing();
    const appointment = await db.appointments.findOne({ 'booking.request_id': row._id }, { projection: { starts_at: 1, ends_at: 1, 'booking.id': 1 } });
    res.json({ request: { id: row._id, ...trackView(row), customer_name: row.customer_name, vehicle: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' '), symptoms: row.symptoms },
      appointment: appointment ? { slot_id: appointment._id, booking_id: appointment.booking.id, starts_at: appointment.starts_at, ends_at: appointment.ends_at } : null });
  });
  router.get('/requests/:id/invoice.pdf', async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...own(req) }, { projection: { invoice: 1, payments: 1, status: 1 } });
    if (!row) throw missing();
    await sendInvoice(res, row);
  });
  return router;
}
module.exports = { customerRoutes };
