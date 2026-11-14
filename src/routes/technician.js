'use strict';
const express = require('express');
const { clean } = require('../lib/validate');
const { STATUSES } = require('../lib/business');
const { HttpError } = require('../lib/http');
const { applyArrivalEta, activeStatuses } = require('../lib/arrival-eta');
const { statusEmail, emailReady } = require('../lib/notifications');
const { defaultSms, smsReady, statusSms } = require('../lib/sms');
const sec = require('../lib/security');
const missing = () => new HttpError(404, 'not_found', 'This request is no longer assigned to you.');
const invalid = (message) => new HttpError(422, 'validation', message);
const conflict = () => new HttpError(409, 'conflict', 'The request changed. Refresh the details before saving again.');
const detailProjection = {
  public_code: 1, customer_name: 1, callback_phone: 1, location_text: 1, map_lat: 1, map_lng: 1,
  vehicle_make: 1, vehicle_model: 1, vehicle_year: 1, fuel_type: 1, registration: 1, symptoms: 1,
  status: 1, urgency: 1, request_type: 1, created_at: 1, updated_at: 1, version: 1,
  arrival_eta: 1, technician_notes: 1, 'photos.upload_id': 1, 'photos.label': 1,
};

function technicianRoutes(db, email, sms = defaultSms) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.admin.role !== 'technician') throw new HttpError(403, 'forbidden', 'This section is for technician accounts.');
    next();
  });
  const own = (req) => ({ state: 'submitted', 'technician.id': req.admin.technicianId });
  router.get('/requests', async (req, res) => {
    const { status = '' } = req.query;
    if (status !== '' && !STATUSES.includes(status)) throw invalid('Choose a valid status.');
    const criteria = { ...own(req), ...(status ? { status } : {}) };
    const number = Number(req.query.page);
    const page = Number.isInteger(number) && number >= 1 && number <= 500 ? number : 1;
    const rows = await db.requests.find(criteria, { projection: {
      public_code: 1, customer_name: 1, location_text: 1, request_type: 1, urgency: 1, status: 1, created_at: 1, arrival_eta: 1,
    } }).sort({ created_at: -1, _id: -1 }).skip((page - 1) * 20).limit(21).toArray();
    res.json({ requests: rows.slice(0, 20), page, hasNext: rows.length > 20 });
  });
  router.get('/requests/:id', async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...own(req) }, { projection: detailProjection });
    if (!row) throw missing();
    await sec.audit(db, req, req.admin.username, 'technician_request_viewed', row.public_code);
    res.json({ request: row });
  });
  router.patch('/requests/:id', async (req, res) => {
    const body = req.body || {};
    if (Object.keys(body).some((key) => !['version', 'status', 'technician_notes', 'arrival_eta'].includes(key))) throw invalid('Only work status, notes and arrival estimate can be changed here.');
    const row = await db.requests.findOne({ _id: req.params.id, ...own(req) }, { projection: {
      public_code: 1, status: 1, version: 1, technician: 1, arrival_eta: 1, language: 1, consent_status_email: 1, notification_email: 1,
      consent_status_sms: 1, callback_phone: 1,
    } });
    if (!row) throw missing();
    if (body.version !== row.version || !activeStatuses.includes(row.status)) throw conflict();
    const fields = {};
    if (body.status !== undefined) {
      const allowed = row.status === 'in_progress' ? ['in_progress', 'completed'] : [row.status, 'in_progress'];
      if (!allowed.includes(body.status)) throw invalid('Start the work before marking it completed. Other status changes need a dispatcher.');
      fields.status = body.status;
    }
    if (body.technician_notes !== undefined) {
      if (typeof body.technician_notes !== 'string') throw invalid('Notes must be text.');
      fields.technician_notes = clean(body.technician_notes, 4000);
    }
    const now = new Date();
    applyArrivalEta(row, fields, body.arrival_eta, now);
    if (!Object.keys(fields).length) throw invalid('Nothing to update.');
    const change = { $set: { ...fields, updated_at: now }, $inc: { version: 1 } };
    const changed = fields.status && fields.status !== row.status;
    if (changed) {
      change.$push = { history: { status: fields.status, actor: req.admin.username, created_at: now } };
      if (row.consent_status_email && emailReady(email)) change.$push.email_outbox = statusEmail(row, fields.status, email, now);
      if (row.consent_status_sms && smsReady(sms)) change.$push.sms_outbox = statusSms(row, fields.status, now);
    }
    const result = await db.requests.updateOne({ _id: row._id, ...own(req), version: row.version }, change);
    if (!result.matchedCount) throw conflict();
    await sec.audit(db, req, req.admin.username, changed ? 'status_change' : 'technician_request_updated', row.public_code);
    res.json({ ok: true });
  });
  router.get('/photos/:uploadId', async (req, res) => {
    const row = await db.requests.findOne({ ...own(req), 'photos.upload_id': req.params.uploadId }, {
      projection: { _id: 0, photos: { $elemMatch: { upload_id: req.params.uploadId } } },
    });
    const photo = row?.photos?.[0];
    if (!photo) throw missing();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="photo.jpg"' }).send(photo.content);
  });
  return router;
}

module.exports = { technicianRoutes };
