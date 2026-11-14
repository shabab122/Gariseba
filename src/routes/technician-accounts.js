'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../lib/http');
const sec = require('../lib/security');
const invalid = (message) => new HttpError(422, 'validation', message);
const conflict = () => new HttpError(409, 'conflict', 'This account changed or already exists. Refresh the account before saving.');

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw invalid('Use 12 or more characters, at most 72 UTF-8 bytes, with a letter and a digit.');
  }
}

function technicianAccountRoutes(db, limits) {
  const router = express.Router();
  router.use('/technicians/:id/account', sec.requireAdmin(db, 'owner'));
  router.get('/technicians/:id/account', async (req, res) => {
    const technician = await db.technicians.findOne({ _id: req.params.id }, { projection: { name: 1 } });
    if (!technician) throw new HttpError(404, 'not_found', 'The technician could not be found.');
    const user = await db.adminUsers.findOne({ role: 'technician', technician_id: technician._id }, { projection: { authVersion: 1, enabled: 1 } });
    res.json({ account: user ? { username: user._id, enabled: user.enabled !== false, version: user.authVersion } : null });
  });
  router.post('/technicians/:id/account', limits.technicianAccount, async (req, res) => {
    const body = req.body || {};
    if (Object.keys(body).some((key) => !['username', 'password', 'enabled'].includes(key))) throw invalid('Unsupported account fields.');
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || (body.enabled !== undefined && typeof body.enabled !== 'boolean')) throw invalid('Enter a valid username and account state.');
    validatePassword(body.password);
    if (!await db.technicians.findOne({ _id: req.params.id }, { projection: { _id: 1 } })) throw new HttpError(404, 'not_found', 'The technician could not be found.');
    const row = {
      _id: username, role: 'technician', technician_id: req.params.id, enabled: body.enabled !== false,
      passwordHash: await bcrypt.hash(body.password, 12), authVersion: 1, failedLogins: 0, lockedUntil: null, created_at: new Date(),
    };
    try { await db.adminUsers.insertOne(row); }
    catch (error) { if (error.code === 11000) throw conflict(); throw error; }
    await sec.audit(db, req, req.admin.username, 'technician_account_created', row._id);
    res.status(201).json({ ok: true });
  });
  router.patch('/technicians/:id/account', limits.technicianAccount, async (req, res) => {
    const body = req.body || {};
    if (Object.keys(body).some((key) => !['version', 'password', 'enabled'].includes(key)) || !Number.isSafeInteger(body.version)) throw invalid('Refresh the account and enter valid account fields.');
    const fields = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw invalid('Choose an account state.');
      fields.enabled = body.enabled;
    }
    if (body.password !== undefined) {
      validatePassword(body.password);
      fields.passwordHash = await bcrypt.hash(body.password, 12);
    }
    if (!Object.keys(fields).length) throw invalid('Nothing to update.');
    const user = await db.adminUsers.findOneAndUpdate({ role: 'technician', technician_id: req.params.id, authVersion: body.version }, {
      $set: { ...fields, failedLogins: 0, lockedUntil: null }, $inc: { authVersion: 1 },
    }, { returnDocument: 'after', projection: { _id: 1 } });
    if (!user) throw conflict();
    await sec.audit(db, req, req.admin.username, 'technician_account_updated', user._id);
    res.json({ ok: true });
  });
  return router;
}

module.exports = { technicianAccountRoutes };
