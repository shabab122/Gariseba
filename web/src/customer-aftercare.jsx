import { useState } from 'react';
import { Download, Star } from 'lucide-react';
import { api, downloadPdf } from './api.js';
import { useApp } from './context.jsx';
import { Alert, dateTime, Field } from './ui.jsx';

export function CustomerAftercare({ data, matched, onFeedback }) {
  const { t, lang, errorText } = useApp();
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (data.status !== 'completed') return null;
  async function download() {
    if (busy) return;
    setBusy('pdf'); setError('');
    try { await downloadPdf('/requests/invoice', { method: 'POST', body: matched, filename: data.invoice.number + '.pdf' }); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy('feedback'); setError('');
    try {
      const result = await api('/requests/feedback', { method: 'POST', body: { ...matched, rating: Number(rating), comment } });
      onFeedback(result.feedback);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  return <div className="customer-aftercare">
    <div className="bill-note">
      <h3>{t.pdfBill}</h3>
      {data.invoice ? <>
        <p>{data.invoice.number} · {new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-BD', { style: 'currency', currency: 'BDT' }).format(data.invoice.total_poisha / 100)}</p>
        <button className="btn btn-outline" type="button" disabled={Boolean(busy)} onClick={download}><Download size={17} />{busy === 'pdf' ? t.downloadingBill : t.downloadBill}</button>
      </> : <p className="muted">{t.billPending}</p>}
    </div>
    <div className="bill-note">
      <h3><Star size={18} /> {t.feedbackTitle}</h3>
      {data.feedback ? <div role="status">
        <p><strong>{data.feedback.rating} / 5</strong> · {t.feedbackThanks}</p>
        {data.feedback.comment && <p className="feedback-comment">{data.feedback.comment}</p>}
        <small className="muted">{dateTime(data.feedback.created_at, lang)}</small>
      </div> : <form className="admin-edit" onSubmit={submit}>
        <p className="muted text-sm">{t.feedbackHint}</p>
        <Field id="service-rating" label={t.ratingLabel}><select id="service-rating" value={rating} onChange={(event) => setRating(event.target.value)} required disabled={Boolean(busy)}>
          <option value="">{t.chooseRating}</option>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}
        </select></Field>
        <Field id="service-feedback" label={t.feedbackComment} optional><textarea id="service-feedback" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} disabled={Boolean(busy)} /></Field>
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !rating}>{busy === 'feedback' ? t.sending : t.submitFeedback}</button>
      </form>}
    </div>
    {error && <Alert>{error}</Alert>}
  </div>;
}
