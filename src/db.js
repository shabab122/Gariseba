'use strict';
const { MongoClient } = require('mongodb');
const config = require('./config');
const defaults = require('./defaults');

async function connectDatabase({ uri = config.mongoUri, dbName = config.mongoDb } = {}) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000, maxPoolSize: 20, promoteBuffers: true,
  });
  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = Object.fromEntries(
      ['requests', 'sessions', 'adminUsers', 'settings', 'areas', 'pricing', 'audit', 'technicians']
        .map((name) => [name, db.collection(name)])
    );
    await Promise.all([
      collections.requests.createIndexes([
        { key: { public_code: 1 }, unique: true, sparse: true },
        { key: { state: 1, created_at: -1 } },
        { key: { state: 1, status: 1, created_at: -1 } },
        { key: { state: 1, 'photos.upload_id': 1 } },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
        { key: { state: 1, consent_status_email: 1, 'email_outbox.state': 1, 'email_outbox.next_attempt_at': 1 } },
      ]),
      collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collections.pricing.createIndex({ category: 1, active: 1, min_bdt: 1 }),
      collections.audit.createIndex({ at: -1 }),
      collections.audit.createIndex({ event: 1 }),
      collections.technicians.createIndex({ active: 1, name: 1 }),
      collections.adminUsers.createIndex({ technician_id: 1 }, { unique: true, partialFilterExpression: { role: 'technician', technician_id: { $type: 'string' } } }),
    ]);
    return { client, db, ...collections };
  } catch (error) {
    await client.close();
    throw error;
  }
}

async function ensureDefaults(db) {
  await db.settings.updateOne({ _id: 'business' }, { $setOnInsert: defaults.settings }, { upsert: true });
  const marker = await db.settings.findOne({ _id: 'default-areas' });
  if (!marker) {
    await db.areas.bulkWrite(defaults.areas.map(({ _id, ...area }) => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: area }, upsert: true },
    })));
    await db.settings.updateOne({ _id: 'default-areas' }, { $setOnInsert: { initialized: true } }, { upsert: true });
  }
}

async function businessSettings(db) {
  const { _id, ...values } = (await db.settings.findOne({ _id: 'business' })) || {};
  return { ...defaults.settings, ...values };
}

module.exports = { connectDatabase, ensureDefaults, businessSettings };
