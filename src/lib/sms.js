'use strict';
const { randomUUID } = require('node:crypto');
const config = require('../config');
const { normalizePhone } = require('./validate');
const { STATUS_TEXT } = require('./business');
const { HttpError } = require('./http');

const sidPattern = /^SM[0-9a-f]{32}$/i;
const deliveryStates = ['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'canceled'];
const maxAttempts = 4;
function readSmsConfig(env = process.env) {
  return {
    enabled: env.SMS_ENABLED === 'true', accountSid: (env.TWILIO_ACCOUNT_SID || '').trim(),
    authToken: (env.TWILIO_AUTH_TOKEN || '').trim(), from: (env.TWILIO_FROM || '').trim(),
    messagingServiceSid: (env.TWILIO_MESSAGING_SERVICE_SID || '').trim(),
  };
}
const defaultSms = readSmsConfig();
function smsReady(sms = defaultSms) {
  const senderReady = sms.messagingServiceSid ? /^MG[0-9a-f]{32}$/i.test(sms.messagingServiceSid) : /^\+[1-9]\d{7,14}$/.test(sms.from || '');
  return Boolean(sms.enabled && /^AC[0-9a-f]{32}$/i.test(sms.accountSid) && /^[0-9a-f]{32}$/i.test(sms.authToken) &&
    senderReady);
}
function statusSms(row, status, now = new Date()) {
  const lang = row.language === 'bn' ? 'bn' : 'en';
  const label = STATUS_TEXT[status][lang];
  const text = lang === 'bn'
    ? `GariSeba ${row.public_code}: ${label}। বিস্তারিত ও SMS বন্ধ করতে ${new URL('/track', config.publicUrl).href} পাতায় আপনার ট্র্যাকিং কী ব্যবহার করুন।`
    : `GariSeba ${row.public_code}: ${label}. Details or stop SMS: ${new URL('/track', config.publicUrl).href} (use your tracking key).`;
  return { id: randomUUID(), status, state: 'pending', attempts: 0, created_at: now, next_attempt_at: now,
    expires_at: new Date(now.getTime() + 60 * 60 * 1000), payload: { to: normalizePhone(row.callback_phone), text } };
}
function auth(sms) { return 'Basic ' + Buffer.from(sms.accountSid + ':' + sms.authToken).toString('base64'); }
function endpoint(sms, sid = '') {
  return 'https://api.twilio.com/2010-04-01/Accounts/' + sms.accountSid + '/Messages' + (sid ? '/' + sid : '') + '.json';
}

async function processSmsJob(db, { sms = defaultSms, fetcher = fetch, now = new Date(), signal } = {}) {
  if (!smsReady(sms) || signal?.aborted) return false;
  // A crashed/expired send may already have reached the provider. Never replay it.
  await db.requests.updateMany({ state: 'submitted', sms_outbox: { $elemMatch: { state: 'sending', claim_until: { $lte: now } } } }, {
    $set: { 'sms_outbox.$[expired].state': 'unknown', 'sms_outbox.$[expired].last_error': 'sms_send_interrupted' },
    $unset: { 'sms_outbox.$[expired].claim_token': '', 'sms_outbox.$[expired].claim_until': '' },
  }, { arrayFilters: [{ 'expired.state': 'sending', 'expired.claim_until': { $lte: now } }] });
  const firstWaiting = { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$sms_outbox', []] }, as: 'job', cond: { $in: ['$$job.state', ['pending', 'sending']] } } }, 0] };
  const claim = randomUUID();
  const row = await db.requests.findOneAndUpdate({
    state: 'submitted', consent_status_sms: true,
    $expr: { $let: { vars: { first: firstWaiting }, in: { $and: [
      { $eq: ['$$first.state', 'pending'] }, { $lte: ['$$first.next_attempt_at', now] },
    ] } } },
    $or: [{ sms_lock_until: { $exists: false } }, { sms_lock_until: { $lte: now } }],
    sms_outbox: { $elemMatch: { state: 'pending', next_attempt_at: { $lte: now } } },
  }, {
    $set: { sms_lock_token: claim, sms_lock_until: new Date(now.getTime() + 60000),
      'sms_outbox.$.state': 'sending', 'sms_outbox.$.claim_token': claim, 'sms_outbox.$.claim_until': new Date(now.getTime() + 60000) },
    $inc: { 'sms_outbox.$.attempts': 1 },
  }, { returnDocument: 'after', projection: { sms_outbox: 1 } });
  if (!row) return false;
  const job = row.sms_outbox.find((item) => item.claim_token === claim);
  const condition = { _id: row._id, state: 'submitted', consent_status_sms: true, sms_lock_token: claim,
    sms_outbox: { $elemMatch: { id: job.id, state: 'sending', claim_token: claim } } };
  async function finish(state, fields = {}) {
    const updates = { 'sms_outbox.$.state': state };
    for (const [key, value] of Object.entries(fields)) updates['sms_outbox.$.' + key] = value;
    await db.requests.updateOne(condition, { $set: updates, $unset: {
      sms_lock_token: '', sms_lock_until: '', 'sms_outbox.$.claim_token': '', 'sms_outbox.$.claim_until': '',
    } });
  }
  if (new Date(job.expires_at) <= now || job.attempts > maxAttempts || !normalizePhone(job.payload?.to)) {
    await finish('failed', { last_error: 'sms_job_expired_or_invalid', safe_rejected: false }); return true;
  }
  if (!await db.requests.findOne(condition, { projection: { _id: 1 } })) return true;
  let result;
  try {
    const body = new URLSearchParams({ To: job.payload.to, Body: job.payload.text, ValidityPeriod: '600' });
    if (sms.messagingServiceSid) body.set('MessagingServiceSid', sms.messagingServiceSid);
    else body.set('From', sms.from);
    const timeout = AbortSignal.timeout(12000);
    const response = await fetcher(endpoint(sms), { method: 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: auth(sms), 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (response.status === 429) {
      const delay = [30000, 120000, 600000][Math.min(job.attempts - 1, 2)];
      const next = new Date(now.getTime() + delay);
      const retry = job.attempts < maxAttempts && next < new Date(job.expires_at);
      await finish(retry ? 'pending' : 'failed', { last_error: 'sms_http_429', next_attempt_at: next, safe_rejected: true });
      return true;
    }
    if (!response.ok) {
      const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
      await finish(rejected ? 'failed' : 'unknown', { last_error: 'sms_http_' + response.status, safe_rejected: rejected });
      return true;
    }
    result = await response.json();
    if (!sidPattern.test(result.sid || '') || (result.account_sid && result.account_sid !== sms.accountSid) ||
        !deliveryStates.includes(result.status)) throw new Error('sms_invalid_response');
  } catch (error) {
    await finish('unknown', { last_error: error.message === 'sms_invalid_response' ? 'sms_invalid_response' : 'sms_network_or_timeout', safe_rejected: false });
    return true;
  }
  // Keep provider/DB failures distinct: an accepted send must never be replayed.
  await finish('accepted', { provider_id: result.sid, provider_account: sms.accountSid,
    accepted_at: now, last_error: null, safe_rejected: false,
    delivery: { status: result.status, checked_at: now, error_code: result.error_code == null ? null : String(result.error_code).slice(0, 10) } });
  return true;
}

async function checkSmsDelivery(db, requestId, jobId, { sms = defaultSms, fetcher = fetch, now = new Date() } = {}) {
  if (!smsReady(sms)) throw new HttpError(503, 'sms_unavailable', 'SMS service is not configured.');
  const row = await db.requests.findOne({ _id: requestId, state: 'submitted' }, { projection: { sms_outbox: 1 } });
  const job = row?.sms_outbox?.find((item) => item.id === jobId);
  if (!job || job.state !== 'accepted' || !sidPattern.test(job.provider_id) || job.provider_account !== sms.accountSid) throw new HttpError(409, 'sms_unavailable', 'This SMS has no checkable provider reference for the configured account.');
  if (job.delivery?.checked_at && now - new Date(job.delivery.checked_at) < 5000) return { delivery: job.delivery };
  let result;
  try {
    const response = await fetcher(endpoint(sms, job.provider_id), { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(12000), headers: { Authorization: auth(sms), Accept: 'application/json' } });
    if (!response.ok) throw new Error('unavailable');
    result = await response.json();
    if (result.sid !== job.provider_id || result.account_sid !== sms.accountSid || !deliveryStates.includes(result.status)) throw new Error('invalid');
  } catch { throw new HttpError(502, 'sms_provider', 'SMS delivery could not be checked. Try again later.'); }
  const delivery = { status: result.status, checked_at: now, error_code: result.error_code == null ? null : String(result.error_code).slice(0, 10) };
  const changed = await db.requests.updateOne({ _id: requestId, state: 'submitted', sms_outbox: { $elemMatch: {
    id: job.id, state: 'accepted', provider_id: job.provider_id,
    'delivery.checked_at': job.delivery?.checked_at || { $exists: false },
  } } }, { $set: { 'sms_outbox.$.delivery': delivery } });
  if (!changed.matchedCount) throw new HttpError(409, 'conflict', 'The request changed. Refresh the details.');
  return { delivery };
}

function startSmsWorker(db) {
  if (!smsReady()) return async () => {};
  const controller = new AbortController();
  let timer, running;
  function run() {
    running = processSmsJob(db, { signal: controller.signal })
      .catch((error) => console.warn('[sms] Worker could not process a job:', error.name))
      .finally(() => { if (!controller.signal.aborted) { timer = setTimeout(run, 5000); timer.unref(); } });
  }
  run();
  return async () => { controller.abort(); clearTimeout(timer); await running; };
}

module.exports = { defaultSms, readSmsConfig, smsReady, statusSms, processSmsJob, checkSmsDelivery, startSmsWorker };
