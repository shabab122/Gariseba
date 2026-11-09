import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Clock3, KeyRound, LockKeyhole, NotebookPen, Search, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { useApp } from './context.jsx';
import { Alert, dateTime, Dialog, Field, PageIntro, Status } from './ui.jsx';

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

  async function check(event) {
    event.preventDefault();
    setBusy('lookup');
    setError('');
    setNotice('');
    setData(null);
    const keys = { code: code.trim(), token: token.trim() };
    try {
      setData(await api('/requests/lookup', { method: 'POST', body: { ...keys, language: lang } }));
      setMatched(keys);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  function open(action) {
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
        setData(null);
        setMatched(null);
        setCode('');
        setToken('');
      }
      setNotice(dialog === 'delete' ? t.deleted : t.correctSent);
      setDialog('');
    } catch (err) { setDialogError(errorText(err)); }
    finally { setBusy(''); }
  }

  return <div className="container-narrow page-space">
    <PageIntro eyebrow={t.trackLabel} title={t.trackTitle} description={t.trackIntro} />
    <form className="panel track-form" onSubmit={check}>
      <div className="track-icon"><KeyRound size={25} /></div>
      <Field id="reference" label={t.reference}>
        <input id="reference" value={code} placeholder="LN-7K2M9Q" maxLength={20} required autoComplete="off" spellCheck={false} onChange={(event) => { setCode(event.target.value); setData(null); }} />
      </Field>
      <Field id="tracking-token" label={t.trackingKey}>
        <input id="tracking-token" value={token} maxLength={80} type="password" required autoComplete="off" spellCheck={false} onChange={(event) => { setToken(event.target.value); setData(null); }} />
      </Field>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}><Search size={18} />{busy === 'lookup' ? t.checking : t.lookUp}</button>
    </form>
    {data && <section className="panel track-result" aria-label={t.status}>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="eyebrow"><Clock3 size={16} />{data.code}</span><Status value={data.status} /></div>
      <h2>{t.statusNames[data.status]}</h2>
      <p className="muted">{data.status === 'received' ? t.pending : data.technicianConfirmed ? t.confirmed : t.statusNames[data.status]}</p>
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
          <button type="button" className="btn btn-danger-outline" onClick={() => open('delete')}><Trash2 size={17} />{t.delete}</button>
        </div>
      </div>
    </section>}
    <Link to="/request" className="text-link mt-6">{t.request}<ArrowRight size={16} /></Link>
    {dialog && <Dialog title={dialog === 'delete' ? t.deleteTitle : t.correct} description={dialog === 'delete' ? t.deleteBody : null} onClose={() => !busy && setDialog('')}>
      <form className="dialog-form" onSubmit={change}>
        {dialog === 'correct' && <Field id="correction-note" label={t.correction}><textarea id="correction-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={600} rows={4} required /></Field>}
        {dialogError && <Alert>{dialogError}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-outline" type="button" onClick={() => setDialog('')} disabled={Boolean(busy)}>{t.cancel}</button>
          <button className={`btn ${dialog === 'delete' ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={Boolean(busy) || (dialog === 'correct' && note.trim().length < 3)}>
            {busy ? t.sending : dialog === 'delete' ? t.confirmDelete : t.correct}
          </button>
        </div>
      </form>
    </Dialog>}
  </div>;
}
