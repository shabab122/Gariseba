'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const { clean, normalizePhone } = require('../lib/validate');
const { HttpError } = require('../lib/http');
const { requestReport, reportCsv } = require('../lib/reports');
const { technicianWorkload } = require('../lib/technician-workload');
const { technicianAccountRoutes } = require('./technician-accounts');
const { checkEmailDelivery } = require('../lib/email-delivery');
const sec = require('../lib/security');

function technicianFields(body = {}) {
  if (!body || typeof body !== 'object') throw new HttpError(422, 'validation', 'Enter technician details.');
  const name = clean(body.name, 80);
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (name.length < 2 || (body.phone && !phone) || (body.active !== undefined && typeof body.active !== 'boolean')) {
    throw new HttpError(422, 'validation', 'Enter a technician name, a valid optional Bangladesh phone number, and an active status.');
  }
  return { name, phone, active: body.active !== false };
}

function operationRoutes(db, { email, deliveryFetcher, limits }) {
  const router = express.Router();
  const role = (name) => sec.requireAdmin(db, name);
  router.use(technicianAccountRoutes(db, limits));
  router.post('/requests/:id/emails/:emailId/delivery', role('dispatcher'), limits.emailDelivery, async (req, res) => {
    const result = await checkEmailDelivery(db, req.params.id, req.params.emailId, { email, fetcher: deliveryFetcher });
    await sec.audit(db, req, req.admin.username, 'email_delivery_checked', req.params.id);
    res.json(result);
  });
  router.get('/technician-workload', async (req, res) => res.json(await technicianWorkload(db)));
  router.get('/technicians', async (req, res) => {
    const technicians = await db.technicians.find({}, { projection: { name: 1, phone: 1, active: 1, version: 1 } })
      .sort({ active: -1, name: 1, _id: 1 }).toArray();
    res.json({ technicians });
  });
  router.post('/technicians', role('owner'), async (req, res) => {
    const row = { _id: randomUUID(), ...technicianFields(req.body), version: 1, created_at: new Date() };
    await db.technicians.insertOne(row);
    await sec.audit(db, req, req.admin.username, 'technician_created', row._id);
    res.status(201).json({ technician: row });
  });
  router.patch('/technicians/:id', role('owner'), async (req, res) => {
    if (!Number.isSafeInteger(req.body?.version)) throw new HttpError(422, 'validation', 'Refresh the technician before saving.');
    const result = await db.technicians.updateOne({ _id: req.params.id, version: req.body.version }, {
      $set: { ...technicianFields(req.body), updated_at: new Date() }, $inc: { version: 1 },
    });
    if (!result.matchedCount) throw new HttpError(409, 'conflict', 'The technician changed. Refresh the list before saving.');
    await sec.audit(db, req, req.admin.username, 'technician_updated', req.params.id);
    res.json({ ok: true });
  });
  router.get('/reports', role('owner'), async (req, res) => res.json(await requestReport(db, req.query)));
  router.get('/reports.csv', role('owner'), async (req, res) => {
    const report = await requestReport(db, req.query);
    await sec.audit(db, req, req.admin.username, 'report_exported', report.from + '/' + report.to);
    res.attachment('gariseba-report-' + report.from + '-to-' + report.to + '.csv').type('text/csv').send(reportCsv(report));
  });
  router.post('/requests/:id/emails/:emailId/retry', role('dispatcher'), async (req, res) => {
    const now = new Date();
    const row = await db.requests.findOneAndUpdate({
      _id: req.params.id, state: 'submitted', consent_status_email: true,
      email_outbox: { $elemMatch: { id: req.params.emailId, state: 'failed', expires_at: { $gt: now } } },
    }, {
      $set: { 'email_outbox.$.state': 'pending', 'email_outbox.$.attempts': 0, 'email_outbox.$.next_attempt_at': now, 'email_outbox.$.last_error': null },
    }, { returnDocument: 'after', projection: { public_code: 1 } });
    if (!row) throw new HttpError(409, 'conflict', 'This email cannot be retried. Check consent, its current state and the 23-hour retry window.');
    await sec.audit(db, req, req.admin.username, 'status_email_retried', row.public_code);
    res.json({ ok: true });
  });
  return router;
}

module.exports = { operationRoutes };
