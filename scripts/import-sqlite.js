'use strict';
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { createReadStream, existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { connectDatabase, ensureDefaults } = require('../src/db');
const { settings: defaults } = require('../src/defaults');
const { processPhoto } = require('../src/lib/images');
const { sha256 } = require('../src/lib/security');

const date = (value) => value ? new Date(value.replace(' ', 'T') + 'Z') : null;
const legacyArea = (id) => `legacy-area-${id}`;
const markerId = 'sqlite-import';

async function sourceHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function importSqlite(db, file, uploads) {
  if (!existsSync(file) || existsSync(file + '-wal')) {
    throw new Error('Use a standalone legacy SQLite backup without a WAL file. Stop the old app or use its backup command.');
  }
  const hash = await sourceHash(file);
  const sqlite = new DatabaseSync(file, { readOnly: true });
  try {
    const values = Object.fromEntries(sqlite.prepare('SELECT key, value FROM settings').all().map(({ key, value }) => [key, value]));
    const marker = await db.settings.findOne({ _id: markerId });
    if (marker && marker.source !== hash) throw new Error('Use the same legacy backup to resume this import.');
    if (marker?.done) return { alreadyImported: true };
    if (!marker) {
      const collections = [db.settings, db.requests, db.areas, db.pricing, db.audit, db.adminUsers, db.sessions];
      const populated = await Promise.all(collections.map((collection) => collection.findOne({}, { projection: { _id: 1 } })));
      if (populated.some(Boolean)) throw new Error('Set MONGODB_DB to a fresh, unused database before importing.');
      await db.settings.insertOne({ _id: markerId, source: hash, done: false });
    }

    let requests = 0, photos = 0;
    const photosFor = sqlite.prepare('SELECT * FROM photos WHERE request_id = ? ORDER BY id');
    const historyFor = sqlite.prepare('SELECT * FROM status_history WHERE request_id = ? ORDER BY id');
    for (const old of sqlite.prepare('SELECT * FROM requests ORDER BY id').iterate()) {
      const id = sha256(`gariseba-sqlite-request:${old.id}`);
      const oldPhotos = photosFor.all(old.id);
      if (!await db.requests.findOne({ _id: id }, { projection: { _id: 1 } })) {
        const attached = [];
        for (const photo of oldPhotos) {
          if (!/^[a-f0-9]{48}\.jpg$/.test(photo.stored_name)) throw new Error(`Invalid legacy photo name for row ${photo.id}.`);
          const bytes = await readFile(path.join(uploads, photo.stored_name));
          const image = await processPhoto(bytes);
          attached.push({
            upload_id: photo.upload_id, label: photo.label || 'other', bytes: image.bytes,
            mime: image.mime, content: image.content, created_at: date(photo.created_at),
          });
        }
        const history = historyFor.all(old.id).map(({ status, actor, created_at }) => ({ status, actor, created_at: date(created_at) }));
        const {
          id: _id, area_id, consent_ai_photos, estimate_min, estimate_max, estimate_basis, ai_summary,
          ai_source, safety_flag, in_service_area, correction_requested, deletion_requested,
          consent_at, created_at, updated_at, consent_store, consent_whatsapp_share, ...data
        } = old;
        let basis = [];
        try {
          const parsed = JSON.parse(estimate_basis || '[]');
          if (Array.isArray(parsed)) basis = parsed.filter((row) => row && typeof row === 'object');
        } catch { /* a legacy estimate may have no item details */ }
        const estimated = estimate_min == null ? null : {
          min: estimate_min, max: estimate_max, currency: 'BDT',
          sample: values.pricing_is_sample !== '0' || basis.some((row) => /^sample_/i.test(row.code || '')), basis,
        };
        await db.requests.insertOne({
          _id: id, ...data, state: 'submitted', area_id: area_id == null ? null : legacyArea(area_id),
          safety_flag: Boolean(safety_flag), in_service_area: Boolean(in_service_area), correction_requested: Boolean(correction_requested),
          consent_store: Boolean(consent_store), consent_whatsapp_share: Boolean(consent_whatsapp_share),
          consent_at: date(consent_at), created_at: date(created_at), updated_at: date(updated_at),
          analysis: ai_summary ? { summary: ai_summary, source: ai_source === 'model' ? 'model' : 'fallback' } : null,
          estimate: estimated, photos: attached, history, corrections: [], version: 1,
        });
      }
      requests += 1;
      photos += oldPhotos.length;
    }

    const store = async (collection, id, row) => collection.updateOne({ _id: id }, { $setOnInsert: row }, { upsert: true });
    const areas = sqlite.prepare('SELECT * FROM service_areas ORDER BY id').all();
    for (const { id, active, ...area } of areas) await store(db.areas, legacyArea(id), { ...area, active: Boolean(active) });
    if (areas.length) await store(db.settings, 'default-areas', { initialized: true });
    for (const { id, code, active, ...rule } of sqlite.prepare('SELECT * FROM pricing_rules').iterate()) {
      await store(db.pricing, code, { ...rule, active: Boolean(active), sample: /^sample_/i.test(code) });
    }
    for (const user of sqlite.prepare('SELECT * FROM admin_users').iterate()) {
      await store(db.adminUsers, user.username, {
        passwordHash: user.password_hash, role: user.role, authVersion: 1,
        created_at: date(user.created_at), failedLogins: 0, lockedUntil: null,
      });
    }
    for (const { id, at, ...event } of sqlite.prepare('SELECT * FROM audit_log').iterate()) {
      await store(db.audit, `legacy-audit-${id}`, { ...event, at: date(at) });
    }
    await store(db.settings, 'business', {
      battery_start_bdt: Number(values.battery_start_bdt || defaults.battery_start_bdt),
      pricing_is_sample: values.pricing_is_sample !== '0',
      outside_keywords: values.outside_keywords ?? defaults.outside_keywords,
    });
    await ensureDefaults(db);
    await db.settings.updateOne({ _id: markerId }, { $set: { done: true, completedAt: new Date() } });
    return { requests, photos };
  } finally {
    sqlite.close();
  }
}

async function main() {
  const [file, uploads] = process.argv.slice(2);
  if (!file || !uploads) throw new Error('Usage: npm run import:sqlite -- <legacy.db> <legacy-uploads-folder>');
  const db = await connectDatabase();
  try {
    const result = await importSqlite(db, path.resolve(file), path.resolve(uploads));
    console.log(result.alreadyImported ? 'This backup is already imported.' : `Imported ${result.requests} requests and ${result.photos} photos. Verify the records before serving traffic.`);
  } finally {
    await db.client.close();
  }
}

if (require.main === module) main().catch((error) => {
  console.error('Import failed. Keep the original backup and resume with the same files.', error.name === 'Error' ? error.message : error.code || error.name);
  process.exitCode = 1;
});

module.exports = { importSqlite };
