import { useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { api } from './api.js';
import { useMutation } from './admin-config.jsx';
import { Alert, Checkbox, Field } from './ui.jsx';
import { TechnicianAccount } from './technician-account.jsx';

const blank = { name: '', phone: '', active: true };

export function Technicians() {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [accountFor, setAccountFor] = useState(null);
  const mutation = useMutation(() => {
    setEditing(null);
    setReload((value) => value + 1);
  });
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api('/admin/technicians', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setRows(result.technicians); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [reload]);
  return <>
    <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / TECHNICIANS</p><h1>Technicians</h1><p className="muted">Manage the people available for request assignments.</p></div></div>
    {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Refresh list</button></Alert>}
    <section className="panel admin-config">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2>Technician roster</h2>
        <button type="button" className="btn btn-outline" onClick={() => setEditing(blank)}><Plus size={17} />Add technician</button>
      </div>
      {editing && <form className="admin-edit" onSubmit={(event) => {
        event.preventDefault();
        mutation.submit('/admin/technicians' + (editing._id ? '/' + editing._id : ''), {
          method: editing._id ? 'PATCH' : 'POST', body: editing,
        });
      }}>
        <Field id="technician-name" label="Technician name"><input id="technician-name" value={editing.name} maxLength={80} minLength={2} required onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
        <Field id="technician-phone" label="Phone number" optional><input id="technician-phone" value={editing.phone || ''} maxLength={30} type="tel" onChange={(event) => setEditing({ ...editing, phone: event.target.value })} /></Field>
        <Checkbox checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })}>Available for new assignments</Checkbox>
        {mutation.error && <Alert>{mutation.error} <button type="button" className="text-link" onClick={() => { setEditing(null); setReload((value) => value + 1); }}>Refresh list</button></Alert>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={mutation.busy}><Save size={17} />{mutation.busy ? 'Saving…' : 'Save technician'}</button>
          <button type="button" className="btn btn-outline" disabled={mutation.busy} onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </form>}
      {rows === null && !error && <p className="muted" role="status">Loading technicians…</p>}
      {rows?.length === 0 && <p className="muted">Add a technician to start assigning requests.</p>}
      {rows?.length > 0 && <ul className="config-list">{rows.map((row) => <li key={row._id} className="flex-wrap">
        <div className="min-w-0 [overflow-wrap:anywhere]"><strong>{row.name}</strong>{row.phone && <small>{row.phone}</small>}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="badge">{row.active ? 'Active' : 'Inactive'}</span>
          <button type="button" className="btn btn-quiet" onClick={() => setAccountFor(row)}>Login account</button>
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(row)}>Edit</button>
        </div>
      </li>)}</ul>}
    </section>
    {accountFor && <TechnicianAccount technician={accountFor} close={() => setAccountFor(null)} />}
  </>;
}
