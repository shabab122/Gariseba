'use strict';
const { HttpError } = require('./http');

const events = new Set(['sent', 'delivered', 'delivery_delayed', 'bounced', 'failed', 'complained', 'opened', 'clicked', 'suppressed', 'scheduled', 'queued', 'canceled']);

async function checkEmailDelivery(db, requestId, jobId, { email, fetcher = fetch, now = new Date() }) {
  const row = await db.requests.findOne({ _id: requestId, state: 'submitted', 'email_outbox.id': jobId }, {
    projection: { public_code: 1, email_outbox: { $elemMatch: { id: jobId } } },
  });
  if (!row) throw new HttpError(404, 'not_found', 'The email could not be found.');
  const job = row.email_outbox[0];
  if (job.state !== 'accepted' || typeof job.provider_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(job.provider_id)) {
    throw new HttpError(409, 'conflict', 'Delivery can be checked after the email service accepts the message.');
  }
  if (!email?.key) throw new HttpError(503, 'email_not_configured', 'The email service is not configured.');
  const nextCheck = new Date(now.getTime() + 30000);
  const condition = { _id: row._id, state: 'submitted', email_outbox: { $elemMatch: {
    id: jobId, state: 'accepted', provider_id: job.provider_id,
    $or: [{ delivery_next_check_at: { $exists: false } }, { delivery_next_check_at: { $lte: now } }],
  } } };
  const claimed = await db.requests.updateOne(condition, { $set: { 'email_outbox.$.delivery_next_check_at': nextCheck } });
  if (!claimed.matchedCount) throw new HttpError(429, 'rate_limited', 'Wait 30 seconds before checking this email again.');
  const updates = {};
  let failure;
  try {
    const response = await fetcher('https://api.resend.com/emails/' + encodeURIComponent(job.provider_id), {
      method: 'GET', headers: { Authorization: 'Bearer ' + email.key }, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const code = 'email_delivery_http_' + response.status;
      const message = response.status === 401 || response.status === 403
        ? 'Resend could not authorize this lookup. Check the API key and its permission to retrieve sent emails. Sending-only keys cannot retrieve delivery details.'
        : response.status === 429 ? 'Resend limited delivery checks. Try again later.' : 'The email service could not return delivery details. Try again later.';
      failure = new HttpError(response.status === 429 ? 429 : 502, code, message);
    } else {
      const result = await response.json();
      if (!result || typeof result !== 'object' || result.id !== job.provider_id || !events.has(result.last_event)) {
        failure = new HttpError(502, 'email_delivery_invalid_response', 'The email service returned an unsupported delivery result.');
      } else {
        updates.delivery = { event: result.last_event, checked_at: now };
        updates.delivery_error = null;
      }
    }
  } catch (error) {
    const code = error instanceof SyntaxError ? 'email_delivery_invalid_response'
      : error.name === 'TimeoutError' || error.name === 'AbortError' ? 'email_delivery_timeout' : 'email_delivery_network';
    failure = new HttpError(502, code, 'The delivery check could not finish. Try again later.');
  }
  if (failure) updates.delivery_error = failure.code;
  const set = Object.fromEntries(Object.entries(updates).map(([key, value]) => ['email_outbox.$.' + key, value]));
  const result = await db.requests.updateOne({ _id: row._id, state: 'submitted', email_outbox: { $elemMatch: {
    id: jobId, state: 'accepted', provider_id: job.provider_id, delivery_next_check_at: nextCheck,
  } } }, { $set: set });
  if (!result.matchedCount) throw new HttpError(409, 'conflict', 'This email or request changed during the check. Refresh the details.');
  if (failure) throw failure;
  return { ok: true, delivery: updates.delivery };
}

module.exports = { checkEmailDelivery };
