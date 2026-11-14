import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, BellOff, Clock3, KeyRound, LockKeyhole, NotebookPen, Search, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { useApp } from './context.jsx';
import { Alert, dateTime, Dialog, Field, PageIntro, Status } from './ui.jsx';

const activeStatuses = ['received', 'confirmed', 'in_progress'];
const refreshIntervalMs = 60_000;

export default function Track() {
  const { t, lang, errorText } = useApp();
  const loc = useLocation();
  const [code, setCode] = useState(loc.state?.code || '');
  const [token, setToken] = useState(loc.state?.token || '');
  const [data, setData] = useState(null);
  const [matched, setMatched] = useState(null);
  const [dialog, setDialog] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const refreshController = useRef(null);
  const autoRefresh = activeStatuses.includes(data?.status);

  useEffect(() => {
    if (!autoRefresh || !matched || busy || dialog) return;
    const controller = new AbortController();
    refreshController.current = controller;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (document.hidden || pending || controller.signal.aborted) return;
      pending = true;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        const result = await api('/requests/lookup', {
          method: 'POST', body: { ...matched, language: lang }, signal,
        });
        if (controller.signal.aborted) return;
        if (signal.aborted || !Object.hasOwn(t.statusNames, result.status) || !Array.isArray(result.history)) {
          throw new Error('Missing tracking details.');
        }
        setData(result);
        setRefreshError('');
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err.status === 404) {
          setData(null);
          setMatched(null);
          setError(errorText(err));
        } else {
          setRefreshError(errorText(err));
        }
      } finally {
        pending = false;
      }
    }, refreshIntervalMs);
    return () => {
      window.clearInterval(timer);
      controller.abort();
      refreshController.current = null;
    };
  }, [autoRefresh, matched, busy, dialog, lang, errorText, t.statusNames]);

  function clearResult() {
    refreshController.current?.abort();
    setMatched(null);
    setData(null);
    setError('');
    setRefreshError('');
  }

  async function check(event) {
    event.preventDefault();
    if (busy) return;
    clearResult();
    setBusy('lookup');
    setNotice('');
    const keys = { code: code.trim(), token: token.trim() };
    try {
      setData(await api('/requests/lookup', { method: 'POST', body: { ...keys, language: lang } }));
      setMatched(keys);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  function open(action) {
    refreshController.current?.abort();
    setNote('');
    setDialogError('');
    setDialog(action);
  }
  async function change(event) {
    event.preventDefault();
    if (!matched || busy) return;
    setDialogError('');
    setNotice('');
    setBusy(dialog);
    try {
      await api('/requests/privacy', { method: 'POST', body: { ...matched, action: dialog, note } });
      if (dialog === 'delete') {
        clearResult();
        setCode('');
        setToken('');
      }
      if (dialog === 'stop_email') setData((current) => ({ ...current, emailUpdates: false }));
      setNotice({ delete: t.deleted, correct: t.correctSent, stop_email: t.emailStopped }[dialog]);
      setDialog('');
    } catch (err) { setDialogError(errorText(err)); }
    finally { setBusy(''); }
  }

  return <div className="container-narrow page-space">
    <PageIntro eyebrow={t.trackLabel} title={t.trackTitle} description={t.trackIntro} />
    <form className="panel track-form" onSubmit={check}>
      <div className="track-icon"><KeyRound size={25} /></div>
      <Field id="reference" label={t.reference}>
        <input id="reference" value={code} placeholder="LN-7K2M9Q" maxLength={20} required autoComplete="off" spellCheck={false}
          disabled={busy === 'lookup'} onChange={(event) => { setCode(event.target.value); clearResult(); }} />
      </Field>
      <Field id="tracking-token" label={t.trackingKey}>
        <input id="tracking-token" value={token} maxLength={80} type="password" required autoComplete="off" spellCheck={false}
          disabled={busy === 'lookup'} onChange={(event) => { setToken(event.target.value); clearResult(); }} />
      </Field>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}><Search size={18} />{busy === 'lookup' ? t.checking : t.lookUp}</button>
    </form>
    {data && <section className="panel track-result" aria-label={t.status}>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="eyebrow"><Clock3 size={16} />{data.code}</span><Status value={data.status} /></div>
      <h2 aria-live="polite">{t.statusNames[data.status]}</h2>
      <p className="muted">{data.status === 'received' ? t.pending : data.technicianConfirmed ? t.confirmed : t.statusNames[data.status]}</p>
      <p className="muted text-sm">{t.updated} · <time dateTime={data.updated_at}>{dateTime(data.updated_at, lang, 'medium')}</time></p>
      {autoRefresh && <p className="muted text-sm">{t.trackAutoRefresh}</p>}
      {refreshError && <Alert kind="warning">{refreshError}</Alert>}
      {data.arrival_eta && <div className="bill-note"><h3>{t.etaTitle}</h3><p><time dateTime={data.arrival_eta}>{dateTime(data.arrival_eta, lang)}</time></p><p className="muted text-sm">{new Date(data.arrival_eta) < new Date() ? t.etaPassed : t.etaNote}</p></div>}
      <p className="muted">{t.live}</p>
      <h3>{t.statusHistory}</h3>
      <ol className="timeline">
        {data.history.map((item, index) => <li key={index}><span className="timeline-dot" /><div><strong>{t.statusNames[item.status]}</strong><span>{dateTime(item.created_at, lang)}</span></div></li>)}
      </ol>
      {data.final_bill_note && <div className="bill-note"><h3>{t.bill}</h3><p>{data.final_bill_note}</p></div>}
      <div className="track-actions">
        <h3><LockKeyhole size={17} />{t.manage}</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline" onClick={() => open('correct')}><NotebookPen size={17} />{t.correct}</button>
          {data.emailUpdates && <button type="button" className="btn btn-outline" onClick={() => open('stop_email')}><BellOff size={17} />{t.stopEmail}</button>}
          <button type="button" className="btn btn-danger-outline" onClick={() => open('delete')}><Trash2 size={17} />{t.delete}</button>
        </div>
      </div>
    </section>}
    <Link to="/request" className="text-link mt-6">{t.request}<ArrowRight size={16} /></Link>
    {dialog && <Dialog title={{ delete: t.deleteTitle, correct: t.correct, stop_email: t.stopEmailTitle }[dialog]} description={{ delete: t.deleteBody, stop_email: t.stopEmailBody }[dialog]} onClose={() => !busy && setDialog('')}>
      <form className="dialog-form" onSubmit={change}>
        {dialog === 'correct' && <Field id="correction-note" label={t.correction}><textarea id="correction-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={600} rows={4} required /></Field>}
        {dialogError && <Alert>{dialogError}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-outline" type="button" onClick={() => setDialog('')} disabled={Boolean(busy)}>{t.cancel}</button>
          <button className={`btn ${dialog === 'delete' ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={Boolean(busy) || (dialog === 'correct' && note.trim().length < 3)}>
            {busy ? t.sending : { delete: t.confirmDelete, correct: t.correct, stop_email: t.stopEmail }[dialog]}
          </button>
        </div>
      </form>
    </Dialog>}
  </div>;
}
