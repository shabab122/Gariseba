import { useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { downloadPdf } from './api.js';
import { useMutation } from './admin-config.jsx';
import { Alert, dateTime, Field } from './ui.jsx';

const blankItem = () => ({ description: '', quantity: 1, unit_bdt: '' });
const amount = (value) => (value / 100).toFixed(2);
export function RequestInvoice({ row, role, refresh }) {
  const [items, setItems] = useState(() => row.invoice?.items.map((item) => ({ description: item.description, quantity: item.quantity, unit_bdt: amount(item.unit_poisha) })) || [blankItem()]);
  const [discount, setDiscount] = useState(row.invoice ? amount(row.invoice.discount_poisha) : '0');
  const [notes, setNotes] = useState(row.invoice?.notes ?? row.final_bill_note?.slice(0, 1500) ?? '');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const mutation = useMutation(refresh);
  const canEdit = role !== 'viewer';
  const ready = row.status === 'completed';
  function update(index, name, value) { setItems((current) => current.map((item, position) => position === index ? { ...item, [name]: value } : item)); }
  async function download() {
    if (downloading) return;
    setDownloading(true); setDownloadError('');
    try { await downloadPdf('/admin/requests/' + row._id + '/invoice.pdf', { filename: row.invoice.number + '.pdf' }); }
    catch (err) { setDownloadError(err.message); }
    finally { setDownloading(false); }
  }
  return <section className="panel record-panel">
    <h2>PDF service bill</h2>
    {!ready && <p className="muted">Complete the service to issue or download the final bill.</p>}
    {row.invoice && <div className="bill-note">
      <strong>{row.invoice.number} · Revision {row.invoice.revision}</strong>
      <p>Total BDT {amount(row.invoice.total_poisha)}</p>
      <small className="block muted">Updated {dateTime(row.invoice.updated_at)}</small>
      {ready && <button className="btn btn-outline mt-2" type="button" disabled={downloading || mutation.busy} onClick={download}><Download size={16} />{downloading ? 'Downloading…' : 'Download PDF bill'}</button>}
    </div>}
    {canEdit && ready && <form className="admin-edit invoice-form" onSubmit={(event) => {
      event.preventDefault();
      mutation.submit('/admin/requests/' + row._id + '/invoice', { method: 'PUT', body: {
        version: row.version, items, discount_bdt: discount, notes,
      } });
    }}>
      <p className="muted text-sm">Enter the agreed final charges in BDT. Saving makes the bill available to the customer. Payment confirmation is handled separately.</p>
      {items.map((item, index) => <fieldset className="invoice-item" key={index} disabled={mutation.busy}>
        <legend>Item {index + 1}</legend>
        <Field id={'bill-description-' + index} label="Description"><input id={'bill-description-' + index} value={item.description} maxLength={140} required onChange={(event) => update(index, 'description', event.target.value)} /></Field>
        <div className="field-grid">
          <Field id={'bill-quantity-' + index} label="Quantity"><input id={'bill-quantity-' + index} type="number" min={1} max={999} step={1} value={item.quantity} required onChange={(event) => update(index, 'quantity', event.target.value === '' ? '' : Number(event.target.value))} /></Field>
          <Field id={'bill-price-' + index} label="Unit price (BDT)"><input id={'bill-price-' + index} inputMode="decimal" value={item.unit_bdt} maxLength={10} pattern="[0-9০-৯]{1,7}([.][0-9০-৯]{1,2})?" required onChange={(event) => update(index, 'unit_bdt', event.target.value)} /></Field>
        </div>
        {items.length > 1 && <button className="text-link" type="button" aria-label={'Remove bill item ' + (index + 1)} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}><Trash2 size={15} />Remove item</button>}
      </fieldset>)}
      <button className="btn btn-outline justify-self-start" type="button" disabled={items.length >= 20 || mutation.busy} onClick={() => setItems((current) => [...current, blankItem()])}><Plus size={16} />Add bill item</button>
      <Field id="bill-discount" label="Discount (BDT)"><input id="bill-discount" inputMode="decimal" value={discount} maxLength={10} pattern="[0-9০-৯]{1,7}([.][0-9০-৯]{1,2})?" required disabled={mutation.busy} onChange={(event) => setDiscount(event.target.value)} /></Field>
      <Field id="bill-notes" label="Customer bill notes" optional><textarea id="bill-notes" value={notes} maxLength={1500} rows={3} disabled={mutation.busy} onChange={(event) => setNotes(event.target.value)} /></Field>
      {mutation.error && <Alert>{mutation.error} <button type="button" className="text-link" onClick={refresh}>Refresh details</button></Alert>}
      <button type="submit" className="btn btn-primary" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : row.invoice ? 'Save revised bill' : 'Issue PDF bill'}</button>
    </form>}
    {!canEdit && !row.invoice && <p className="muted">No bill has been issued yet.</p>}
    {downloadError && <Alert>{downloadError}</Alert>}
  </section>;
}

export function RequestFeedback({ row }) {
  return <section className="panel record-panel"><h2>Customer rating & feedback</h2>
    {row.feedback ? <>
      <p><strong>{row.feedback.rating} / 5</strong> · {dateTime(row.feedback.created_at)}</p>
      <p className="feedback-comment">{row.feedback.comment || 'No written comment.'}</p>
    </> : <p className="muted">No feedback yet. After completion, the customer can submit one rating using their private tracking key.</p>}
  </section>;
}
