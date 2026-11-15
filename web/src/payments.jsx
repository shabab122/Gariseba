import { useRef, useState } from 'react';
import { useApp } from './context.jsx';
import { useMutation } from './admin-config.jsx';
import { Alert, dateTime, Field } from './ui.jsx';

export function PaymentSummary({ payment, english = false }) {
  const { t, lang } = useApp();
  if (!payment) return null;
  const currency = value => new Intl.NumberFormat(english || lang === 'en' ? 'en-BD' : 'bn-BD', { style: 'currency', currency: 'BDT' }).format(value / 100);
  const labels = english ? { title: 'Payment status', names: { unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Paid' }, total: 'Bill total', paid: 'Recorded paid', balance: 'Remaining balance', hint: 'Amounts reflect records entered by the service team.' }
    : { title: t.paymentTitle, names: t.paymentNames, total: t.totalAmount, paid: t.paidAmount, balance: t.balanceAmount, hint: t.paymentHint };
  return <div className="payment-summary" data-payment-status={payment.status}>
    <h3>{labels.title}</h3><strong className="badge">{labels.names[payment.status]}</strong>
    <dl className="payment-totals"><div><dt>{labels.total}</dt><dd>{currency(payment.total_poisha)}</dd></div><div><dt>{labels.paid}</dt><dd>{currency(payment.paid_poisha)}</dd></div><div><dt>{labels.balance}</dt><dd>{currency(payment.balance_poisha)}</dd></div></dl>
    <p className="muted text-sm">{labels.hint}</p>
  </div>;
}

export function RequestPayments({ row, role, refresh }) {
  const [kind, setKind] = useState('payment'), [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState('');
  const operationId = useRef(crypto.randomUUID());
  const mutation = useMutation(refresh);
  if (!row.invoice) return null;
  const paid = (row.payments || []).reduce((sum, entry) => sum + (entry.kind === 'refund' ? -entry.amount_poisha : entry.amount_poisha), 0);
  const payment = { total_poisha: row.invoice.total_poisha, paid_poisha: paid, balance_poisha: row.invoice.total_poisha - paid,
    status: paid >= row.invoice.total_poisha ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid' };
  return <section className="panel record-panel">
    <h2>Bill payments</h2><PaymentSummary payment={payment} english />
    {role !== 'viewer' && row.status === 'completed' && <form className="admin-edit" onSubmit={event => {
      event.preventDefault();
      mutation.submit('/admin/requests/' + row._id + '/payments', { method: 'POST', body: { version: row.version, operation_id: operationId.current,
        kind, method, amount_bdt: amount, reference, note } });
    }}>
      <p className="muted text-sm">Record money already received or refunded. This form does not charge a bank account or payment provider. Entries remain in the payment history.</p>
      <Field id="payment-kind" label="Entry type"><select id="payment-kind" value={kind} onChange={e => setKind(e.target.value)} disabled={mutation.busy}><option value="payment">Payment received</option><option value="refund">Refund given</option></select></Field>
      <Field id="payment-amount" label="Amount (BDT)"><input id="payment-amount" inputMode="decimal" value={amount} maxLength={10} required disabled={mutation.busy} onChange={e => setAmount(e.target.value)} /></Field>
      <Field id="payment-method" label="Payment method"><select id="payment-method" value={method} onChange={e => setMethod(e.target.value)} disabled={mutation.busy}>{['cash', 'bkash', 'nagad', 'bank', 'other'].map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field id="payment-reference" label="Transaction reference" optional><input id="payment-reference" value={reference} maxLength={120} disabled={mutation.busy} onChange={e => setReference(e.target.value)} /></Field>
      <Field id="payment-note" label="Internal payment note" optional><textarea id="payment-note" value={note} maxLength={300} rows={2} disabled={mutation.busy} onChange={e => setNote(e.target.value)} /></Field>
      {mutation.error && <Alert>{mutation.error} <button type="button" className="text-link" onClick={refresh}>Refresh details</button></Alert>}
      <button className="btn btn-primary" type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : 'Record payment entry'}</button>
    </form>}
    {(row.payments || []).length > 0 && <ul className="note-list">{row.payments.slice().reverse().map(entry => <li key={entry.id}>
      <strong>{entry.kind === 'refund' ? 'Refund' : 'Payment'} · BDT {(entry.amount_poisha / 100).toFixed(2)} · {entry.method}</strong>
      <small className="block">{entry.actor} · {dateTime(entry.created_at)}</small>{entry.reference && <p className="feedback-comment">{entry.reference}</p>}{entry.note && <p className="feedback-comment muted">{entry.note}</p>}
    </li>)}</ul>}
  </section>;
}
