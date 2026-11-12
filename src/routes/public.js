'use strict';
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { clean, LABELS, TYPES, validateRequest } = require('../lib/validate');
const { createAnalyzer, fallbackAnalyze } = require('../lib/ai');
const { matchArea, pricingInfo, estimateFor, STATUS_TEXT } = require('../lib/business');
const { buildMessage, clickToChatUrl } = require('../lib/whatsapp');
const { processPhoto } = require('../lib/images');
const { HttpError } = require('../lib/http');
const { deleteRequest, draftMs, draftRef, ensureDraft, findTracked, submitted, trackView } = require('../lib/requests');
const { emailReady } = require('../lib/notifications');
const sec = require('../lib/security');

const { photosPerRequest, photoMaxBytes } = config.limits;
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: photoMaxBytes, files: 1, fields: 1, fieldSize: 50, parts: 4 },
});
const photoProjection = { 'photos.content': 0 };
const unavailableDraft = () => new HttpError(409, 'draft_closed', 'This draft is closed or has expired. Start a new request.');
const missingTrack = () => new HttpError(404, 'not_found', 'No request matched that reference and tracking key.');
const langOf = (body) => body?.language === 'bn' ? 'bn' : 'en';

function receipt(row, token) {
  const whatsapp = row.consent_whatsapp_share ? buildMessage(row, { photoCount: row.photos.length }) : null;
  return {
    code: row.public_code, tracking_token: token, status: row.status, statusText: STATUS_TEXT[row.status][row.language],
    safety: row.safety_flag, photos_attached: row.photos.length, analysis: row.analysis, estimate: row.estimate,
    whatsapp: whatsapp ? { message: whatsapp, url: clickToChatUrl(whatsapp) } : null,
  };
}

function publicRoutes(db, limits, analyze = createAnalyzer(), email = config.email) {
  const router = express.Router();
  router.get('/bootstrap', async (req, res) => {
    const csrf = sec.ensureSession(req);
    res.json({
      csrf,
      business: { name: 'GariSeba', whatsappNumber: '+' + config.whatsappNumber, serviceArea: 'Dhaka' },
      ...(await pricingInfo(db)),
      integrations: { ai: config.aiConfigured ? 'configured' : 'fallback', malwareScan: Boolean(config.clam.host), statusEmail: emailReady(email) },
      limits: { photoMaxMB: photoMaxBytes / (1024 * 1024), photosPerRequest },
    });
  });

  router.post('/location/check', limits.chat, async (req, res) => {
    const text = clean(req.body?.location_text, 300);
    const result = await matchArea(db, text);
    res.json({ status: result.status, area: result.area ? { en: result.area.name_en, bn: result.area.name_bn } : null });
  });

  router.post('/chat/analyze', limits.chat, async (req, res) => {
    const b = req.body || {};
    const symptoms = clean(b.symptoms, 1000);
    if (symptoms.length < 3) throw new HttpError(422, 'validation', 'Enter a question or describe what is happening.');
    const input = {
      language: langOf(b), symptoms, request_type: TYPES.includes(b.request_type) ? b.request_type : 'repair',
      history: Array.isArray(b.history) ? b.history.slice(-4).map((item) => clean(item, 600)).filter(Boolean) : [],
      consent_ai: b.consent_ai === true, safety_flag: b.safety_flag === true,
    };
    const analysis = await analyze(input);
    const estimate = input.request_type === 'battery' || analysis.safety
      ? null : await estimateFor(db, analysis.category, input.language);
    res.json({ analysis, estimate, ...(await pricingInfo(db)) });
  });

  router.post('/photos', limits.upload, upload.single('photo'), async (req, res) => {
    const id = draftRef(req);
    if (!req.file) throw new HttpError(400, 'upload', 'Choose a photo to upload.');
    const key = req.get('x-photo-key') || '';
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new HttpError(400, 'upload', 'Start a new photo upload.');
    const uploadId = sec.sha256(id + ':' + key).slice(0, 40);
    const response = (photo, status) => res.status(status).json({
      upload_id: uploadId, bytes: photo.bytes, label: photo.label, scanned: photo.scanned === true,
    });
    await ensureDraft(db, id);
    const existing = await db.requests.findOne({ _id: id }, { projection: photoProjection });
    if (existing?.state !== 'draft' || existing.expiresAt <= new Date()) throw unavailableDraft();
    const previous = existing.photos.find((photo) => photo.upload_id === uploadId);
    if (previous) return response(previous, 200);
    if (existing.photos.length >= photosPerRequest) throw new HttpError(422, 'photo_limit', 'You can add up to five photos.');
    const saved = await processPhoto(req.file.buffer);
    const { scan, ...image } = saved;
    const photo = {
      upload_id: uploadId, label: LABELS.includes(req.body?.label) ? req.body.label : 'other',
      ...image, scanned: scan === 'clean', created_at: new Date(),
    };
    const result = await db.requests.updateOne({
      _id: id, state: 'draft', expiresAt: { $gt: new Date() },
      [`photos.${photosPerRequest - 1}`]: { $exists: false },
      'photos.upload_id': { $ne: uploadId },
    }, { $push: { photos: photo } });
    if (!result.matchedCount) {
      const current = await db.requests.findOne({ _id: id, state: 'draft', 'photos.upload_id': uploadId }, {
        projection: { 'photos.content': 0 },
      });
      const replay = current?.photos.find((item) => item.upload_id === uploadId);
      if (replay) return response(replay, 200);
      throw new HttpError(409, 'photo_conflict', 'The draft changed or already has five photos.');
    }
    response(photo, 201);
  });

  router.delete('/photos/:id', limits.upload, async (req, res) => {
    const result = await db.requests.updateOne({
      _id: draftRef(req), state: 'draft', 'photos.upload_id': req.params.id,
    }, { $pull: { photos: { upload_id: req.params.id } } });
    if (!result.modifiedCount) throw new HttpError(404, 'not_found', 'Photo unavailable in this draft.');
    res.json({ ok: true });
  });

  router.post('/requests', limits.submit, async (req, res) => {
    const { ok, errors, value } = validateRequest(req.body);
    if (!ok) throw new HttpError(422, 'validation', 'Check the request details.', { errors });
    if (value.consent_status_email && !emailReady(email)) {
      throw new HttpError(422, 'validation', 'Email updates are currently unavailable.', { errors: { notification_email: 'Email updates are currently unavailable.' } });
    }
    const id = draftRef(req);
    const token = sec.trackingToken(id);
    const confirm = req.body.confirm_dhaka === true;
    const { consent_status_email, notification_email, ...legacyValue } = value;
    const fingerprint = sec.sha256(JSON.stringify([consent_status_email ? value : legacyValue, confirm]));
    const replay = (row) => {
      if (row.fingerprint !== fingerprint || row.tracking_token_hash !== sec.sha256(token)) {
        throw new HttpError(409, 'already_submitted', 'This draft already has a submitted request. Retry with the original details.');
      }
      return res.json(receipt(row, token));
    };

    await ensureDraft(db, id);
    const draft = await db.requests.findOne({ _id: id });
    if (draft?.state === 'submitted') return replay(draft);
    if (draft?.state !== 'draft' || draft.expiresAt <= new Date()) throw unavailableDraft();
    const { photo_ids, ...details } = value;
    const photos = photo_ids.map((photoId) => draft.photos.find((photo) => photo.upload_id === photoId));
    if (photos.some((photo) => !photo)) throw new HttpError(409, 'photos_changed', 'One or more photos are missing from this draft.');

    const location = await matchArea(db, value.location_text);
    if (location.status === 'outside') throw new HttpError(422, 'outside_area', 'This request appears outside Dhaka.');
    if (location.status === 'unknown' && !confirm) throw new HttpError(422, 'confirm_area', 'Please confirm that the car is in Dhaka.');

    const analysis = fallbackAnalyze(details);
    const estimate = value.request_type === 'battery' || analysis.safety
      ? null : await estimateFor(db, analysis.category, value.language);
    const now = new Date();
    const fields = {
      ...details, state: 'submitted', status: 'received',
      area_id: location.area?._id ?? null, in_service_area: location.status === 'inside',
      tracking_token_hash: sec.sha256(token), fingerprint, photos, analysis, estimate,
      safety_flag: analysis.safety, consent_at: now, created_at: now, updated_at: now, version: 1,
      history: [{ status: 'received', actor: 'customer', created_at: now }], corrections: [], correction_requested: false,
      ...(value.consent_status_email ? { email_outbox: [] } : {}),
    };
    const condition = { _id: id, state: 'draft', expiresAt: { $gt: now } };
    if (photo_ids.length) condition['photos.upload_id'] = { $all: photo_ids };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = sec.publicCode();
      try {
        const row = await db.requests.findOneAndUpdate(condition, {
          $set: { ...fields, public_code: code }, $unset: { expiresAt: '' },
        }, { returnDocument: 'after', projection: photoProjection });
        if (!row) {
          const current = await db.requests.findOne({ _id: id }, { projection: photoProjection });
          if (current?.state === 'submitted') return replay(current);
          if (current?.state !== 'draft') throw unavailableDraft();
          throw new HttpError(409, 'photos_changed', 'This draft changed while sending. Check its photos and try again.');
        }
        await sec.audit(db, req, 'customer', 'request_created', code);
        return res.status(201).json(receipt(row, token));
      } catch (error) {
        if (error.code !== 11000 || !error.keyPattern?.public_code) throw error;
      }
    }
    throw new HttpError(503, 'reference', 'Could not assign a reference. Please try again.');
  });

  router.post('/requests/lookup', limits.lookup, async (req, res) => {
    const row = await findTracked(db, req.body?.code, req.body?.token);
    if (!row) throw missingTrack();
    res.json(trackView(row, req.body?.language ? langOf(req.body) : undefined));
  });

  router.post('/requests/privacy', limits.lookup, async (req, res) => {
    const row = await findTracked(db, req.body?.code, req.body?.token);
    if (!row) throw missingTrack();
    if (req.body.action === 'delete') {
      if (!await deleteRequest(db, row._id)) throw missingTrack();
      await sec.audit(db, req, 'customer', 'request_deleted_by_customer', row.public_code);
      return res.json({ ok: true });
    }
    if (req.body.action === 'stop_email') {
      if (!row.consent_status_email) return res.json({ ok: true });
      const result = await db.requests.updateOne({ _id: row._id, ...submitted }, {
        $set: { consent_status_email: false, 'email_outbox.$[waiting].state': 'cancelled' },
        $unset: { notification_lock_token: '', notification_lock_until: '' },
        $inc: { version: 1 },
      }, { arrayFilters: [{ 'waiting.state': { $in: ['pending', 'sending'] } }] });
      if (!result.matchedCount) throw missingTrack();
      await sec.audit(db, req, 'customer', 'status_email_stopped', row.public_code);
      return res.json({ ok: true });
    }
    if (req.body.action !== 'correct') throw new HttpError(400, 'bad_action', 'Choose an action.');
    const note = clean(req.body.note, 600);
    if (note.length < 3) throw new HttpError(422, 'validation', 'Describe what needs to be corrected.');
    const now = new Date();
    const result = await db.requests.updateOne({ _id: row._id, ...submitted }, {
      $set: { correction_requested: true, updated_at: now }, $inc: { version: 1 },
      $push: { corrections: { $each: [{ note, at: now }], $slice: -30 } },
    });
    if (!result.matchedCount) throw missingTrack();
    await sec.audit(db, req, 'customer', 'correction_requested', row.public_code);
    res.json({ ok: true });
  });
  return router;
}

module.exports = { publicRoutes };
