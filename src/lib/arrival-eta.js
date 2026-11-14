'use strict';
const { HttpError } = require('./http');
const activeStatuses = ['received', 'confirmed', 'in_progress'];

function applyArrivalEta(row, fields, value, now = new Date()) {
  const status = fields.status || row.status;
  const technician = Object.hasOwn(fields, 'technician') ? fields.technician : row.technician;
  const reassigned = Object.hasOwn(fields, 'technician') && (fields.technician?.id || '') !== (row.technician?.id || '');
  if ((reassigned || !activeStatuses.includes(status)) && row.arrival_eta != null) fields.arrival_eta = null;
  if (value === undefined) return;
  if (value === null) {
    if (row.arrival_eta != null) fields.arrival_eta = null;
    return;
  }
  const invalid = () => new HttpError(422, 'validation', 'Choose an arrival estimate within the next 48 hours.');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw invalid();
  const eta = new Date(value);
  if (!Number.isFinite(eta.getTime()) || eta.toISOString().slice(0, 19) !== value.slice(0, 19)) throw invalid();
  if (!activeStatuses.includes(status) || !technician?.id) {
    throw new HttpError(422, 'validation', 'An arrival estimate needs an assigned technician and an open request.');
  }
  if (!reassigned && Number(row.arrival_eta) === eta.getTime()) return;
  if (eta < new Date(now.getTime() - 5 * 60000) || eta > new Date(now.getTime() + 48 * 3600000)) throw invalid();
  fields.arrival_eta = eta;
}

module.exports = { activeStatuses, applyArrivalEta };
