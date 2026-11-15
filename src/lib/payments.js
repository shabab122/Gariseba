'use strict';
const { clean } = require('./validate');
const { parseMoney } = require('./money');
const { HttpError } = require('./http');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const netPaid = (row) => (row.payments || []).reduce((sum, item) => sum + (item.kind === 'refund' ? -item.amount_poisha : item.amount_poisha), 0);
function paymentSummary(row) {
  if (!row.invoice) return null;
  const paid_poisha = netPaid(row), total_poisha = row.invoice.total_poisha;
  return { total_poisha, paid_poisha, balance_poisha: total_poisha - paid_poisha,
    status: paid_poisha >= total_poisha ? 'paid' : paid_poisha > 0 ? 'partially_paid' : 'unpaid' };
}
function paymentFields(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.operation_id !== 'string' ||
      !uuid.test(body.operation_id) || !['payment', 'refund'].includes(body.kind) ||
      !['cash', 'bkash', 'nagad', 'bank', 'other'].includes(body.method)) throw new HttpError(422, 'validation', 'Choose a payment type, method and valid operation ID.');
  const amount_poisha = parseMoney(body.amount_bdt);
  if (amount_poisha <= 0) throw new HttpError(422, 'validation', 'The payment amount must be greater than zero.');
  for (const [field, max] of [['reference', 120], ['note', 300]]) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > max)) throw new HttpError(422, 'validation', 'Payment references and notes must be short text.');
  }
  return { id: body.operation_id.toLowerCase(), kind: body.kind, amount_poisha, method: body.method,
    reference: clean(body.reference, 120), note: clean(body.note, 300) };
}
module.exports = { uuid, netPaid, paymentSummary, paymentFields };
