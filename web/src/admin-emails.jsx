import { useMutation } from './admin-config.jsx';
import { Alert, dateTime } from './ui.jsx';

const labels = { pending: 'Queued', sending: 'Sending', accepted: 'Accepted by email service', failed: 'Failed', cancelled: 'Cancelled' };

export function RequestEmails({ row, role, refresh }) {
  const mutation = useMutation(refresh);
  const jobs = row.email_outbox || [];
  if (!row.consent_status_email && !jobs.length) return null;
  return <section className="panel record-panel">
    <h2>Email status updates</h2>
    <button type="button" className="text-link justify-self-start" disabled={mutation.busy} onClick={refresh}>Refresh email status</button>
    <p className="muted">{row.consent_status_email ? 'Customer opted in' : 'Customer stopped updates'}{row.consent_status_email && row.notification_email ? ' · ' + row.notification_email : ''}</p>
    {!jobs.length && <p className="muted">A status change will queue an email while the email service is configured.</p>}
    {mutation.error && <Alert>{mutation.error}</Alert>}
    <ul className="note-list">{jobs.slice().reverse().map((job) => <li key={job.id}>
      <strong className="block">{labels[job.state] || job.state} · {job.status.replaceAll('_', ' ')}</strong>
      <small className="block">{dateTime(job.created_at)}</small>
      {job.last_error && <p className="text-sm">Result code <code>{job.last_error}</code></p>}
      {job.state === 'pending' && job.attempts > 0 && <p className="muted text-sm">Next retry {dateTime(job.next_attempt_at, 'en', 'medium')}</p>}
      {job.state === 'failed' && row.consent_status_email && role !== 'viewer' && new Date(job.expires_at) > new Date() &&
        <button type="button" className="text-link" disabled={mutation.busy} onClick={() => mutation.submit('/admin/requests/' + row._id + '/emails/' + job.id + '/retry', { method: 'POST', body: {} })}>Retry failed email</button>}
    </li>)}</ul>
  </section>;
}
