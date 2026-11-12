'use strict';
const { loadEnvFile } = require('node:process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { normalizeEmail } = require('./lib/validate');

const root = path.join(__dirname, '..');
try { loadEnvFile(path.join(root, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const isProd = process.env.NODE_ENV === 'production';
function secret(name) {
  const value = process.env[name] || '';
  if (value.length >= 32) return value;
  if (isProd) throw new Error(`${name} needs at least 32 characters. Run npm run setup for local configuration.`);
  return randomBytes(32).toString('hex');
}
function number(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}
const port = number('PORT', 3000, 0, 65535);
const publicUrl = new URL(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`);
if (!['http:', 'https:'].includes(publicUrl.protocol) || (isProd && publicUrl.protocol !== 'https:')) {
  throw new Error('PUBLIC_BASE_URL must be a valid site URL (HTTPS in production).');
}
const whatsappNumber = (process.env.WHATSAPP_NUMBER ?? '8801608095085').replace(/[+\s-]/g, '');
if (!/^[1-9]\d{7,14}$/.test(whatsappNumber)) throw new Error('WHATSAPP_NUMBER must be an international number.');

const ai = {
  provider: (process.env.AI_PROVIDER || '').trim().toLowerCase(),
  key: (process.env.AI_API_KEY || '').trim(),
  model: (process.env.AI_MODEL || '').trim(),
};
const aiConfigured = ['openai', 'anthropic'].includes(ai.provider) && !!ai.key && !!ai.model;
const email = {
  key: (process.env.RESEND_API_KEY || '').trim(),
  from: normalizeEmail(process.env.NOTIFICATION_FROM) || '',
};

module.exports = {
  root, isProd, port, publicUrl, whatsappNumber, ai, aiConfigured, email,
  host: process.env.HOST || '127.0.0.1',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'gariseba',
  trustProxy: number('TRUST_PROXY_HOPS', 0, 0, 10),
  sessionSecret: secret('SESSION_SECRET'),
  ipSalt: secret('IP_HASH_SALT'),
  clam: { host: process.env.CLAMAV_HOST || '', port: number('CLAMAV_PORT', 3310, 1, 65535) },
  limits: { photoMaxBytes: 5 * 1024 * 1024, storedPhotoMaxBytes: 900 * 1024, photosPerRequest: 5 },
};
