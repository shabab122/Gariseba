import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, ClipboardList, Gauge, History, LockKeyhole,
  Bell, ChartColumn, LogOut, RefreshCw, Search, Settings2, ShieldCheck, Trash2, TriangleAlert, Users,
} from 'lucide-react';
import { api, updateCsrf } from './api.js';
import { AdminConfig, useMutation } from './admin-config.jsx';
import { Technicians } from './admin-technicians.jsx';
import { Reports } from './admin-reports.jsx';
import { RequestEmails } from './admin-emails.jsx';
import { ThemeButton } from './layout.jsx';
import { Alert, Brand, Checkbox, dateTime, Dialog, Field, Status } from './ui.jsx';

const statusNames = { received: 'Received', confirmed: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', out_of_area: 'Outside area' };
const emptyQueueFilters = { code: '', type: '', urgency: '', from: '', to: '', technician: '' };

function QueueUpdates({ username, refresh, refreshed }) {
  const [total, setTotal] = useState(null);
  const [seen, setSeen] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const acknowledgeTo = useRef(null);
  const received = Math.max(0, (total ?? 0) - (seen ?? 0));
  useEffect(() => {
    if (acknowledgeTo.current !== null) {
      setSeen(acknowledgeTo.current);
      acknowledgeTo.current = null;
    }
  }, [refreshed]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function check() {
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
        const result = await api('/admin/queue-updates', { signal });
        if (controller.signal.aborted) return;
        if (!Number.isSafeInteger(result.totalReceived) || result.totalReceived < 0) throw new Error('Invalid queue update.');
        setTotal(result.totalReceived);
        setSeen((current) => current === null || current > result.totalReceived ? result.totalReceived : current);
        setError('');
      } catch {
        if (!controller.signal.aborted) setError('New-request alerts could not refresh. The next check will retry.');
      } finally {
        pending = false;
      }
    }
    check();
    const timer = window.setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      controller.abort();
    };
  }, [username, retry]);

  return <div className="mb-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="muted flex items-center gap-2 text-sm" role="status" aria-live="polite">
        <Bell size={16} />{received > 0 ? `${received} new request${received === 1 ? '' : 's'} received` : 'New-request alerts check every 30 seconds.'}
      </p>
      <button type="button" className="btn btn-outline" onClick={() => { acknowledgeTo.current = total; refresh(); }}>
        <RefreshCw size={16} />Refresh queue{received > 0 && <span className="badge">{received}</span>}
      </button>
    </div>
    {received > 0 && <p className="muted mt-2 text-sm">Refresh the queue to review arrivals. Your filters still apply.</p>}
    {error && <Alert kind="warning">{error} <button type="button" className="text-link" onClick={() => setRetry((value) => value + 1)}>Retry alerts</button></Alert>}
  </div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/admin/login', { method: 'POST', body: { username, password } });
      updateCsrf(result.csrf);
      onLogin(result.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="staff-auth" lang="en">
    <header className="container-wide staff-auth-header"><Brand staff /><div className="flex items-center gap-3"><ThemeButton /><Link to="/" className="text-link"><ArrowUpRight size={16} />Public site</Link></div></header>
    <main className="staff-login">
      <div className="staff-login-intro"><p className="eyebrow"><Gauge size={17} /> OPERATIONS</p><h1>Service desk<span>.</span></h1><p>Review roadside requests, keep customers informed, and manage service settings.</p></div>
      <form className="panel admin-edit" onSubmit={login}>
        <div className="track-icon"><LockKeyhole size={22} /></div>
        <h2>Staff sign in</h2>
        <Field id="username" label="Username"><input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={40} required /></Field>
        <Field id="staff-password" label="Password"><input id="staff-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></Field>
        {error && <Alert>{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={18} /></button>
      </form>
    </main>
  </div>;
}

function Queue({ username, open, refreshVersion, onLoaded }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const storedSearch = location.state?.staffQueueSearch;
  const search = storedSearch?.username === username && typeof storedSearch.term === 'string' ? storedSearch.term : '';
  const status = Object.hasOwn(statusNames, params.get('status')) ? params.get('status') : '';
  const pageValue = Number(params.get('page'));
  const page = Number.isInteger(pageValue) && pageValue >= 1 && pageValue <= 500 ? pageValue : 1;
  const code = params.get('code') || '';
  const type = params.get('type') || '';
  const urgency = params.get('urgency') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const technician = params.get('technician') || '';
  const filters = useMemo(() => ({ code, type, urgency, from, to, technician }), [code, type, urgency, from, to, technician]);
  const [draft, setDraft] = useState(filters);
  const [searchDraft, setSearchDraft] = useState(search);
  const [technicians, setTechnicians] = useState(null);
  const [technicianError, setTechnicianError] = useState('');
  const [technicianReload, setTechnicianReload] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => { setDraft(filters); }, [filters]);
  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setTechnicianError('');
    api('/admin/technicians', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setTechnicians(result.technicians); })
      .catch(() => { if (!controller.signal.aborted) setTechnicianError('The technician choices could not load.'); });
    return () => controller.abort();
  }, [technicianReload]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    const query = { status, ...filters, page };
    const request = search
      ? api('/admin/requests/search', { method: 'POST', body: { ...query, search }, signal: controller.signal })
      : api('/admin/requests?' + new URLSearchParams(query), { signal: controller.signal });
    request
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.requests)) throw new Error('The request list could not be loaded. Try again.');
        setData(result);
        onLoaded(refreshVersion);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [status, filters, search, page, reload, refreshVersion, onLoaded]);

  function updateView(values, nextSearch = search) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value === '' || value === 1) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { state: { ...location.state, staffQueueSearch: { username, term: nextSearch } } });
  }

  function editFilter(event) {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
  }
  function applyFilters(event) {
    event.preventDefault();
    const next = { ...draft, code: draft.code.trim() };
    const nextSearch = searchDraft.trim();
    const unchanged = page === 1 && nextSearch === search && Object.keys(filters).every((key) => next[key] === filters[key]);
    updateView({ ...next, page: 1 }, nextSearch);
    if (unchanged) setReload((value) => value + 1);
  }
  function clearFilters() {
    setDraft(emptyQueueFilters);
    setSearchDraft('');
    updateView({ ...emptyQueueFilters, status: '', page: 1 }, '');
  }

  const counts = data?.counts || {};
  return <>
    <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / REQUEST QUEUE</p><h1>Service requests</h1><p className="muted">Review incoming requests and post updates for customers.</p></div></div>
    <div className="queue-metrics">
      {[['Received', 'received'], ['Confirmed', 'confirmed'], ['In progress', 'in_progress'], ['Completed', 'completed']].map(([label, key]) =>
        <button key={key} type="button" className="panel metric" aria-pressed={status === key} onClick={() => updateView({ status: status === key ? '' : key, page: 1 })}><span>{label}</span><strong>{data ? counts[key] || 0 : '—'}</strong><ArrowDownLeft size={17} /></button>
      )}
    </div>
    <section className="panel queue-panel">
      <form className="queue-toolbar" onSubmit={applyFilters}>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="queue-status" label="Filter by status"><select id="queue-status" value={status} onChange={(event) => updateView({ status: event.target.value, page: 1 })}>
            <option value="">All statuses</option>{Object.entries(statusNames).map(([key, value]) => <option value={key} key={key}>{value}</option>)}
          </select></Field>
          <Field id="queue-type" label="Request type"><select id="queue-type" name="type" value={draft.type} onChange={editFilter}>
            <option value="">All types</option><option value="battery">Battery help</option><option value="repair">Repair</option><option value="other">Other</option>
          </select></Field>
          <Field id="queue-urgency" label="Urgency"><select id="queue-urgency" name="urgency" value={draft.urgency} onChange={editFilter}>
            <option value="">Any urgency</option><option value="normal">Normal</option><option value="urgent">Urgent</option>
          </select></Field>
          <Field id="queue-from" label="Received from (Dhaka)"><input id="queue-from" type="date" name="from" value={draft.from} onChange={editFilter} /></Field>
          <Field id="queue-to" label="Received through (Dhaka)"><input id="queue-to" type="date" name="to" min={draft.from || undefined} value={draft.to} onChange={editFilter} /></Field>
          <Field id="queue-search" label="Find a reference"><input id="queue-search" name="code" value={draft.code} maxLength={20} placeholder="LN-7K2M9Q" onChange={editFilter} /></Field>
          <Field id="queue-technician" label="Assigned technician"><select id="queue-technician" name="technician" value={draft.technician} onChange={editFilter}>
            <option value="">All technicians</option><option value="unassigned">Unassigned</option>
            {draft.technician && draft.technician !== 'unassigned' && !technicians?.some((item) => item._id === draft.technician) && <option value={draft.technician}>Selected technician (unavailable)</option>}
            {technicians?.map((item) => <option value={item._id} key={item._id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
          </select></Field>
          <Field id="queue-customer" label="Find customer by name or phone"><input id="queue-customer" value={searchDraft} maxLength={80} autoComplete="off" placeholder="Name or phone (3+ digits)" onChange={(event) => setSearchDraft(event.target.value)} /></Field>
        </div>
        {technicianError && <Alert>{technicianError} <button type="button" className="text-link" onClick={() => setTechnicianReload((value) => value + 1)}>Retry technician choices</button></Alert>}
        <button type="submit" className="btn btn-outline"><Search size={17} />Apply filters</button>
        <button type="button" className="text-link" onClick={clearFilters}>Clear filters</button>
      </form>
      {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setReload(reload + 1)}>Retry</button></Alert>}
      {!data && !error && <p className="queue-state" role="status">Loading requests…</p>}
      {data && !data.requests.length && <p className="queue-state">No requests match this view.</p>}
      {data?.requests.length > 0 && <div className="table-scroll" tabIndex={0} aria-label="Service requests table">
        <table className="staff-table"><thead><tr><th scope="col">Reference</th><th scope="col">Customer & vehicle</th><th scope="col">Location</th><th scope="col">Status</th><th scope="col">Received</th></tr></thead>
          <tbody>{data.requests.map((row) => <tr key={row._id}>
            <td><button className="text-link reference-link" type="button" onClick={() => open(row._id)}>{row.public_code}<ArrowUpRight size={14} /></button>
              {row.safety_flag && <span className="table-warning"><TriangleAlert size={13} />Safety flag</span>}
              {row.correction_requested && <span className="table-warning">Correction requested</span>}
            </td>
            <td><strong>{row.customer_name}</strong><small>{row.vehicle_make} {row.vehicle_model} · {row.request_type}</small>
              <small>{row.technician ? 'Assigned · ' + row.technician.name : 'Unassigned'}</small>
            </td>
            <td>{row.location_text}</td><td><Status value={row.status} english /></td><td>{dateTime(row.created_at)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data && (data.page > 1 || data.hasNext) && <div className="pagination">
        <button type="button" className="btn btn-outline" disabled={data.page <= 1} onClick={() => updateView({ page: page - 1 })}>Previous</button>
        <span>Page {data.page}</span>
        <button type="button" className="btn btn-outline" disabled={!data.hasNext || data.page >= 500} onClick={() => updateView({ page: page + 1 })}>Next</button>
      </div>}
    </section>
  </>;
}

function UpdateRequest({ row, role, refresh, back }) {
  const [status, setStatus] = useState(row.status);
  const [notes, setNotes] = useState(row.technician_notes || '');
  const [bill, setBill] = useState(row.final_bill_note || '');
  const [resolve, setResolve] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [technicianId, setTechnicianId] = useState(row.technician?.id || '');
  const [technicians, setTechnicians] = useState(null);
  const [technicianError, setTechnicianError] = useState('');
  const [technicianReload, setTechnicianReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setTechnicianError('');
    api('/admin/technicians', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setTechnicians(result.technicians); })
      .catch((err) => { if (!controller.signal.aborted) setTechnicianError(err.message); });
    return () => controller.abort();
  }, [technicianReload]);
  const change = useMutation(refresh);
  const removal = useMutation(back);
  const canEdit = role !== 'viewer';
  return <section className="panel record-panel">
    <h2>Staff updates</h2>
    <form className="admin-edit" onSubmit={(event) => {
      event.preventDefault();
      change.submit('/admin/requests/' + row._id, { method: 'PATCH', body: {
        version: row.version, status, technician_notes: notes, final_bill_note: bill,
        correction_requested: resolve ? false : undefined,
        technician_id: technicianId !== (row.technician?.id || '') ? technicianId : undefined,
      } });
    }}>
      <Field label="Request status" id="staff-status"><select id="staff-status" value={status} disabled={!canEdit} onChange={(event) => setStatus(event.target.value)}>
        {Object.entries(statusNames).map(([key, value]) => <option value={key} key={key}>{value}</option>)}
      </select></Field>
      <Field label="Assigned technician" id="staff-technician"><select id="staff-technician" value={technicianId} disabled={!canEdit || !technicians} onChange={(event) => setTechnicianId(event.target.value)}>
        <option value="">Unassigned</option>
        {row.technician && !technicians?.some((item) => item._id === row.technician.id) &&
          <option value={row.technician.id} disabled>{row.technician.name}</option>}
        {technicians?.map((item) => <option key={item._id} value={item._id} disabled={!item.active}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
      </select></Field>
      {technicianError && <Alert>{technicianError} <button type="button" className="text-link" onClick={() => setTechnicianReload((value) => value + 1)}>Refresh technicians</button></Alert>}
      {canEdit && technicians?.length === 0 && <p className="muted text-sm">An owner can add technicians from the Technicians section.</p>}
      <Field label="Internal technician notes" id="staff-notes"><textarea id="staff-notes" maxLength={4000} rows={4} value={notes} readOnly={!canEdit} onChange={(event) => setNotes(event.target.value)} /></Field>
      <Field label="Final bill note (visible to customer when completed)" id="staff-bill"><textarea id="staff-bill" maxLength={4000} rows={4} value={bill} readOnly={!canEdit} onChange={(event) => setBill(event.target.value)} /></Field>
      {row.correction_requested && canEdit && <Checkbox checked={resolve} onChange={(event) => setResolve(event.target.checked)}>Mark the correction as reviewed</Checkbox>}
      {change.error && <Alert>{change.error} {change.error.includes('Refresh') && <button type="button" className="text-link" onClick={refresh}>Refresh details</button>}</Alert>}
      {canEdit && <button type="submit" className="btn btn-primary" disabled={change.busy}>{change.busy ? 'Saving…' : 'Save request'}</button>}
    </form>
    {role === 'owner' && <button className="btn btn-danger-outline" type="button" onClick={() => setRemoving(true)}><Trash2 size={17} />Delete request</button>}
    {removing && <Dialog title="Permanently delete this request?" description="The active request, its photos and status history will be removed." onClose={() => !removal.busy && setRemoving(false)}>
      <div className="dialog-form">
        {removal.error && <Alert>{removal.error}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-outline" disabled={removal.busy} onClick={() => setRemoving(false)}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={removal.busy} onClick={() => removal.submit('/admin/requests/' + row._id, { method: 'DELETE' })}>Delete request</button>
        </div>
      </div>
    </Dialog>}
  </section>;
}

function Record({ id, role, back }) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);
  async function load(signal) {
    setError('');
    try { setRow((await api('/admin/requests/' + id, { signal })).request); }
    catch (err) { if (err.name !== 'AbortError') setError(err.message); }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [id]);
  const fields = row && [
    ['Name', row.customer_name], ['Callback', row.callback_phone], ['Contact language', row.language === 'bn' ? 'Bangla' : 'English'],
    ['Location', row.location_text], ['Area check', row.in_service_area ? 'Area matched' : 'Customer confirmed Dhaka'],
    ['Vehicle', [row.vehicle_make, row.vehicle_model, row.vehicle_year, row.fuel_type].filter(Boolean).join(' · ')],
    ['Registration', row.registration], ['Recent maintenance', row.maintenance_history], ['Problem', row.symptoms], ['Started', row.started_when],
    ['Type', row.request_type], ['Urgency', row.urgency], ['Requested next step', row.next_step.replaceAll('_', ' ')],
    ['Assigned technician', row.technician?.name || 'Unassigned'],
    ['Initial guidance', row.analysis?.summary], ['Price estimate', row.estimate && `৳${row.estimate.min}–৳${row.estimate.max}${row.estimate.sample ? ' (sample)' : ''}`],
  ];
  return <>
    <button type="button" className="text-link" onClick={back}><ArrowLeft size={16} />Back to queue</button>
    {error && <Alert>{error} <button type="button" className="text-link" onClick={() => load()}>Retry</button></Alert>}
    {!row && !error && <p className="muted mt-5">Loading request…</p>}
    {row && <>
      <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / REQUEST DETAIL</p><h1>{row.public_code}</h1><p className="muted">Received {dateTime(row.created_at)}</p></div><Status value={row.status} english /></div>
      {updated && <Alert kind="success">Request refreshed.</Alert>}
      {row.safety_flag && <Alert kind="warning">The customer reported a safety concern. Review this request promptly.</Alert>}
      <div className="record-grid">
        <section className="panel record-panel">
          <h2>Request details</h2>
          <dl className="admin-dl">{fields.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {row.map_lat != null && <a className="text-link" href={`https://maps.google.com/?q=${row.map_lat},${row.map_lng}`} target="_blank" rel="noreferrer">Open map pin<ArrowUpRight size={15} /></a>}
          {row.photos.length > 0 && <><h3>Private photos</h3><div className="admin-photos">{row.photos.map((photo) => <a key={photo.upload_id} href={`/api/admin/photos/${photo.upload_id}`} target="_blank" rel="noreferrer">
            <img src={`/api/admin/photos/${photo.upload_id}`} alt={photo.label + ' photo'} loading="lazy" /><span>{photo.label}</span>
          </a>)}</div></>}
          {row.corrections?.length > 0 && <><h3>Customer corrections</h3><ul className="note-list">{row.corrections.map((item, index) =>
            <li key={index}><small>{dateTime(item.at)}</small><p>{item.note}</p></li>)}</ul></>}
        </section>
        <div className="record-side">
          <UpdateRequest key={row.version} row={row} role={role} refresh={async () => { await load(); setUpdated(true); }} back={back} />
          <RequestEmails row={row} role={role} refresh={() => load()} />
          <section className="panel record-panel"><h2>Assignment history</h2>
            {row.assignment_history?.length > 0 ? <ol className="timeline">
              {row.assignment_history.map((item, index) => <li key={index}><span className="timeline-dot" /><div>
                <strong>{item.from?.name || 'Unassigned'} → {item.to?.name || 'Unassigned'}</strong>
                <span>{item.actor} · {dateTime(item.created_at)}</span>
              </div></li>)}
            </ol> : <p className="muted text-sm">Assignment changes saved from version 2.4 appear here.</p>}
          </section>
          <section className="panel record-panel"><h2>Status history</h2><ol className="timeline">
            {row.history.map((item, index) => <li key={index}><span className="timeline-dot" /><div><strong>{statusNames[item.status]}</strong><span>{item.actor} · {dateTime(item.created_at)}</span></div></li>)}
          </ol></section>
        </div>
      </div>
    </>}
  </>;
}

function AuditLog() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api('/admin/audit', { signal: controller.signal }).then((data) => setEvents(data.events))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [version]);
  return <>
    <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / AUDIT</p><h1>Activity log</h1><p className="muted">The latest staff and request events.</p></div></div>
    {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setVersion(version + 1)}>Retry</button></Alert>}
    <section className="panel queue-panel">
      {!events && !error && <p className="queue-state">Loading events…</p>}
      {events?.length === 0 && <p className="queue-state">No events yet.</p>}
      {events?.length > 0 && <div className="table-scroll" tabIndex={0} aria-label="Audit events">
        <table className="staff-table"><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Event</th><th scope="col">Target</th></tr></thead>
          <tbody>{events.map((item) => <tr key={item._id}><td>{dateTime(item.at)}</td><td>{item.actor}</td><td>{item.event.replaceAll('_', ' ')}</td><td>{item.target || '—'}</td></tr>)}</tbody></table>
      </div>}
    </section>
  </>;
}

export default function Admin() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState('queue');
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [queueLoaded, setQueueLoaded] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('/admin/me', { signal: controller.signal }).then((result) => setUser(result.user))
      .catch((err) => { if (err.name !== 'AbortError') setUser(null); });
    window.scrollTo(0, 0);
    return () => controller.abort();
  }, []);
  function open(id) {
    setRecord(id);
    window.scrollTo(0, 0);
  }
  async function logout() {
    setLoggingOut(true);
    setError('');
    try {
      await api('/admin/logout', { method: 'POST' });
      updateCsrf();
      setUser(null);
      setTab('queue');
      setRecord(null);
    } catch (err) { setError(err.message); }
    finally { setLoggingOut(false); }
  }
  if (user === undefined) return <main className="container-wide py-12"><Brand staff /><p className="muted mt-5" role="status">Opening the staff portal…</p></main>;
  if (!user) return <Login onLogin={setUser} />;

  const sections = [['queue', 'Requests', ClipboardList]];
  if (user.role === 'owner') sections.push(
    ['technicians', 'Technicians', Users], ['reports', 'Reports', ChartColumn],
    ['settings', 'Service settings', Settings2], ['audit', 'Activity log', History],
  );
  return <div className="admin-shell" lang="en">
    <aside className="admin-sidebar">
      <Brand staff />
      <nav aria-label="Staff navigation">{sections.map(([id, label, Icon]) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setRecord(null); }}>
        <Icon size={18} />{label}
      </button>)}</nav>
      <Link to="/" className="admin-public"><ArrowUpRight size={16} />Public site</Link>
    </aside>
    <main className="admin-main">
      <header className="admin-top"><div><ShieldCheck size={17} /><strong>{user.username}</strong><span className="badge">{user.role}</span></div><div><ThemeButton />
        <button className="btn btn-outline" type="button" onClick={logout} disabled={loggingOut}><LogOut size={17} />{loggingOut ? 'Signing out…' : 'Sign out'}</button></div></header>
      <div className="admin-content">
        {error && <Alert>{error}</Alert>}
        <QueueUpdates key={user.username} username={user.username} refreshed={queueLoaded} refresh={() => {
          setTab('queue');
          open(null);
          setQueueVersion((value) => value + 1);
        }} />
        {tab === 'queue' && (record ? <Record key={record} id={record} role={user.role} back={() => open(null)} /> : <Queue username={user.username} open={open} refreshVersion={queueVersion} onLoaded={setQueueLoaded} />)}
        {tab === 'settings' && <AdminConfig />}
        {tab === 'technicians' && <Technicians />}
        {tab === 'reports' && <Reports />}
        {tab === 'audit' && <AuditLog />}
      </div>
    </main>
  </div>;
}
