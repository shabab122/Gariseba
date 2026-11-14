import { useMutation } from './admin-config.jsx';
import { Alert, dateTime } from './ui.jsx';

const labels = { pending: 'Queued', sending: 'Sending', accepted: 'Accepted by SMS provider', failed: 'Failed', cancelled: 'Cancelled', unknown: 'Send outcome unknown' };
export function RequestSms({ row, role, refresh }) {
  const mutation = useMutation(refresh);
  const jobs = row.sms_outbox || [];
  return <section className="panel record-panel">
    <h2>SMS status updates</h2>
    <p className="muted">{row.consent_status_sms ? 'Customer opted in · ' + row.callback_phone : 'Customer has not opted in or stopped SMS updates.'}</p>
    {!jobs.length && row.consent_status_sms && <p className="muted text-sm">A status change queues an SMS while the SMS provider is configured.</p>}
    {jobs.length > 0 && <button type="button" className="text-link justify-self-start" disabled={mutation.busy} onClick={refresh}>Refresh SMS status</button>}
    {mutation.error && <Alert>{mutation.error}</Alert>}
    <ul className="note-list">{jobs.slice().reverse().map((job) => <li key={job.id}>
      <strong className="block">{labels[job.state] || job.state} · {job.status.replaceAll('_', ' ')}</strong>
      <small>{dateTime(job.created_at)}</small>
      {job.delivery && <p className="mt-2 text-sm">Provider status: <strong>{job.delivery.status}</strong><small className="block">Checked {dateTime(job.delivery.checked_at)}</small></p>}
      {job.delivery?.error_code && <p className="muted text-sm">Provider error {job.delivery.error_code}</p>}
      {job.last_error && <p className="muted text-sm">Result code <code>{job.last_error}</code></p>}
      {job.state === 'unknown' && <p className="muted text-sm">Check provider logs before any separate resend. The app will not resend an uncertain SMS.</p>}
      {job.state === 'accepted' && role !== 'viewer' && <button type="button" className="text-link mt-2" disabled={mutation.busy} onClick={() => mutation.submit('/admin/requests/' + row._id + '/sms/' + job.id + '/delivery', { method: 'POST', body: {} })}>Check SMS delivery</button>}
      {job.state === 'pending' && job.attempts > 0 && <p className="muted text-sm">Next attempt {dateTime(job.next_attempt_at)}</p>}
      {job.state === 'failed' && job.safe_rejected && job.attempts < 4 && row.consent_status_sms && role !== 'viewer' && new Date(job.expires_at) > new Date() &&
        <button type="button" className="text-link mt-2" disabled={mutation.busy} onClick={() => mutation.submit('/admin/requests/' + row._id + '/sms/' + job.id + '/retry', { method: 'POST', body: {} })}>Retry rejected SMS</button>}
    </li>)}</ul>
  </section>;
}
