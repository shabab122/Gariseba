import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { OpenAIConnection } from './admin-ai.jsx';
import { Alert, Checkbox, Dialog, Field } from './ui.jsx';

const categories = ['battery', 'tyre', 'brakes', 'engine', 'overheating', 'electrical', 'ac', 'fuel', 'other'];
const blankArea = { name_en: '', name_bn: '', keywords: '', active: true };
const blankRule = { code: '', label_en: '', label_bn: '', category: 'tyre', min_bdt: '', max_bdt: '', note_en: '', note_bn: '', active: true, sample: false };
const numberOrBlank = (value) => value === '' ? null : Number(value);

export function useMutation(onSaved) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(path, options) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api(path, options);
      setSaved(true);
      await onSaved?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally { setBusy(false); }
  }
  return { busy, error, saved, submit };
}

function SaveResult({ mutation }) {
  if (mutation.error) return <Alert>{mutation.error}</Alert>;
  if (mutation.saved) return <Alert kind="success">Changes saved.</Alert>;
  return null;
}

function EditField({ prefix, name, label, row, set, ...props }) {
  const id = prefix + '-' + name;
  return <Field id={id} label={label}><input {...props} id={id} value={row[name] ?? ''} onChange={(event) => set({ ...row, [name]: event.target.value })} /></Field>;
}

function SettingsForm({ initial }) {
  const [row, set] = useState(initial);
  const mutation = useMutation();
  const field = { row, set, prefix: 'settings' };
  return <form className="admin-edit" onSubmit={(event) => {
    event.preventDefault();
    mutation.submit('/admin/config/settings', { method: 'PUT', body: { ...row, battery_start_bdt: numberOrBlank(row.battery_start_bdt) } });
  }}>
    <h3>Battery fee and outside areas</h3>
    <EditField {...field} label="Battery starting charge (BDT)" name="battery_start_bdt" type="number" min={0} max={100000} required />
    <Field label="Outside-area keywords (comma separated)" id="outside-keywords">
      <textarea id="outside-keywords" rows={3} value={row.outside_keywords} maxLength={2000} onChange={(event) => set({ ...row, outside_keywords: event.target.value })} />
    </Field>
    <Checkbox checked={row.pricing_is_sample} onChange={(event) => set({ ...row, pricing_is_sample: event.target.checked })}>Mark all displayed rates as sample pricing</Checkbox>
    <SaveResult mutation={mutation} />
    <button type="submit" className="btn btn-primary" disabled={mutation.busy}><Save size={16} />{mutation.busy ? 'Saving…' : 'Save settings'}</button>
  </form>;
}

function AreaForm({ initial, onSaved }) {
  const [row, set] = useState(initial);
  const mutation = useMutation(onSaved);
  const field = { row, set, prefix: initial._id || 'new-area' };
  return <form className="admin-edit" onSubmit={(event) => {
    event.preventDefault();
    mutation.submit('/admin/config/areas', { method: 'POST', body: { ...row, id: initial._id } });
  }}>
    <div className="field-grid">
      <EditField {...field} label="Area name in English" name="name_en" maxLength={80} required />
      <EditField {...field} label="Area name in Bangla" name="name_bn" maxLength={80} required />
    </div>
    <EditField {...field} label="Matching keywords (comma separated)" name="keywords" maxLength={1500} />
    <Checkbox checked={row.active} onChange={(event) => set({ ...row, active: event.target.checked })}>Active in area checks</Checkbox>
    <SaveResult mutation={mutation} />
    <button type="submit" className="btn btn-primary" disabled={mutation.busy}><Save size={16} />{mutation.busy ? 'Saving…' : 'Save area'}</button>
  </form>;
}

function PricingForm({ initial, onSaved, onDeleted }) {
  const [row, set] = useState({ ...initial, code: initial._id || '' });
  const [removing, setRemoving] = useState(false);
  const mutation = useMutation(onSaved);
  const deletion = useMutation(onDeleted);
  const prefix = initial._id || 'new-rule';
  const field = { row, set, prefix };
  return <>
    <form className="admin-edit" onSubmit={(event) => {
      event.preventDefault();
      mutation.submit('/admin/config/pricing', { method: 'POST', body: {
        ...row, min_bdt: numberOrBlank(row.min_bdt), max_bdt: numberOrBlank(row.max_bdt),
      } });
    }}>
      <div className="field-grid">
        <EditField {...field} label="Rule code" name="code" readOnly={!!initial._id} pattern="[A-Za-z0-9_]{2,60}" maxLength={60} placeholder="tyre_labour" required />
        <Field id={prefix + '-category'} label="Issue category">
          <select id={prefix + '-category'} value={row.category} onChange={(event) => set({ ...row, category: event.target.value })}>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </Field>
        <EditField {...field} label="Price label in English" name="label_en" maxLength={100} required />
        <EditField {...field} label="Price label in Bangla" name="label_bn" maxLength={100} required />
        <EditField {...field} label="Minimum (BDT)" name="min_bdt" type="number" min={0} max={10000000} required />
        <EditField {...field} label="Maximum (BDT)" name="max_bdt" type="number" min={0} max={10000000} required />
        <EditField {...field} label="Price note in English" name="note_en" maxLength={200} />
        <EditField {...field} label="Price note in Bangla" name="note_bn" maxLength={200} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Checkbox checked={row.active} onChange={(event) => set({ ...row, active: event.target.checked })}>Active rule</Checkbox>
        <Checkbox checked={row.sample} onChange={(event) => set({ ...row, sample: event.target.checked })}>Mark this rule as sample</Checkbox>
      </div>
      <SaveResult mutation={mutation} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={mutation.busy}><Save size={16} />{mutation.busy ? 'Saving…' : 'Save price rule'}</button>
        {initial._id && <button type="button" className="btn btn-danger-outline" onClick={() => setRemoving(true)}><Trash2 size={16} />Delete rule</button>}
      </div>
    </form>
    {removing && <Dialog title="Delete this price rule?" description="New estimates will exclude this rule. Existing requests retain their estimate." onClose={() => !deletion.busy && setRemoving(false)}>
      <div className="dialog-form">
        {deletion.error && <Alert>{deletion.error}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-outline" disabled={deletion.busy} onClick={() => setRemoving(false)}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={deletion.busy} onClick={() => deletion.submit('/admin/config/pricing/' + initial._id, { method: 'DELETE' })}>Delete rule</button>
        </div>
      </div>
    </Dialog>}
  </>;
}

export function AdminConfig() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('settings');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');

  async function load() {
    setError('');
    try { setData(await api('/admin/config')); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);
  async function afterEdit() {
    setEditing(null);
    setNotice('Changes saved.');
    await load();
  }

  return <>
    <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / CONFIGURATION</p><h1>Service settings</h1><p className="muted">Manage coverage and the rules used to calculate estimates.</p></div></div>
    <OpenAIConnection />
    {error && <Alert>{error} <button className="text-link" type="button" onClick={load}>Retry</button></Alert>}
    {data ? <section className="panel admin-config">
      <div className="admin-tabs" role="group" aria-label="Configuration sections">
        {[['settings', 'Business settings'], ['areas', 'Service areas'], ['pricing', 'Price rules']].map(([key, label]) => <button type="button" key={key}
          className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => { setTab(key); setEditing(null); setNotice(''); }}>{label}</button>)}
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      {tab === 'settings' && <SettingsForm initial={data.settings} />}
      {tab !== 'settings' && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>{tab === 'areas' ? 'Service areas' : 'Price rules'}</h2>
          <button type="button" className="btn btn-outline" onClick={() => { setEditing(tab === 'areas' ? blankArea : blankRule); setNotice(''); }}><Plus size={16} />{tab === 'areas' ? 'Add area' : 'Add price rule'}</button>
        </div>
        {editing && <div className="admin-editor">
          <div className="flex justify-between gap-3"><h3>{editing._id ? 'Edit record' : 'New record'}</h3><button type="button" className="text-link" onClick={() => setEditing(null)}>Close editor</button></div>
          {tab === 'areas' ? <AreaForm key={editing._id || 'new'} initial={editing} onSaved={afterEdit} />
            : <PricingForm key={editing._id || 'new'} initial={editing} onSaved={afterEdit} onDeleted={afterEdit} />}
        </div>}
        <ul className="config-list">
          {data[tab].map((row) => <li key={row._id}><div>
            <strong>{row.name_en || row.label_en}</strong><small>{row.name_bn || row.label_bn}
              {tab === 'pricing' && ` · ৳${row.min_bdt}–৳${row.max_bdt} · ${row.category}`}</small>
          </div><div className="flex items-center gap-2"><span className="badge">{row.active ? 'Active' : 'Inactive'}</span>
            {row.sample && <span className="badge badge-sample">Sample</span>}<button type="button" className="btn btn-quiet" onClick={() => { setEditing(row); setNotice(''); }}>Edit</button></div></li>)}
        </ul>
        {!data[tab].length && <p className="muted">There are no records in this section.</p>}
      </>}
    </section> : !error && <p className="muted">Loading configuration…</p>}
  </>;
}
