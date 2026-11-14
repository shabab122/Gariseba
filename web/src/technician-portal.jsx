import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ClipboardList, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from './api.js';
import { useMutation } from './admin-config.jsx';
import { ArrivalEtaField, dhakaEtaInput, etaRequestValue } from './arrival-eta.jsx';
import { ThemeButton } from './layout.jsx';
import { Alert, Brand, dateTime, Field, Status } from './ui.jsx';

const statuses = { received: 'Received', confirmed: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', out_of_area: 'Outside area' };
const openStatuses = ['received', 'confirmed', 'in_progress'];

function WorkUpdate({ row, refresh }) {
  const [status, setStatus] = useState(row.status);
  const [notes, setNotes] = useState(row.technician_notes || '');
  const [eta, setEta] = useState(dhakaEtaInput(row.arrival_eta));
  const mutation = useMutation(refresh);
  const open = openStatuses.includes(row.status);
  const options = open ? [row.status, row.status === 'in_progress' ? 'completed' : 'in_progress'] : [row.status];
  return <section className="panel record-panel"><h2>Work updates</h2>
    <form className="admin-edit" onSubmit={(event) => {
      event.preventDefault();
      mutation.submit('/admin/technician/requests/' + row._id, { method: 'PATCH', body: {
        version: row.version, status, technician_notes: notes,
        arrival_eta: eta !== dhakaEtaInput(row.arrival_eta) ? etaRequestValue(eta) : undefined,
      } });
    }}>
      <Field id="technician-work-status" label="Work status"><select id="technician-work-status" value={status} disabled={!open} onChange={(event) => { setStatus(event.target.value); if (event.target.value === 'completed') setEta(''); }}>
        {options.map((value) => <option value={value} key={value}>{statuses[value]}</option>)}
      </select></Field>
      <ArrivalEtaField id="technician-arrival-eta" value={eta} onChange={setEta} disabled={!open || status === 'completed'} />
      <Field id="technician-work-notes" label="Work notes (visible to staff)"><textarea id="technician-work-notes" value={notes} maxLength={4000} rows={5} readOnly={!open} onChange={(event) => setNotes(event.target.value)} /></Field>
      {mutation.error && <Alert>{mutation.error} <button type="button" className="text-link" onClick={refresh}>Refresh assignment</button></Alert>}
      {open ? <button type="submit" className="btn btn-primary" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : 'Save work update'}</button> : <p className="muted text-sm">This request is closed. Contact a dispatcher if it needs another change.</p>}
    </form>
  </section>;
}

function JobDetail({ id, back }) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function load(signal) {
    setError('');
    try { const result = await api('/admin/technician/requests/' + id, { signal }); if (!signal?.aborted) setRow(result.request); }
    catch (err) {
      if (signal?.aborted) return;
      if (err.status === 401 || err.status === 404) setRow(null);
      setError(err.message);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [id]);
  const fields = row && [
    ['Customer', row.customer_name], ['Callback', row.callback_phone], ['Location', row.location_text],
    ['Vehicle', [row.vehicle_make, row.vehicle_model, row.vehicle_year, row.fuel_type].filter(Boolean).join(' · ')],
    ['Registration', row.registration], ['Problem', row.symptoms], ['Request type', row.request_type], ['Urgency', row.urgency],
  ];
  return <>
    <button type="button" className="text-link" onClick={back}><ArrowLeft size={16} />Back to my requests</button>
    {error && <Alert>{error} <button type="button" className="text-link" onClick={() => load()}>Refresh assignment</button></Alert>}
    {!row && !error && <p className="muted mt-5">Loading assignment…</p>}
    {row && <>
      <div className="admin-heading"><div><p className="eyebrow">MY ASSIGNMENT</p><h1>{row.public_code}</h1><p className="muted">Received {dateTime(row.created_at)}</p></div><Status value={row.status} english /></div>
      {saved && <Alert kind="success">Work update saved.</Alert>}
      <div className="record-grid">
        <section className="panel record-panel"><h2>Assigned request details</h2>
          <dl className="admin-dl">{fields.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {row.map_lat != null && <a className="text-link" href={`https://maps.google.com/?q=${row.map_lat},${row.map_lng}`} target="_blank" rel="noreferrer">Open map pin<ArrowUpRight size={15} /></a>}
          {row.photos?.length > 0 && <><h3>Request photos</h3><div className="admin-photos">{row.photos.map((photo) => <a key={photo.upload_id} href={'/api/admin/technician/photos/' + encodeURIComponent(photo.upload_id)} target="_blank" rel="noreferrer">
            <img src={'/api/admin/technician/photos/' + encodeURIComponent(photo.upload_id)} alt={photo.label + ' photo'} loading="lazy" /><span>{photo.label}</span>
          </a>)}</div></>}
        </section>
        <WorkUpdate key={row.version} row={row} refresh={async () => { await load(); setSaved(true); }} />
      </div>
    </>}
  </>;
}

function MyRequests({ open }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api('/admin/technician/requests?' + new URLSearchParams({ status, page }), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.requests)) throw new Error('Your assignments could not be loaded.');
        setData(result);
      }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [status, page, reload]);
  return <>
    <div className="admin-heading"><div><p className="eyebrow">TECHNICIAN / ASSIGNMENTS</p><h1>My assigned requests</h1><p className="muted">Review your assignments, share arrival estimates and record work progress.</p></div></div>
    <section className="panel queue-panel">
      <div className="queue-toolbar">
        <Field id="my-request-status" label="Filter my requests"><select id="my-request-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">All statuses</option>{Object.entries(statuses).map(([key, value]) => <option value={key} key={key}>{value}</option>)}
        </select></Field>
        <button type="button" className="btn btn-outline" onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} />Refresh my requests</button>
      </div>
      {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Retry assignments</button></Alert>}
      {!data && !error && <p className="queue-state" role="status">Loading assignments…</p>}
      {data?.requests.length === 0 && <p className="queue-state">No requests are assigned to you in this view.</p>}
      {data?.requests.length > 0 && <div className="table-scroll" tabIndex={0} aria-label="My assigned requests table">
        <table className="staff-table"><thead><tr><th scope="col">Reference</th><th scope="col">Customer</th><th scope="col">Location</th><th scope="col">Status</th><th scope="col">Arrival estimate</th></tr></thead>
          <tbody>{data.requests.map((row) => <tr key={row._id}>
            <td><button type="button" className="text-link reference-link" onClick={() => open(row._id)}>{row.public_code}<ArrowUpRight size={14} /></button>{row.urgency === 'urgent' && <span className="table-warning">Urgent</span>}</td>
            <td>{row.customer_name}</td><td>{row.location_text}</td><td><Status value={row.status} english /></td><td>{dateTime(row.arrival_eta)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data && (data.page > 1 || data.hasNext) && <div className="pagination"><button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className="btn btn-outline" disabled={!data.hasNext || page >= 500} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
    </section>
  </>;
}

export function TechnicianPortal({ user, logout, loggingOut, logoutError }) {
  const [record, setRecord] = useState(null);
  function open(id) { setRecord(id); window.scrollTo(0, 0); }
  return <div className="admin-shell" lang="en">
    <aside className="admin-sidebar"><Brand staff /><nav aria-label="Technician navigation"><button type="button" className="active" aria-current="page" onClick={() => open(null)}><ClipboardList size={18} />My requests</button></nav><Link to="/" className="admin-public"><ArrowUpRight size={16} />Public site</Link></aside>
    <main className="admin-main"><header className="admin-top"><div><ShieldCheck size={17} /><strong>{user.username}</strong><span className="badge">Technician</span></div><div><ThemeButton /><button type="button" className="btn btn-outline" disabled={loggingOut} onClick={logout}><LogOut size={17} />{loggingOut ? 'Signing out…' : 'Sign out'}</button></div></header>
      <div className="admin-content">{logoutError && <Alert>{logoutError}</Alert>}{record ? <JobDetail key={record} id={record} back={() => open(null)} /> : <MyRequests open={open} />}</div>
    </main>
  </div>;
}
