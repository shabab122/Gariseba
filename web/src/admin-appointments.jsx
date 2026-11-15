import { useEffect, useState } from 'react';
import { useMutation } from './admin-config.jsx';
import { api } from './api.js';
import { Alert, dateTime, Field } from './ui.jsx';
export const dhakaDate = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka' }).format(date);

export function AdminAppointments({ role, open }) {
  const [date, setDate] = useState(dhakaDate(new Date(Date.now() + 86400000))), [hour, setHour] = useState('9');
  const [slots, setSlots] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const mutation = useMutation(() => setReload(value => value + 1));
  useEffect(() => {
    const controller = new AbortController(); setSlots(null); setError('');
    api('/admin/appointments?' + new URLSearchParams({ date }), { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setSlots(result.slots); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [date, reload]);
  return <>
    <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / APPOINTMENTS</p><h1>Appointments</h1><p className="muted">Publish one-hour service slots and review bookings. Times use Dhaka time. Each slot accepts one request.</p></div></div>
    <section className="panel record-panel">
      <Field id="staff-appointment-date" label="View date (Dhaka)"><input id="staff-appointment-date" type="date" value={date} required onChange={e => { if (e.target.value) setDate(e.target.value); }} disabled={mutation.busy} /></Field>
      {role !== 'viewer' && <form className="admin-edit" onSubmit={event => { event.preventDefault(); mutation.submit('/admin/appointments', { method: 'POST', body: { date, hour: Number(hour) } }); }}>
        <Field id="staff-appointment-hour" label="New slot starts at (Dhaka)"><select id="staff-appointment-hour" value={hour} onChange={e => setHour(e.target.value)} disabled={mutation.busy}>{Array.from({ length: 24 }, (_, index) => <option value={index} key={index}>{String(index).padStart(2, '0')}:00</option>)}</select></Field>
        <button className="btn btn-primary justify-self-start" type="submit" disabled={mutation.busy}>Publish one-hour slot</button>
      </form>}
      {mutation.error && <Alert>{mutation.error}</Alert>}{error && <Alert>{error}</Alert>}
      <button className="text-link justify-self-start" type="button" onClick={() => setReload(value => value + 1)} disabled={mutation.busy}>Refresh appointments</button>
      {!slots && !error && <p className="muted" role="status">Loading appointments…</p>}
      {slots?.length === 0 && <p className="muted">No slots published for this date.</p>}
      <div className="appointment-list">{slots?.map(slot => <article className="appointment-card" key={slot._id}>
        <h3>{dateTime(slot.starts_at)} – {dateTime(slot.ends_at)}</h3>
        <p className="muted">{slot.booking ? 'Booked · ' + slot.booking.code + ' · ' + slot.booking.customer_name : slot.active ? 'Open' : 'Closed'}</p>
        {slot.booking && <button className="text-link" type="button" onClick={() => open(slot.booking.request_id)}>View service request</button>}
        {role !== 'viewer' && (slot.booking
          ? <button type="button" className="btn btn-danger-outline" disabled={mutation.busy} onClick={() => mutation.submit('/admin/appointments/' + slot._id + '/cancel', { method: 'POST', body: { version: slot.version, booking_id: slot.booking.id } })}>Cancel booking</button>
          : new Date(slot.starts_at) > new Date() && <button type="button" className="btn btn-outline" disabled={mutation.busy} onClick={() => mutation.submit('/admin/appointments/' + slot._id, { method: 'PATCH', body: { version: slot.version, active: !slot.active } })}>{slot.active ? 'Close slot' : 'Reopen slot'}</button>)}
      </article>)}</div>
    </section>
  </>;
}
