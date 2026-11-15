'use strict';
const { HttpError } = require('./http');
const { dhakaDayStart } = require('./request-dates');
const { currentCustomer } = require('./customers');
const { findTracked } = require('./requests');
const activeStatuses = ['received', 'confirmed', 'in_progress'];
const slotMs = 60 * 60000;
const leadMs = 30 * 60000;
const maxAheadMs = 90 * 86400000;
function appointmentDay(value) {
  if (typeof value !== 'string' || !value) throw new HttpError(422, 'validation', 'Choose an appointment date.');
  const day = dhakaDayStart(value);
  if (!day) throw new HttpError(422, 'validation', 'Choose a valid appointment date.');
  return day;
}
function slotFields(body = {}, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'validation', 'Choose a date and hour for the slot.');
  const day = appointmentDay(body.date);
  if (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23) throw new HttpError(422, 'validation', 'Choose a whole hour from 00 to 23 (Dhaka time).');
  const starts_at = new Date(+day + body.hour * slotMs);
  if (+starts_at < +now + leadMs || +starts_at > +now + maxAheadMs) throw new HttpError(422, 'validation', 'Publish a slot at least 30 minutes and at most 90 days ahead.');
  return { starts_at, ends_at: new Date(+starts_at + slotMs) };
}
async function appointmentRequest(db, req) {
  let row;
  if (req.body?.request_id !== undefined) {
    const customer = await currentCustomer(db, req);
    if (!customer) throw new HttpError(401, 'customer_auth', 'Sign in to book from your service history.');
    if (typeof req.body.request_id !== 'string') throw new HttpError(422, 'validation', 'Choose a service request.');
    row = await db.requests.findOne({ _id: req.body.request_id, state: 'submitted', customer_id: customer._id }, { projection: { public_code: 1, status: 1, version: 1 } });
  } else row = await findTracked(db, req.body?.code, req.body?.token);
  if (!row) throw new HttpError(404, 'not_found', 'No service request matched your access details.');
  return row;
}
function appointmentView(slot) {
  return slot ? { slot_id: slot._id, booking_id: slot.booking.id, starts_at: slot.starts_at, ends_at: slot.ends_at } : null;
}
module.exports = { slotMs, leadMs, maxAheadMs, activeStatuses, appointmentDay, slotFields, appointmentRequest, appointmentView };
