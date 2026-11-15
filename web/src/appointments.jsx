import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { useApp } from './context.jsx';
import { Alert, dateTime, Field, PageIntro } from './ui.jsx';
const day = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka' }).format(date);

export default function Appointments() {
  const { t, lang, errorText } = useApp(), location = useLocation();
  const requestId = typeof location.state?.requestId === 'string' ? location.state.requestId : '';
  const [code, setCode] = useState(location.state?.code || ''), [token, setToken] = useState(location.state?.token || '');
  const [date, setDate] = useState(day(new Date())), [slots, setSlots] = useState(null), [current, setCurrent] = useState(null), [matched, setMatched] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [slotError, setSlotError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setSlots(null); setSlotError('');
    api('/appointments/slots?' + new URLSearchParams({ date }), { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setSlots(result.slots); }).catch(err => { if (!controller.signal.aborted) setSlotError(errorText(err)); });
    return () => controller.abort();
  }, [date, reload]);
  useEffect(() => {
    if (!requestId) return;
    const controller = new AbortController();
    api('/appointments/current', { method: 'POST', body: { request_id: requestId }, signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setMatched({ request_id: requestId }); setCurrent(result); } }).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); });
    return () => controller.abort();
  }, [requestId]);
  async function verify(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice(''); setCurrent(null); setMatched(null);
    const access = { code: code.trim(), token: token.trim() };
    try { setCurrent(await api('/appointments/current', { method: 'POST', body: access })); setMatched(access); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function book(slot) {
    if (busy || !matched) return; setBusy(true); setError(''); setNotice('');
    try { const result = await api('/appointments/book', { method: 'POST', body: { ...matched, slot_id: slot._id, version: slot.version } }); setCurrent(value => ({ ...value, appointment: result.appointment })); setNotice(t.slotBooked); }
    catch (err) { setError(errorText(err)); try { setCurrent(await api('/appointments/current', { method: 'POST', body: matched })); } catch {} }
    finally { setBusy(false); setReload(value => value + 1); }
  }
  return <div className="container-narrow page-space customer-portal">
    <PageIntro eyebrow={t.appointmentsTitle} title={t.appointmentsTitle} description={t.appointmentsIntro} />
    {!requestId && <form className="panel record-panel admin-edit" onSubmit={verify}>
      <p className="muted">{t.bookingIntro}</p>
      <Field id="appointment-reference" label={t.reference}><input id="appointment-reference" value={code} required maxLength={20} autoComplete="off" disabled={busy} onChange={e => { setCode(e.target.value); setCurrent(null); setMatched(null); }} /></Field>
      <Field id="appointment-key" label={t.trackingKey}><input id="appointment-key" type="password" value={token} required maxLength={80} autoComplete="off" disabled={busy} onChange={e => { setToken(e.target.value); setCurrent(null); setMatched(null); }} /></Field>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t.sending : t.verifyRequest}</button>
    </form>}
    {error && <Alert>{error}</Alert>}{notice && <Alert kind="success">{notice}</Alert>}
    {current && <section className="panel record-panel"><h2>{current.code}</h2>
      {current.appointment ? <>
        <h3>{t.currentAppointment}</h3><p>{dateTime(current.appointment.starts_at, lang)} – {dateTime(current.appointment.ends_at, lang)}</p>
        {new Date(current.appointment.starts_at) > new Date() && <button className="btn btn-danger-outline justify-self-start" type="button" disabled={busy} onClick={async () => {
          if (busy) return; setBusy(true); setError(''); setNotice('');
          try { await api('/appointments/cancel', { method: 'POST', body: { ...matched, booking_id: current.appointment.booking_id } }); setCurrent(value => ({ ...value, appointment: null })); setNotice(t.slotCancelled); setReload(value => value + 1); }
          catch (err) { setError(errorText(err)); } finally { setBusy(false); }
        }}>{t.cancelAppointment}</button>}
      </> : <p className="muted">{current.canBook ? t.noAppointment : t.appointmentClosed}</p>}
    </section>}
    <section className="panel record-panel"><h2>{t.availableSlots}</h2>
      <Field id="appointment-date" label={t.appointmentDate}><input id="appointment-date" type="date" value={date} min={day(new Date())} max={day(new Date(Date.now() + 90 * 86400000))} required disabled={busy} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></Field>
      {slotError && <Alert>{slotError}</Alert>}{!slots && !slotError && <p role="status">{t.checking}</p>}
      {slots?.length === 0 && <p className="muted">{t.noSlots}</p>}
      <div className="appointment-list">{slots?.map(slot => <article className="appointment-card" key={slot._id}><h3>{dateTime(slot.starts_at, lang)}</h3><p className="muted">{dateTime(slot.ends_at, lang)}</p>
        <button className="btn btn-outline justify-self-start" type="button" disabled={busy || !matched || !current?.canBook || Boolean(current?.appointment)} onClick={() => book(slot)}>{t.bookAppointment}</button>
      </article>)}</div>
      <button className="text-link justify-self-start" type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>{t.retry}</button>
    </section>
    <div className="flex flex-wrap gap-4"><Link className="text-link" to="/request">{t.request}</Link><Link className="text-link" to="/account">{t.myServices}</Link></div>
  </div>;
}
