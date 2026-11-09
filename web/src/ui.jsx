import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, CircleAlert, MapPin, Phone, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useApp } from './context.jsx';

export function Brand({ staff = false }) {
  const { t } = useApp();
  return <Link to={staff ? '/admin' : '/'} className="brand">
    <img src="/gariseba.svg" alt="" width="34" height="34" />
    <span>{staff ? 'GariSeba' : t.brand}<span className="brand-dot">.</span></span>
    {staff && <span className="staff-mark">Staff</span>}
  </Link>;
}

export function PageIntro({ eyebrow, title, description, children }) {
  return <header className="page-intro">
    <p className="eyebrow"><span className="mini-rule" />{eyebrow}</p>
    <h1>{title}</h1>
    {description && <p className="page-description">{description}</p>}
    {children}
  </header>;
}

export function Alert({ children, kind = 'error' }) {
  const Icon = kind === 'success' ? Check : kind === 'warning' ? TriangleAlert : CircleAlert;
  return <div className={`notice notice-${kind}`} role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}>
    <Icon size={19} aria-hidden="true" /><div className="min-w-0">{children}</div>
  </div>;
}
export function SafetyNotice({ detailed = false }) {
  const { t } = useApp();
  return <div className="safety-notice">
    <TriangleAlert aria-hidden="true" size={20} />
    <p><strong>{t.emergency}</strong> {detailed ? t.emergencyAdvice : t.emergencyLine}</p>
    <a href="tel:999" className="safety-link"><Phone size={15} />{t.emergencyButton}</a>
  </div>;
}
export function Field({ label, hint, error, optional, id, children }) {
  const { t } = useApp();
  return <div className="field">
    <label htmlFor={id}>{label} {optional && <span className="field-optional">· {t.optional}</span>}</label>
    {children}
    {hint && <small id={id + '-hint'}>{hint}</small>}
    {error && <small id={id + '-error'} className="field-error">{error}</small>}
  </div>;
}
export function Checkbox({ children, ...props }) {
  return <label className="check-row"><input type="checkbox" {...props} /><span>{children}</span></label>;
}
export function Status({ value, english = false }) {
  const { t } = useApp();
  const names = { received: 'Received', confirmed: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', out_of_area: 'Outside area' };
  return <span className={`status-pill status-${value}`}><span />{(english ? names : t.statusNames)[value] || value}</span>;
}
export function Dialog({ title, description, children, onClose }) {
  const ref = useRef(null);
  const { t } = useApp();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="flex items-start justify-between gap-4">
      <h2>{title}</h2>
      <button className="icon-btn" type="button" aria-label={t.close} onClick={onClose}><X size={18} /></button>
    </div>
    {description && <p className="muted mt-3">{description}</p>}
    {children}
  </dialog>;
}
export function dateTime(value, lang = 'en') {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka',
  }).format(date);
}
export function money(value, lang) {
  return '৳' + new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-BD').format(value);
}
export function Estimate({ estimate, battery, config }) {
  const { t, lang } = useApp();
  if (battery && !config) return null;
  const sample = battery ? config.pricingIsSample : estimate?.sample;
  return <div className="estimate-box">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>{battery ? t.batteryFrom : t.estimate}</strong>{sample && <span className="badge badge-sample">{t.sample}</span>}
    </div>
    {battery ? <><div className="estimate-value">{money(config.batteryStartBdt, lang)}</div><small>{t.batteryNote}</small></>
      : estimate ? <><div className="estimate-value">{money(estimate.min, lang)} – {money(estimate.max, lang)}</div><small>{t.provisional}</small>
        <ul className="estimate-basis">{estimate.basis.map((item) => <li key={item.code}>{item.label} · {money(item.min, lang)} – {money(item.max, lang)}{item.note && <small>{item.note}</small>}</li>)}</ul></>
        : <small>{t.inspection}</small>}
  </div>;
}
export function Guidance({ analysis }) {
  const { t } = useApp();
  if (analysis.safety) return <SafetyNotice detailed />;
  return <div className="guidance">
    <span className="badge"><Sparkles size={14} />{analysis.source === 'model' ? t.modelSource : t.builtIn}</span>
    {analysis.provider_unavailable && <p className="muted mt-2">{t.assistantUnavailable}</p>}
    <p className="answer-title">{analysis.summary}</p>
    <p>{analysis.next_step}</p>
    {analysis.questions?.length > 0 && <><h3>{t.followup}</h3><ul>{analysis.questions.map((question) => <li key={question}>{question}</li>)}</ul></>}
    <small>{t.tentative}</small>
  </div>;
}
export function ContactStrip() {
  const { t, config } = useApp();
  const phone = config?.business.whatsappNumber;
  return <div className="contact-strip">
    <span><MapPin size={16} />{t.coverage}</span><span><ShieldCheck size={16} />{t.privateTrack}</span>
    {phone && <a href={`tel:${phone}`}><Phone size={16} />{t.call}<ChevronRight size={14} /></a>}
  </div>;
}
export function HelpLink({ children, to = '/request' }) {
  return <Link className="btn btn-primary" to={to}>{children}<ArrowRight size={18} /></Link>;
}
