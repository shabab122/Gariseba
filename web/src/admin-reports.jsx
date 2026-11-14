import { useEffect, useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { api, ApiError } from './api.js';
import { Alert, dateTime, Field } from './ui.jsx';
import { ReportCharts } from './report-charts.jsx';

const types = { battery: 'Battery help', repair: 'Repair', other: 'Other' };
const statuses = { received: 'Received', confirmed: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', out_of_area: 'Outside area' };
const day = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka' }).format(value);
const initial = () => ({
  from: day(new Date(Date.now() - 29 * 86400000)), to: day(new Date()), type: '', status: '',
});

export function Reports() {
  const [filters, setFilters] = useState(initial);
  const [draft, setDraft] = useState(filters);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [reload, setReload] = useState(0);
  const downloadController = useRef(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError('');
    api('/admin/reports?' + new URLSearchParams(filters), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.rows)) throw new Error('The report could not be loaded.');
        setReport(result);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [filters, reload]);
  function edit(event) {
    setDraft((current) => ({ ...current, [event.target.name]: event.target.value }));
  }
  async function download() {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setError('');
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
      const response = await fetch('/api/admin/reports.csv?' + new URLSearchParams(filters), { signal, cache: 'no-store' });
      if (!response.ok) throw new ApiError(response.status, await response.json().catch(() => ({})));
      const blob = await response.blob();
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gariseba-report-' + filters.from + '-to-' + filters.to + '.csv';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (!controller.signal.aborted) setError(err.name === 'TimeoutError' ? 'The download timed out. Try again.' : err.message);
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        setDownloading(false);
      }
    }
  }
  return <>
    <div className="admin-heading"><div><p className="eyebrow">OPERATIONS / REPORTS</p><h1>Request reports</h1><p className="muted">Count retained requests by received date, type and current status. Dates use Dhaka time.</p></div></div>
    <section className="panel admin-config">
      <form className="admin-edit" onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft }); }}>
        <div className="field-grid">
          <Field id="report-from" label="Received from (Dhaka)"><input id="report-from" name="from" type="date" value={draft.from} onChange={edit} required /></Field>
          <Field id="report-to" label="Received through (Dhaka)"><input id="report-to" name="to" type="date" value={draft.to} min={draft.from || undefined} onChange={edit} required /></Field>
          <Field id="report-type" label="Request type"><select id="report-type" name="type" value={draft.type} onChange={edit}><option value="">All types</option>{Object.entries(types).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
          <Field id="report-status" label="Current status"><select id="report-status" name="status" value={draft.status} onChange={edit}><option value="">All statuses</option>{Object.entries(statuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary"><Search size={17} />Show report</button>
          <button type="button" className="btn btn-outline" disabled={!report || downloading} onClick={download}><Download size={17} />{downloading ? 'Downloading…' : 'Download CSV'}</button>
        </div>
      </form>
      {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Retry report</button></Alert>}
      {!report && !error && <p className="muted" role="status">Loading report…</p>}
      {report && <>
        <div className="field-grid">
          <div><h2>Total requests</h2><p className="text-3xl font-bold" data-testid="report-total">{report.total}</p></div>
          <div><h3>Report period</h3><p>{report.from} — {report.to}</p><small className="muted">Generated {dateTime(report.generatedAt)}</small></div>
        </div>
        <ReportCharts report={report} types={types} statuses={statuses} />
        {!report.rows.length && <p className="muted">No requests match this report.</p>}
        {report.rows.length > 0 && <div className="table-scroll" tabIndex={0} aria-label="Request report table">
          <table className="staff-table"><thead><tr><th scope="col">Date (Dhaka)</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Requests</th></tr></thead>
            <tbody>{report.rows.map((row) => <tr key={[row.date, row.type, row.status].join('/')}><td>{row.date}</td><td>{types[row.type] || row.type}</td><td>{statuses[row.status] || row.status}</td><td>{row.count}</td></tr>)}</tbody>
          </table>
        </div>}
      </>}
    </section>
  </>;
}
