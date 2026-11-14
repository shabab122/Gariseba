'use strict';
const express = require('express');
const { HttpError } = require('../lib/http');
const { submitted } = require('../lib/requests');
const { invoiceFields, makeInvoice, sendInvoice } = require('../lib/invoices');
const sec = require('../lib/security');

function billingRoutes(db) {
  const router = express.Router();
  router.put('/requests/:id/invoice', sec.requireAdmin(db, 'dispatcher'), async (req, res) => {
    const fields = invoiceFields(req.body);
    const row = await db.requests.findOne({ _id: req.params.id, ...submitted }, { projection: {
      public_code: 1, status: 1, version: 1, customer_name: 1, callback_phone: 1,
      vehicle_make: 1, vehicle_model: 1, vehicle_year: 1, registration: 1, invoice: 1,
    } });
    if (!row) throw new HttpError(404, 'not_found', 'The request could not be found.');
    if (row.status !== 'completed') throw new HttpError(409, 'bill_unavailable', 'Complete the service before saving the final bill.');
    if (!Number.isSafeInteger(req.body?.version) || req.body.version !== row.version) throw new HttpError(409, 'conflict', 'The request changed. Refresh the details before saving again.');
    const now = new Date();
    const invoice = makeInvoice(row, fields, req.admin.username, now);
    const result = await db.requests.updateOne({ _id: row._id, ...submitted, status: 'completed', version: row.version }, {
      $set: { invoice, updated_at: now }, $inc: { version: 1 },
    });
    if (!result.matchedCount) throw new HttpError(409, 'conflict', 'The request changed. Refresh the details before saving again.');
    await sec.audit(db, req, req.admin.username, 'invoice_saved', row.public_code);
    res.json({ ok: true, invoice });
  });
  router.get('/requests/:id/invoice.pdf', async (req, res) => {
    const row = await db.requests.findOne({ _id: req.params.id, ...submitted }, { projection: { invoice: 1, status: 1, public_code: 1 } });
    if (!row) throw new HttpError(404, 'not_found', 'The request could not be found.');
    await sendInvoice(res, row);
  });
  return router;
}

module.exports = { billingRoutes };
