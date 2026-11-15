import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, downloadPdf, updateCsrf } from './api.js';
import { useApp } from './context.jsx';
import { Alert, dateTime, Field, PageIntro, Status } from './ui.jsx';
import { PaymentSummary } from './payments.jsx';

function AuthForm({ onSignedIn }) {
  const { t, errorText, refresh } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'), [name, setName] = useState(''), [username, setUsername] = useState('');
  const [password, setPassword] = useState(''), [recovery, setRecovery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const label = { login: t.customerSignIn, register: t.customerRegister, recover: t.recoverAccount };
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const body = mode === 'recover' ? { username, recovery_code: recovery, new_password: password } : { username, password, ...(mode === 'register' ? { name } : {}) };
      const result = await api('/customer/' + mode, { method: 'POST', body });
      updateCsrf(result.csrf); await onSignedIn(result);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <section className="panel record-panel">
    <div className="flex flex-wrap gap-2">{Object.entries(label).map(([value, text]) => <button type="button" className="btn btn-outline" key={value} aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); setPassword(''); setRecovery(''); setError(''); }}>{text}</button>)}</div>
    <h2>{label[mode]}</h2>
    <form className="admin-edit" onSubmit={submit}>
      {mode === 'register' && <Field id="customer-name" label={t.displayName}><input id="customer-name" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required autoComplete="name" disabled={busy} /></Field>}
      <Field id="customer-username" label={t.username} hint={t.usernameHint}><input id="customer-username" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={40} required autoComplete="username" spellCheck={false} disabled={busy} /></Field>
      {mode === 'recover' && <Field id="customer-recovery" label={t.recoveryCode} hint={t.recoverHelp}><input id="customer-recovery" type="password" value={recovery} onChange={e => setRecovery(e.target.value)} maxLength={32} autoComplete="off" required disabled={busy} /></Field>}
      <Field id="customer-password" label={mode === 'recover' ? t.newPassword : t.password} hint={mode === 'login' ? undefined : t.passwordHint}><input id="customer-password" type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={mode === 'login' ? undefined : 15} maxLength={72} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} /></Field>
      {error && <Alert>{error}</Alert>}<button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t.sending : label[mode]}</button>
    </form>
    <button type="button" className="text-link justify-self-start" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { const result = await api('/customer/logout', { method: 'POST', body: {} }); updateCsrf(result.csrf); await refresh(true); navigate('/request'); }
      catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>{t.continueGuest}</button>
  </section>;
}

function PasswordForm({ onChanged }) {
  const { t, errorText } = useApp();
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <details className="panel record-panel"><summary>{t.changePassword}</summary><form className="admin-edit mt-4" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const result = await api('/customer/password', { method: 'POST', body: { current_password: current, new_password: password } }); updateCsrf(result.csrf); setCurrent(''); setPassword(''); onChanged(result.recovery_code); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }}>
    <Field id="customer-current-password" label={t.currentPassword}><input id="customer-current-password" type="password" value={current} required maxLength={72} autoComplete="current-password" disabled={busy} onChange={e => setCurrent(e.target.value)} /></Field>
    <Field id="customer-new-password" label={t.newPassword} hint={t.passwordHint}><input id="customer-new-password" type="password" value={password} required minLength={15} maxLength={72} autoComplete="new-password" disabled={busy} onChange={e => setPassword(e.target.value)} /></Field>
    {error && <Alert>{error}</Alert>}<button className="btn btn-primary" disabled={busy} type="submit">{busy ? t.sending : t.savePassword}</button>
  </form></details>;
}

function ServiceDetail({ id, back }) {
  const { t, lang, errorText } = useApp();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setData(null);
    api('/customer/requests/' + id, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); });
    return () => controller.abort();
  }, [id, reload]);
  const row = data?.request;
  return <section className="panel record-panel">
    <button type="button" className="text-link" onClick={back}>{t.backHistory}</button>
    {error && <Alert>{error}</Alert>}
    {!row && !error && <p className="muted" role="status">{t.checking}</p>}
    {row && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2>{row.code}</h2><Status value={row.status} /></div>
      <p>{row.vehicle} · {t.requestTypes[row.request_type]}</p><p className="feedback-comment">{row.symptoms}</p>
      <p className="muted text-sm">{t.updated} · {dateTime(row.updated_at, lang)}</p>
      {row.arrival_eta && <p>{t.etaTitle}: {dateTime(row.arrival_eta, lang)}</p>}
      {row.final_bill_note && <p className="feedback-comment">{row.final_bill_note}</p>}
      {row.invoice && <>
        <PaymentSummary payment={row.payment} />
        <button className="btn btn-outline justify-self-start" disabled={busy} type="button" onClick={async () => {
          setBusy(true); setError(''); try { await downloadPdf('/customer/requests/' + id + '/invoice.pdf', { filename: row.invoice.number + '.pdf' }); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
        }}>{busy ? t.downloadingBill : t.downloadBill}</button>
      </>}
      {row.feedback && <div className="bill-note"><h3>{t.feedbackTitle}</h3><p>{row.feedback.rating} / 5</p><p className="feedback-comment">{row.feedback.comment}</p></div>}
      {data.appointment && <div className="bill-note"><h3>{t.currentAppointment}</h3><p>{dateTime(data.appointment.starts_at, lang)} – {dateTime(data.appointment.ends_at, lang)}</p></div>}
      {(['received', 'confirmed', 'in_progress'].includes(row.status) || data.appointment) && <Link className="btn btn-outline justify-self-start" to="/appointments" state={{ requestId: id }}>{t.appointmentsTitle}</Link>}
      <h3>{t.statusHistory}</h3><ol className="timeline">{row.history.map((entry, index) => <li key={index}><span className="timeline-dot" /><div><strong>{t.statusNames[entry.status]}</strong><span>{dateTime(entry.created_at, lang)}</span></div></li>)}</ol>
      <button className="text-link justify-self-start" type="button" onClick={() => setReload(value => value + 1)}>{t.refreshHistory}</button>
    </>}
  </section>;
}

function History() {
  const { t, lang, errorText } = useApp();
  const [page, setPage] = useState(1), [data, setData] = useState(null), [selected, setSelected] = useState(''), [reload, setReload] = useState(0);
  const [code, setCode] = useState(''), [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [linkError, setLinkError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    api('/customer/requests?page=' + page, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); });
    return () => controller.abort();
  }, [page, reload]);
  if (selected) return <ServiceDetail id={selected} back={() => { setSelected(''); setReload(value => value + 1); }} />;
  return <>
    <section className="panel record-panel">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2>{t.myServices}</h2><button className="text-link" type="button" onClick={() => setReload(value => value + 1)}>{t.refreshHistory}</button></div>
      {error && <Alert>{error}</Alert>}{!data && !error && <p role="status">{t.checking}</p>}
      {data?.requests.length === 0 && <p className="muted">{t.historyEmpty}</p>}
      <div className="appointment-list">{data?.requests.map(row => <article className="appointment-card" key={row._id}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3>{row.public_code}</h3><Status value={row.status} /></div>
        <p>{row.vehicle_make} {row.vehicle_model} · {t.requestTypes[row.request_type]}</p><small className="muted">{dateTime(row.created_at, lang)}</small>
        <button className="text-link justify-self-start" type="button" onClick={() => { setSelected(row._id); window.scrollTo(0, 0); }}>{t.openService}</button>
      </article>)}</div>
      {data && (page > 1 || data.hasNext) && <div className="pagination"><button className="btn btn-outline" type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t.historyPrevious}</button><span>{page}</span><button className="btn btn-outline" type="button" disabled={!data.hasNext} onClick={() => setPage(value => value + 1)}>{t.historyNext}</button></div>}
    </section>
    <section className="panel record-panel"><h2>{t.linkOldRequest}</h2><p className="muted">{t.linkHint}</p>
      <form className="admin-edit" onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setLinkError(''); setNotice('');
        try { await api('/customer/requests/link', { method: 'POST', body: { code, token } }); setCode(''); setToken(''); setPage(1); setReload(value => value + 1); setNotice(t.requestLinked); }
        catch (err) { setLinkError(errorText(err)); } finally { setBusy(false); }
      }}>
        <Field id="history-reference" label={t.reference}><input id="history-reference" value={code} maxLength={20} required autoComplete="off" disabled={busy} onChange={e => setCode(e.target.value)} /></Field>
        <Field id="history-key" label={t.trackingKey}><input id="history-key" type="password" value={token} maxLength={80} required autoComplete="off" disabled={busy} onChange={e => setToken(e.target.value)} /></Field>
        {linkError && <Alert>{linkError}</Alert>}{notice && <Alert kind="success">{notice}</Alert>}<button className="btn btn-primary" disabled={busy} type="submit">{busy ? t.sending : t.linkRequest}</button>
      </form>
    </section>
  </>;
}

export default function CustomerAccount() {
  const { t, refresh, errorText } = useApp();
  const [user, setUser] = useState(undefined), [error, setError] = useState(''), [recovery, setRecovery] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const controller = new AbortController(); api('/customer/me', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setUser(result.customer); }).catch(err => { if (!controller.signal.aborted) { setUser(null); setError(errorText(err)); } }); return () => controller.abort(); }, []);
  return <div className="container-narrow page-space customer-portal">
    <PageIntro eyebrow={t.myServices} title={t.accountTitle} description={t.accountIntro} />
    {error && <Alert>{error}</Alert>}
    {user === undefined && <p role="status">{t.checking}</p>}
    {user === null && <AuthForm onSignedIn={async result => { setUser(result.customer); setRecovery(result.recovery_code || ''); setError(''); await refresh(true); }} />}
    {user && <>
      <div className="panel record-panel"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{user.name} · {user.username}</strong><button className="btn btn-outline" disabled={busy} type="button" onClick={async () => {
        setBusy(true); setError(''); try { const result = await api('/customer/logout', { method: 'POST', body: {} }); updateCsrf(result.csrf); setUser(null); setRecovery(''); await refresh(true); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
      }}>{t.signOut}</button></div><div className="flex flex-wrap gap-3"><Link className="text-link" to="/request">{t.request}</Link><Link className="text-link" to="/appointments">{t.appointmentsTitle}</Link></div></div>
      {recovery && <section className="panel record-panel recovery-panel" role="status"><h2>{t.recoveryCode}</h2><p>{t.recoveryHelp}</p><input aria-label={t.recoveryCode} value={recovery} readOnly autoComplete="off" spellCheck={false} onFocus={e => e.target.select()} /></section>}
      <History key={user.username} /><PasswordForm onChanged={setRecovery} />
    </>}
  </div>;
}
