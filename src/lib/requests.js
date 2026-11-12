'use strict';
const { HttpError } = require('./http');
const { sha256, safeEqualHex } = require('./security');
const { STATUS_TEXT } = require('./business');

const draftMs = 3 * 60 * 60 * 1000;
const submitted = { state: 'submitted' };
const statusHistory = (row) => row.history.map(({ status, created_at }) => ({ status, created_at }));
const publicProjection = {
  _id: 1, public_code: 1, tracking_token_hash: 1, status: 1, language: 1, request_type: 1,
  created_at: 1, updated_at: 1, history: 1, final_bill_note: 1, version: 1, consent_status_email: 1,
};

function draftRef(req) {
  const key = req.get('x-draft-key') || '';
  if (!req.session.draftId || !/^[a-f0-9-]{36}$/.test(key)) {
    throw new HttpError(400, 'draft', 'Open the request form again to start a fresh draft.');
  }
  return sha256(req.session.draftId + ':' + key);
}

async function ensureDraft(db, id) {
  await db.requests.updateOne({ _id: id }, {
    $setOnInsert: { state: 'draft', photos: [], expiresAt: new Date(Date.now() + draftMs) },
  }, { upsert: true });
}

async function findTracked(db, code, token) {
  if (typeof code !== 'string' || typeof token !== 'string' || code.length > 20 || token.length > 80) return null;
  const row = await db.requests.findOne({ ...submitted, public_code: code.trim().toUpperCase() }, { projection: publicProjection });
  const same = safeEqualHex(row?.tracking_token_hash || sha256('unused'), sha256(token.trim()));
  return row && same ? row : null;
}

function trackView(row, lang) {
  return {
    code: row.public_code, status: row.status, statusText: STATUS_TEXT[row.status][lang || row.language],
    request_type: row.request_type, created_at: row.created_at, updated_at: row.updated_at,
    technicianConfirmed: ['confirmed', 'in_progress', 'completed'].includes(row.status),
    final_bill_note: row.status === 'completed' ? row.final_bill_note : null,
    history: statusHistory(row), liveTracking: 'unavailable',
    emailUpdates: row.consent_status_email === true,
  };
}

async function deleteRequest(db, id) {
  // Replace the complete document atomically. Keep only a short-lived replay marker.
  const result = await db.requests.replaceOne({ _id: id, ...submitted }, {
    _id: id, state: 'deleted', expiresAt: new Date(Date.now() + draftMs),
  });
  return result.matchedCount === 1;
}

module.exports = { deleteRequest, draftMs, draftRef, ensureDraft, findTracked, submitted, trackView };
