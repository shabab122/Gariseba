'use strict';
const express = require('express');
const sec = require('../lib/security');
const { paymentFields, paymentSummary } = require('../lib/payments');
const { HttpError } = require('../lib/http');
const { submitted } = require('../lib/requests');
function paymentRoutes(db) {
  const router = express.Router();
  router.post('/requests/:id/payments', sec.requireAdmin(db, 'dispatcher'), async (req, res) => {
    const fields = paymentFields(req.body);
    const fingerprint = sec.sha256(JSON.stringify(fields));
    const criteria = { _id: req.params.id, ...submitted };
    const projection = { invoice: 1, payments: 1, version: 1, status: 1, public_code: 1 };
    const row = await db.requests.findOne(criteria, { projection });
    if (!row) throw new HttpError(404, 'not_found', 'The request could not be found.');
    function replay(current) {
      const found = current?.payments?.find(item => item.id === fields.id);
      if (!found) return false;
      if (found.fingerprint !== fingerprint) throw new HttpError(409, 'conflict', 'This operation ID was already used for different payment details.');
      res.json({ ok: true, payment: paymentSummary(current) }); return true;
    }
    if (replay(row)) return;
    if (!row.invoice || row.status !== 'completed') throw new HttpError(409, 'bill_unavailable', 'Complete the service and issue its bill before recording a payment.');
    if (!Number.isSafeInteger(req.body.version) || row.version !== req.body.version) throw new HttpError(409, 'conflict', 'The request changed. Refresh before recording a payment.');
    const summary = paymentSummary(row);
    if ((fields.kind === 'payment' && fields.amount_poisha > summary.balance_poisha) ||
        (fields.kind === 'refund' && fields.amount_poisha > summary.paid_poisha)) throw new HttpError(422, 'validation', 'A payment cannot exceed the balance and a refund cannot exceed the recorded paid amount.');
    if ((row.payments?.length || 0) >= 200) throw new HttpError(409, 'payment_limit', 'This bill reached its payment entry limit. Contact the owner.');
    const now = new Date();
    const entry = { ...fields, fingerprint, actor: req.admin.username, created_at: now };
    const saved = await db.requests.updateOne({ ...criteria, version: row.version }, {
      $push: { payments: entry }, $set: { updated_at: now }, $inc: { version: 1 },
    });
    if (!saved.matchedCount) {
      if (replay(await db.requests.findOne(criteria, { projection }))) return;
      throw new HttpError(409, 'conflict', 'The request changed. Refresh before recording a payment.');
    }
    await sec.audit(db, req, req.admin.username, fields.kind === 'refund' ? 'refund_recorded' : 'payment_recorded', row.public_code);
    res.status(201).json({ ok: true, payment: paymentSummary({ ...row, payments: [...(row.payments || []), entry] }) });
  });
  return router;
}
module.exports = { paymentRoutes };
