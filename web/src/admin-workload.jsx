import { useEffect, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { api } from './api.js';
import { Alert, dateTime } from './ui.jsx';

export function TechnicianWorkload({ refreshVersion }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api('/admin/technician-workload', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.technicians) || !result.unassigned || !result.totals) throw new Error('The workload could not be loaded. Try again.');
        setData(result);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [refreshVersion, reload]);
  return <section className="panel record-panel mb-4" aria-labelledby="workload-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="workload-title" className="flex items-center gap-2"><Users size={20} />Technician workload</h2>
        <p className="muted mt-1 text-sm">All open requests. Waiting includes Received and Confirmed. Queue filters apply to the request list below.</p>
      </div>
      <button type="button" className="btn btn-outline" disabled={!data && !error} onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} />Refresh workload</button>
    </div>
    {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Retry workload</button></Alert>}
    {!data && !error && <p className="muted text-sm" role="status">Loading workload…</p>}
    {data && <>
      <p className="text-sm" role="status"><strong>{data.totals.total}</strong> open requests · {data.totals.waiting} waiting · {data.totals.inProgress} in progress</p>
      <div className="table-scroll" tabIndex={0} aria-label="Technician workload table">
        <table className="staff-table workload-table"><thead><tr><th scope="col">Technician</th><th scope="col">Waiting</th><th scope="col">In progress</th><th scope="col">Total open</th></tr></thead>
          <tbody>{data.technicians.map((item) => <tr key={item.id} data-technician={item.id}>
            <th scope="row">{item.name}{item.active !== true && <small className="muted ml-2 font-normal">{item.active === false ? 'Inactive' : 'Unavailable'}</small>}</th>
            <td>{item.waiting}</td><td>{item.inProgress}</td><td><strong>{item.total}</strong></td>
          </tr>)}
          <tr data-technician="unassigned"><th scope="row">Unassigned</th><td>{data.unassigned.waiting}</td><td>{data.unassigned.inProgress}</td><td><strong>{data.unassigned.total}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <small className="muted">Updated {dateTime(data.generatedAt, 'en', 'medium')}. Refresh after changes made in another staff tab.</small>
    </>}
  </section>;
}
