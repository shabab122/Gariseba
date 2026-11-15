'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const sec = require('../lib/security');
const { HttpError } = require('../lib/http');
const { uuid } = require('../lib/payments');
const { leadMs, maxAheadMs, activeStatuses, appointmentDay, slotFields, appointmentRequest, appointmentView } = require('../lib/appointments');
const conflict = () => new HttpError(409, 'appointment_conflict', 'This slot or request changed. Refresh the appointment details.');

function appointmentRoutes(db, limits) {
  const router = express.Router();
  router.get('/slots', async (req, res) => {
    const day = appointmentDay(req.query.date), now = new Date();
    if (+day > +now + maxAheadMs) throw new HttpError(422, 'validation', 'Choose a date within the next 90 days.');
    const slots = await db.appointments.find({ active: true, booking: null, starts_at: {
      $gte: new Date(Math.max(+day, +now + leadMs)), $lt: new Date(+day + 86400000),
    } }, { projection: { starts_at: 1, ends_at: 1, version: 1 } }).sort({ starts_at: 1 }).limit(24).toArray();
    res.json({ slots });
  });
  router.post('/current', limits.appointments, async (req, res) => {
    const row = await appointmentRequest(db, req);
    const slot = await db.appointments.findOne({ 'booking.request_id': row._id });
    res.json({ appointment: appointmentView(slot), code: row.public_code, canBook: activeStatuses.includes(row.status) });
  });
  router.post('/book', limits.appointments, async (req, res) => {
    const row = await appointmentRequest(db, req), now = new Date();
    if (!activeStatuses.includes(row.status)) throw new HttpError(409, 'appointment_closed', 'Only an open service request can book an appointment.');
    if (typeof req.body?.slot_id !== 'string' || !uuid.test(req.body.slot_id) || !Number.isSafeInteger(req.body?.version)) throw new HttpError(422, 'validation', 'Choose an available slot.');
    const existing = await db.appointments.findOne({ 'booking.request_id': row._id });
    if (existing) {
      if (existing._id === req.body.slot_id) return res.json({ appointment: appointmentView(existing) });
      throw new HttpError(409, 'appointment_exists', 'This request already has an appointment. Cancel it before booking another slot.');
    }
    const booking = { id: randomUUID(), request_id: row._id, code: row.public_code, booked_at: now };
    let saved;
    try {
      saved = await db.appointments.findOneAndUpdate({ _id: req.body.slot_id, version: req.body.version, active: true, booking: null,
        starts_at: { $gte: new Date(+now + leadMs), $lte: new Date(+now + maxAheadMs) } },
      { $set: { booking }, $inc: { version: 1 } }, { returnDocument: 'after' });
    } catch (error) { if (error.code === 11000) throw conflict(); throw error; }
    if (!saved) {
      const replay = await db.appointments.findOne({ _id: req.body.slot_id, 'booking.request_id': row._id });
      if (replay) return res.json({ appointment: appointmentView(replay) });
      throw conflict();
    }
    // Recheck after reservation so deletion or closure cannot leave a new orphan booking.
    const stillOpen = await db.requests.findOne({ _id: row._id, state: 'submitted', status: { $in: activeStatuses } }, { projection: { _id: 1 } });
    if (!stillOpen) {
      await db.appointments.updateOne({ _id: saved._id, 'booking.id': booking.id }, { $unset: { booking: '' }, $inc: { version: 1 } });
      throw conflict();
    }
    await sec.audit(db, req, 'customer', 'appointment_booked', row.public_code);
    res.status(201).json({ appointment: appointmentView(saved) });
  });
  router.post('/cancel', limits.appointments, async (req, res) => {
    const row = await appointmentRequest(db, req);
    if (typeof req.body?.booking_id !== 'string' || !uuid.test(req.body.booking_id)) throw new HttpError(422, 'validation', 'Choose the current appointment.');
    const result = await db.appointments.updateOne({ 'booking.request_id': row._id, 'booking.id': req.body.booking_id, starts_at: { $gt: new Date() } },
      { $unset: { booking: '' }, $inc: { version: 1 } });
    if (!result.matchedCount) throw conflict();
    await sec.audit(db, req, 'customer', 'appointment_cancelled', row.public_code);
    res.json({ ok: true });
  });
  return router;
}

function adminAppointmentRoutes(db) {
  const router = express.Router();
  router.get('/appointments', async (req, res) => {
    const day = appointmentDay(req.query.date);
    const slots = await db.appointments.find({ starts_at: { $gte: day, $lt: new Date(+day + 86400000) } }).sort({ starts_at: 1 }).limit(24).toArray();
    const ids = slots.filter(slot => slot.booking).map(slot => slot.booking.request_id);
    const requests = ids.length ? await db.requests.find({ _id: { $in: ids }, state: 'submitted' }, { projection: { customer_name: 1 } }).toArray() : [];
    const names = new Map(requests.map(row => [row._id, row.customer_name]));
    res.json({ slots: slots.map(slot => ({ _id: slot._id, version: slot.version, active: slot.active, starts_at: slot.starts_at, ends_at: slot.ends_at,
      booking: slot.booking ? { ...slot.booking, customer_name: names.get(slot.booking.request_id) || 'Request unavailable' } : null })) });
  });
  router.post('/appointments', sec.requireAdmin(db, 'dispatcher'), async (req, res) => {
    const slot = { _id: randomUUID(), ...slotFields(req.body), active: true, version: 1, created_at: new Date() };
    try { await db.appointments.insertOne(slot); }
    catch (error) { if (error.code === 11000) throw new HttpError(409, 'appointment_exists', 'A slot already exists at that hour. Reopen the existing slot if needed.'); throw error; }
    await sec.audit(db, req, req.admin.username, 'appointment_slot_created', slot._id);
    res.status(201).json({ slot });
  });
  router.patch('/appointments/:id', sec.requireAdmin(db, 'dispatcher'), async (req, res) => {
    if (!Number.isSafeInteger(req.body?.version) || typeof req.body?.active !== 'boolean') throw new HttpError(422, 'validation', 'Refresh the slot before changing its availability.');
    const saved = await db.appointments.updateOne({ _id: req.params.id, version: req.body.version, booking: null, starts_at: { $gt: new Date() } },
      { $set: { active: req.body.active }, $inc: { version: 1 } });
    if (!saved.matchedCount) throw conflict();
    await sec.audit(db, req, req.admin.username, 'appointment_slot_updated', req.params.id);
    res.json({ ok: true });
  });
  router.post('/appointments/:id/cancel', sec.requireAdmin(db, 'dispatcher'), async (req, res) => {
    if (!Number.isSafeInteger(req.body?.version) || typeof req.body?.booking_id !== 'string' || !uuid.test(req.body.booking_id)) throw conflict();
    const saved = await db.appointments.findOneAndUpdate({ _id: req.params.id, version: req.body.version, 'booking.id': req.body.booking_id },
      { $unset: { booking: '' }, $inc: { version: 1 } }, { returnDocument: 'before', projection: { 'booking.code': 1 } });
    if (!saved) throw conflict();
    await sec.audit(db, req, req.admin.username, 'appointment_cancelled_by_staff', saved.booking.code);
    res.json({ ok: true });
  });
  return router;
}
module.exports = { appointmentRoutes, adminAppointmentRoutes };
