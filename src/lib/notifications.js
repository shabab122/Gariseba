'use strict';
const { randomUUID } = require('node:crypto');
const config = require('../config');
const { normalizeEmail } = require('./validate');
const { STATUS_TEXT } = require('./business');

const maxAttempts = 4;
const retryWindowMs = 23 * 60 * 60 * 1000;
const emailReady = (email = config.email) => Boolean(email.key && normalizeEmail(email.from));

function statusEmail(row, status, email = config.email, now = new Date()) {
  const language = row.language === 'bn' ? 'bn' : 'en';
  const label = STATUS_TEXT[status][language];
  const trackUrl = new URL('/track', config.publicUrl).href;
  const subject = `GariSeba ${row.public_code} — ${label}`;
  const text = language === 'bn'
    ? `আপনার GariSeba অনুরোধ ${row.public_code}-এর স্ট্যাটাস এখন ${label}।\n\nট্র্যাকিং পাতা ${trackUrl}\nরেফারেন্স ও আপনার গোপন ট্র্যাকিং কী দিয়ে বিস্তারিত দেখুন। ট্র্যাকিং পাতা থেকে ইমেইল আপডেট বন্ধ করতে পারবেন।`
    : `Your GariSeba request ${row.public_code} is now ${label}.\n\nTracking page ${trackUrl}\nUse your reference and private tracking key to view the request. You can stop email updates from the tracking page.`;
  return {
    id: randomUUID(), status, state: 'pending', attempts: 0,
    created_at: now, next_attempt_at: now, expires_at: new Date(now.getTime() + retryWindowMs),
    payload: { from: email.from, to: [row.notification_email], subject, text },
  };
}

async function processEmailJob(db, { email = config.email, fetcher = fetch, now = new Date(), signal } = {}) {
  if (!emailReady(email) || signal?.aborted) return false;
  const claim = randomUUID();
  const leaseUntil = new Date(now.getTime() + 60000);
  const eligible = { $or: [
    { state: 'pending', next_attempt_at: { $lte: now } },
    { state: 'sending', claim_until: { $lte: now } },
  ] };
  const firstWaiting = { $arrayElemAt: [
    { $filter: { input: { $ifNull: ['$email_outbox', []] }, as: 'job', cond: { $in: ['$$job.state', ['pending', 'sending']] } } },
    0,
  ] };
  const row = await db.requests.findOneAndUpdate({
    state: 'submitted', consent_status_email: true,
    $expr: { $let: { vars: { first: firstWaiting }, in: { $or: [
      { $and: [{ $eq: ['$$first.state', 'pending'] }, { $lte: ['$$first.next_attempt_at', now] }] },
      { $and: [{ $eq: ['$$first.state', 'sending'] }, { $lte: ['$$first.claim_until', now] }] },
    ] } } },
    $and: [
      { $or: [{ notification_lock_until: { $exists: false } }, { notification_lock_until: { $lte: now } }] },
      { email_outbox: { $elemMatch: eligible } },
    ],
  }, {
    $set: {
      notification_lock_token: claim, notification_lock_until: leaseUntil,
      'email_outbox.$.state': 'sending', 'email_outbox.$.claim_token': claim, 'email_outbox.$.claim_until': leaseUntil,
    },
    $inc: { 'email_outbox.$.attempts': 1 },
  }, { returnDocument: 'after', projection: { _id: 1, email_outbox: 1 } });
  if (!row) return false;
  const job = row.email_outbox.find((item) => item.claim_token === claim);
  const condition = {
    _id: row._id, state: 'submitted', consent_status_email: true, notification_lock_token: claim,
    email_outbox: { $elemMatch: { id: job.id, state: 'sending', claim_token: claim } },
  };
  async function finish(state, fields = {}) {
    const updates = { 'email_outbox.$.state': state };
    for (const [key, value] of Object.entries(fields)) updates['email_outbox.$.' + key] = value;
    await db.requests.updateOne(condition, {
      $set: updates,
      $unset: { notification_lock_token: '', notification_lock_until: '', 'email_outbox.$.claim_token': '', 'email_outbox.$.claim_until': '' },
    });
  }
  if (job.expires_at <= now || job.attempts > maxAttempts) {
    await finish('failed', { last_error: job.expires_at <= now ? 'retry_window_expired' : 'attempt_limit_reached' });
    return true;
  }
  if (!await db.requests.findOne(condition, { projection: { _id: 1 } })) return true;
  try {
    const timeout = AbortSignal.timeout(12000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', signal: requestSignal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + email.key, 'Idempotency-Key': job.id },
      body: JSON.stringify(job.payload),
    });
    if (!response.ok) {
      const error = new Error('email_http_' + response.status);
      error.retryable = response.status === 429 || response.status === 409 || response.status >= 500;
      const header = response.headers.get('retry-after');
      const seconds = Number(header);
      error.retryAt = header && Number.isFinite(seconds)
        ? new Date(now.getTime() + Math.max(0, seconds) * 1000) : new Date(header || '');
      throw error;
    }
    const result = await response.json();
    if (typeof result.id !== 'string' || !result.id || result.id.length > 100) throw new Error('email_invalid_response');
    await finish('accepted', { provider_id: result.id, accepted_at: new Date(), last_error: null });
  } catch (error) {
    let code = /^email_http_\d{3}$/.test(error.message) ? error.message : 'email_network_error';
    if (error.name === 'TimeoutError' || error.name === 'AbortError') code = 'email_timeout';
    if (error.message === 'email_invalid_response' || error instanceof SyntaxError) code = 'email_invalid_response';
    const delay = [30000, 120000, 600000][Math.min(job.attempts - 1, 2)];
    const next = new Date(Math.max(now.getTime() + delay, Number(error.retryAt) || 0));
    const retry = error.retryable !== false && job.attempts < maxAttempts && next < job.expires_at;
    await finish(retry ? 'pending' : 'failed', { last_error: code, next_attempt_at: next });
  }
  return true;
}

function startEmailWorker(db) {
  if (!emailReady()) return async () => {};
  const controller = new AbortController();
  let timer;
  let running;
  function run() {
    running = processEmailJob(db, { signal: controller.signal })
      .catch((error) => console.warn('[email] Worker could not process a job:', error.name))
      .finally(() => {
        if (!controller.signal.aborted) {
          timer = setTimeout(run, 5000);
          timer.unref();
        }
      });
  }
  run();
  return async () => {
    controller.abort();
    clearTimeout(timer);
    await running;
  };
}

module.exports = { emailReady, statusEmail, processEmailJob, startEmailWorker };
