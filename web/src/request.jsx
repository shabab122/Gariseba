import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BatteryCharging, Camera, Check, ChevronRight, CircleCheck,
  Copy, ImagePlus, LifeBuoy, LocateFixed, Send, ShieldCheck, Trash2, Wrench,
} from 'lucide-react';
import { ApiError, api, uploadPhoto } from './api.js';
import { useApp } from './context.jsx';
import { Alert, Checkbox, Estimate, Field, Guidance, PageIntro, SafetyNotice, Status } from './ui.jsx';

const serviceIcons = { battery: BatteryCharging, repair: Wrench, other: LifeBuoy };
const initial = (type, language, symptoms) => ({
  request_type: Object.hasOwn(serviceIcons, type) ? type : 'repair',
  symptoms: typeof symptoms === 'string' ? symptoms.trim().slice(0, 1200) : '',
  started_when: '', urgency: 'normal', safety_flag: false,
  customer_name: '', callback_phone: '', language, location_text: '', confirm_dhaka: false,
  map_lat: null, map_lng: null, vehicle_make: '', vehicle_model: '', vehicle_year: '', fuel_type: 'unknown',
  registration: '', maintenance_history: '', next_step: 'technician', consent_store: false, consent_whatsapp_share: false,
  notification_email: '', consent_status_email: false,
});
const fieldSteps = [
  ['request_type', 'symptoms', 'started_when'], ['customer_name', 'callback_phone', 'notification_email', 'location_text', 'map_lat'],
  ['vehicle_make', 'vehicle_model', 'vehicle_year'], ['photo_ids'], ['consent_store'],
];
const digits = (text) => text.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));

function validateStep(step, data, t) {
  const errors = {};
  if (step === 0 && data.symptoms.trim().length < 3) errors.symptoms = t.required;
  if (step === 1) {
    if (data.customer_name.trim().length < 2) errors.customer_name = t.required;
    if (!/^(?:\+?880|0)1[3-9]\d{8}$/.test(digits(data.callback_phone).replace(/[\s()-]/g, ''))) errors.callback_phone = t.phoneHint;
    if (data.location_text.trim().length < 3) errors.location_text = t.required;
    if (data.consent_status_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.notification_email.trim())) errors.notification_email = t.emailInvalid;
  }
  if (step === 2) {
    for (const key of ['vehicle_make', 'vehicle_model']) if (!data[key].trim()) errors[key] = t.required;
    const year = digits(data.vehicle_year.trim());
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1960 || Number(year) > new Date().getFullYear() + 1)) {
      errors.vehicle_year = t.lang === 'bn' ? 'চার অঙ্কের বৈধ সাল দিন।' : 'Enter a valid four-digit year.';
    }
  }
  return errors;
}

function TextField({ name, label, data, set, errors, optional, hint, multiline, ...props }) {
  const attrs = {
    id: name, name, value: data[name], onChange: (event) => set(name, event.target.value), ...props,
    'aria-invalid': Boolean(errors[name]), 'aria-describedby': [hint && name + '-hint', errors[name] && name + '-error'].filter(Boolean).join(' ') || undefined,
  };
  return <Field id={name} label={label} optional={optional} hint={hint} error={errors[name]}>
    {multiline ? <textarea {...attrs} /> : <input {...attrs} />}
  </Field>;
}

function StepList({ step, go, locked }) {
  const { t, lang } = useApp();
  const numbers = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en', { minimumIntegerDigits: 2 });
  return <aside className="wizard-aside">
    <p className="eyebrow">{t.step} {numbers.format(step + 1)} / {numbers.format(t.steps.length)}</p>
    <progress className="wizard-progress" value={step + 1} max={t.steps.length} aria-label={t.step} />
    <ol className="step-list">
      {t.steps.map((title, index) => <li key={index}>
        <button type="button" aria-current={index === step ? 'step' : undefined} disabled={index >= step || locked} className={index === step ? 'current' : index < step ? 'past' : ''} onClick={() => go(index)}>
          <span className="step-count">{index < step ? <Check size={15} /> : numbers.format(index + 1)}</span>{title}
          {index === step && <ChevronRight className="ml-auto" size={17} />}
        </button>
      </li>)}
    </ol>
    <div className="wizard-private"><ShieldCheck size={19} /><span>{t.privateTrack}</span></div>
  </aside>;
}

async function compress(file, maxBytes) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && (file.type || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
    throw new ApiError(415, { error: 'bad_type', message: 'Choose a JPEG, PNG or WebP image.' });
  }
  if (file.size > 22 * 1024 * 1024) throw new ApiError(413, { error: 'too_large', message: 'Choose a smaller photo.' });
  let image;
  try {
    image = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob && blob.size <= maxBytes) return new File([blob], 'gariseba-photo.jpg', { type: 'image/jpeg' });
  } catch {
    // Older browsers may not decode every supported type. The server validates the original.
  } finally {
    image?.close();
  }
  if (file.size <= maxBytes) return file;
  throw new ApiError(413, { error: 'too_large', message: 'Choose a smaller photo.' });
}

function PhotoPicker({ photos, urls, draftKey, setPhotos, photoBusy, setPhotoBusy }) {
  const { t, config, errorText } = useApp();
  const [label, setLabel] = useState('vehicle');
  const [progress, setProgress] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const max = config?.limits.photosPerRequest ?? 5;
  const mb = config?.limits.photoMaxMB ?? 5;
  const disabled = photoBusy || photos.length >= max;

  async function send(prepared, photoLabel, key) {
    setPendingUpload({ prepared, photoLabel, key });
    try {
      const uploaded = await uploadPhoto(prepared, photoLabel, draftKey, key, setProgress);
      const url = URL.createObjectURL(prepared);
      urls.current.add(url);
      setPhotos((items) => [...items, { ...uploaded, url }]);
      setPendingUpload(null);
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 429) setPendingUpload(null);
      setError(errorText(err));
    }
  }
  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;
    setPhotoBusy(true);
    setError('');
    setPendingUpload(null);
    setProgress(0);
    try {
      const prepared = await compress(file, mb * 1024 * 1024);
      await send(prepared, label, crypto.randomUUID());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setProgress(null);
      setPhotoBusy(false);
    }
  }
  async function retryUpload() {
    if (!pendingUpload || disabled) return;
    setPhotoBusy(true);
    setError('');
    setProgress(0);
    try {
      await send(pendingUpload.prepared, pendingUpload.photoLabel, pendingUpload.key);
    } finally {
      setProgress(null);
      setPhotoBusy(false);
    }
  }
  async function remove(photo) {
    setPhotoBusy(true);
    setError('');
    try {
      await api('/photos/' + photo.upload_id, { method: 'DELETE', draftKey });
    } catch (err) {
      if (err.status !== 404) {
        setError(errorText(err));
        setPhotoBusy(false);
        return;
      }
    }
    URL.revokeObjectURL(photo.url);
    urls.current.delete(photo.url);
    setPhotos((items) => items.filter((item) => item.upload_id !== photo.upload_id));
    setPhotoBusy(false);
  }

  return <section className="wizard-section">
    <div className="flex flex-wrap items-baseline gap-2"><h3>{t.photoTitle}</h3><span className="muted">· {t.optional}</span></div>
    <p className="muted">{t.photoHelp.replace('{n}', max).replace('{mb}', mb)}</p>
    <p className="muted text-sm">{t.photoConsent}</p>
    {error && <Alert>{error} {pendingUpload && <button type="button" className="text-link" onClick={retryUpload}>{t.retry}</button>}</Alert>}
    <div className="photo-tools">
      <Field label={t.photoLabel} id="photo-label"><select id="photo-label" value={label} disabled={disabled} onChange={(event) => setLabel(event.target.value)}>
        {Object.entries(t.photoLabels).map(([key, title]) => <option value={key} key={key}>{title}</option>)}
      </select></Field>
      <div className="photo-actions">
        <input hidden type="file" accept="image/jpeg,image/png,image/webp" ref={fileInput} onChange={choose} data-testid="photo-input" />
        <input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" ref={cameraInput} onChange={choose} />
        <button type="button" className="btn btn-outline" disabled={disabled} onClick={() => fileInput.current.click()}><ImagePlus size={17} />{t.addPhoto}</button>
        <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => cameraInput.current.click()}><Camera size={17} />{t.capture}</button>
      </div>
    </div>
    {progress !== null && <div className="photo-progress" role="status"><span>{t.photoWait} {progress}%</span><progress aria-label={t.photoWait} value={progress} max={100} /></div>}
    {photos.length > 0 && <ul className="photo-list">
      {photos.map((photo) => <li key={photo.upload_id}>
        <img src={photo.url} alt={t.photoLabels[photo.label]} />
        <span>{t.photoLabels[photo.label]}</span>
        <button type="button" className="icon-btn" aria-label={t.removePhoto + ' ' + t.photoLabels[photo.label]} title={t.removePhoto} disabled={photoBusy} onClick={() => remove(photo)}><Trash2 size={15} /></button>
      </li>)}
    </ul>}
  </section>;
}

function Review({ data, photos, go, set, errors }) {
  const { t } = useApp();
  const hasMap = data.map_lat != null;
  const vehicle = [data.vehicle_make, data.vehicle_model, data.vehicle_year, t.fuels[data.fuel_type]].filter(Boolean).join(' · ');
  const groups = [
    [t.problem, [t.requestTypes[data.request_type], data.symptoms, data.started_when, data.urgency === 'urgent' ? t.urgent : t.normal], 0],
    [t.contact, [data.customer_name, data.callback_phone, data.location_text, data.language === 'bn' ? 'বাংলা' : 'English',
      data.consent_status_email && t.emailUpdates + ' · ' + data.notification_email,
      hasMap && <a key="map" href={`https://maps.google.com/?q=${data.map_lat},${data.map_lng}`} target="_blank" rel="noreferrer" className="text-link">{t.pinAdded}</a>], 1],
    [t.vehicle, [vehicle, data.registration, data.maintenance_history], 2],
    [t.attach, [photos.length ? photos.map((photo) => t.photoLabels[photo.label]).join(', ') : t.none], 3],
  ];
  return <>
    <p className="muted">{t.reviewIntro}</p>
    <div className="review-grid">
      {groups.map(([title, values, step]) => <section key={title}>
        <div className="flex justify-between gap-3"><h3>{title}</h3><button type="button" className="text-link" onClick={() => go(step)}>{t.edit}</button></div>
        {values.filter(Boolean).map((value, index) => <p key={index}>{value}</p>)}
      </section>)}
    </div>
    {data.safety_flag && <SafetyNotice detailed />}
    <Field label={t.nextStep} id="next_step">
      <select id="next_step" value={data.next_step} onChange={(event) => set('next_step', event.target.value)}>
        {Object.entries(t.nextSteps).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </select>
    </Field>
    <div className="consents">
      <Checkbox checked={data.consent_store} onChange={(event) => set('consent_store', event.target.checked)} required>{t.storeConsent}</Checkbox>
      {errors.consent_store && <small className="field-error">{errors.consent_store}</small>}
      <Checkbox checked={data.consent_whatsapp_share} onChange={(event) => set('consent_whatsapp_share', event.target.checked)}>{t.waConsent}</Checkbox>
      <Link className="text-link text-sm" to="/privacy" target="_blank" rel="noreferrer">{t.privacy}<ArrowUpRight size={14} /></Link>
    </div>
  </>;
}

function Receipt({ receipt, reset }) {
  const { t } = useApp();
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState('');
  async function copyValue(key, value) {
    setMessage('');
    try { await navigator.clipboard.writeText(value); setCopied(key); }
    catch { setMessage(t.copyFail); }
  }
  return <div className="container-narrow page-space">
    <div className="panel receipt-panel">
      <div className="receipt-icon"><CircleCheck size={34} /></div>
      <PageIntro eyebrow={t.pathLabel} title={t.received} description={t.receiptText} />
      <Status value={receipt.status} />
      {receipt.safety && <SafetyNotice detailed />}
      <p className="muted">{t.receiptSave}</p>
      <dl className="credential-list">
        {[[t.reference, receipt.code], [t.trackingKey, receipt.tracking_token]].map(([key, value]) => <div key={key}>
          <div><dt>{key}</dt><dd data-testid={key === t.reference ? 'receipt-code' : 'receipt-key'}>{value}</dd></div>
          <button type="button" className="btn btn-quiet" onClick={() => copyValue(key, value)}><Copy size={16} />{copied === key ? t.copied : t.copy}</button>
        </div>)}
      </dl>
      {message && <Alert kind="warning">{message}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Link to="/track" state={{ code: receipt.code, token: receipt.tracking_token }} className="btn btn-primary">{t.trackThis}<ArrowRight size={17} /></Link>
        <button type="button" className="btn btn-outline" onClick={reset}>{t.another}</button>
      </div>
      {receipt.whatsapp && <section className="whatsapp-preview">
        <h2>{t.shareDetails}</h2><p className="muted">{t.waNotice}</p><pre>{receipt.whatsapp.message}</pre>
        <a className="btn btn-outline" href={receipt.whatsapp.url} target="_blank" rel="noreferrer">{t.sendWa}<ArrowUpRight size={17} /></a>
      </section>}
    </div>
  </div>;
}

export default function RequestWizard() {
  const { t, lang, config, errorText, refresh } = useApp();
  const [params] = useSearchParams();
  const location = useLocation();
  const [data, setData] = useState(() => initial(params.get('type'), lang, location.state?.symptoms));
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [area, setArea] = useState(null);
  const [pin, setPin] = useState('');
  const [guidance, setGuidance] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const urls = useRef(new Set());
  const heading = useRef(null);
  const problemFields = { data, set, errors };
  useEffect(() => { refresh(true); }, [refresh]);
  useEffect(() => {
    const pending = urls.current;
    return () => { pending.forEach((url) => URL.revokeObjectURL(url)); pending.clear(); };
  }, []);

  function set(key, value) {
    setData((current) => ({ ...current, [key]: value, ...(key === 'location_text' ? { confirm_dhaka: false } : {}) }));
    if (key === 'location_text') setArea(null);
    if (['symptoms', 'request_type', 'safety_flag'].includes(key)) setGuidance(null);
    setErrors((current) => ({ ...current, [key]: undefined }));
  }
  function focusStep(index) {
    setStep(index);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function go(index) {
    setError('');
    setErrors({});
    focusStep(index);
  }
  async function checkArea() {
    const result = await api('/location/check', { method: 'POST', body: { location_text: data.location_text } });
    setArea(result.status);
    return result.status;
  }
  async function requestCheck() {
    setError('');
    if (data.location_text.trim().length < 3) {
      setErrors({ location_text: t.required });
      return;
    }
    setBusy('area');
    try { await checkArea(); } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  async function guide() {
    setError('');
    setBusy('guide');
    try {
      setGuidance(await api('/chat/analyze', { method: 'POST', body: {
        symptoms: data.symptoms, request_type: data.request_type, safety_flag: data.safety_flag, language: lang,
      } }));
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(''); }
  }
  function locate() {
    if (!navigator.geolocation) return setPin('error');
    setPin('loading');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (coords.latitude < 20.5 || coords.latitude > 26.7 || coords.longitude < 88 || coords.longitude > 92.8) {
        setPin('error');
        return;
      }
      setData((current) => ({ ...current, map_lat: coords.latitude, map_lng: coords.longitude }));
      setPin('ok');
    }, () => setPin('error'), { timeout: 9000, maximumAge: 0, enableHighAccuracy: false });
  }

  async function advance(event) {
    event.preventDefault();
    if (busy || photoBusy || (step === 1 && pin === 'loading')) return;
    setError('');
    const invalid = validateStep(step, data, { ...t, lang });
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    if (step === 1) {
      setBusy('area');
      try {
        const status = area || await checkArea();
        if (status === 'outside' || (status === 'unknown' && !data.confirm_dhaka)) return;
      } catch (err) { setError(errorText(err)); return; }
      finally { setBusy(''); }
    }
    if (step < 4) { go(step + 1); return; }
    if (!data.consent_store) { setErrors({ consent_store: t.required }); return; }

    setBusy('submit');
    try {
      const value = await api('/requests', { method: 'POST', draftKey, body: {
        ...data, photo_ids: photos.map((photo) => photo.upload_id),
      } });
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
      setPhotos([]);
      setReceipt(value);
      window.scrollTo(0, 0);
    } catch (err) {
      if (err.code === 'outside_area' || err.code === 'confirm_area') {
        focusStep(1);
        setArea(err.code === 'outside_area' ? 'outside' : 'unknown');
        set('confirm_dhaka', false);
      } else if (err.code === 'photos_changed') focusStep(3);
      else if (err.fields && Object.keys(err.fields).length) {
        const earliest = fieldSteps.findIndex((fields) => fields.some((field) => err.fields[field]));
        if (earliest >= 0) focusStep(earliest);
        setErrors(lang === 'bn' ? Object.fromEntries(Object.keys(err.fields).map((key) => [key, t.required])) : err.fields);
      }
      setError(errorText(err));
    } finally { setBusy(''); }
  }
  function reset() {
    setDraftKey(crypto.randomUUID());
    setData(initial(params.get('type'), lang));
    setGuidance(null);
    setArea(null);
    setPin('');
    setReceipt(null);
    go(0);
  }

  if (receipt) return <Receipt receipt={receipt} reset={reset} />;
  const locked = Boolean(busy) || photoBusy;
  return <div className="container-wide page-space">
    <PageIntro eyebrow={t.pathLabel} title={t.requestTitle} description={t.requestIntro} />
    <div className="wizard-grid">
      <StepList step={step} go={go} locked={locked} />
      <form className="panel wizard-panel" onSubmit={advance} noValidate>
        <div className="wizard-heading"><h2 ref={heading} tabIndex={-1}>{t.steps[step]}</h2><span className="badge">{step + 1} / {t.steps.length}</span></div>
        {error && <Alert>{error}</Alert>}
        {step === 0 && <>
          <fieldset className="request-choice"><legend>{t.requestType}</legend><div>
            {Object.entries(t.requestTypes).map(([value, label]) => {
              const Icon = serviceIcons[value];
              return <label key={value} className="choice-card"><input type="radio" name="request_type" checked={data.request_type === value} onChange={() => set('request_type', value)} /><Icon size={21} /><span>{label}</span></label>;
            })}
          </div></fieldset>
          {data.request_type === 'battery' && <Estimate battery config={config} />}
          <TextField {...problemFields} name="symptoms" label={t.describe} hint={t.describeHint} maxLength={1200} multiline rows={4} required />
          <div className="field-grid">
            <TextField {...problemFields} name="started_when" label={t.when} maxLength={120} optional />
            <Field id="urgency" label={t.urgency}><select id="urgency" value={data.urgency} onChange={(event) => set('urgency', event.target.value)}>
              <option value="normal">{t.normal}</option><option value="urgent">{t.urgent}</option>
            </select></Field>
          </div>
          <Checkbox checked={data.safety_flag} onChange={(event) => set('safety_flag', event.target.checked)}>{t.unsafe}</Checkbox>
          {data.safety_flag && <SafetyNotice detailed />}
        </>}
        {step === 1 && <>
          <div className="field-grid">
            <TextField {...problemFields} name="customer_name" label={t.name} maxLength={80} autoComplete="name" required />
            <TextField {...problemFields} name="callback_phone" label={t.phone} maxLength={30} type="tel" autoComplete="tel" required />
          </div>
          <Field id="preferred-language" label={t.languageForStaff}><select id="preferred-language" value={data.language} onChange={(event) => set('language', event.target.value)}>
            <option value="en">English</option><option value="bn">বাংলা</option>
          </select></Field>
          {config?.integrations.statusEmail ? <>
            <Checkbox checked={data.consent_status_email} onChange={(event) => set('consent_status_email', event.target.checked)}>{t.emailConsent}</Checkbox>
            {data.consent_status_email && <TextField {...problemFields} name="notification_email" label={t.emailAddress} hint={t.emailHint} maxLength={254} type="email" autoComplete="email" required />}
          </> : <p className="muted text-sm">{t.emailUnavailable}</p>}
          <TextField {...problemFields} name="location_text" label={t.where} hint={t.whereHint} maxLength={300} multiline rows={3} disabled={busy === 'area'} required />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-outline" onClick={requestCheck} disabled={locked}>{busy === 'area' ? t.checking : t.areaCheck}</button>
            {pin === 'ok' ? <button type="button" className="text-link" onClick={() => {
              setData((current) => ({ ...current, map_lat: null, map_lng: null })); setPin('');
            }}>{t.removePin}</button> : <button type="button" className="text-link" onClick={locate} disabled={pin === 'loading'}><LocateFixed size={17} />{pin === 'loading' ? t.checking : t.addPin}</button>}
          </div>
          {pin === 'ok' && <Alert kind="success">{t.pinAdded}</Alert>}
          {pin === 'error' && <Alert kind="warning">{t.pinError}</Alert>}
          {errors.map_lat && <Alert>{errors.map_lat}</Alert>}
          {area === 'inside' && <Alert kind="success">{t.areaInside}</Alert>}
          {area === 'outside' && <Alert>{t.areaOutside}</Alert>}
          {area === 'unknown' && <><Alert kind="warning">{t.areaUnknown}</Alert>
            <Checkbox checked={data.confirm_dhaka} onChange={(event) => set('confirm_dhaka', event.target.checked)}>{t.confirmArea}</Checkbox></>}
        </>}
        {step === 2 && <>
          <div className="field-grid">
            <TextField {...problemFields} name="vehicle_make" label={t.make} maxLength={40} placeholder="Toyota" required />
            <TextField {...problemFields} name="vehicle_model" label={t.model} maxLength={40} placeholder="Axio" required />
            <TextField {...problemFields} name="vehicle_year" label={t.year} maxLength={4} inputMode="numeric" optional />
            <Field id="fuel_type" label={t.fuel}><select id="fuel_type" value={data.fuel_type} onChange={(event) => set('fuel_type', event.target.value)}>
              {Object.entries(t.fuels).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
            </select></Field>
          </div>
          <TextField {...problemFields} name="registration" label={t.registration} maxLength={30} optional />
          <TextField {...problemFields} name="maintenance_history" label={t.maintenance} maxLength={600} rows={3} multiline optional />
        </>}
        {step === 3 && <>
          <section className="wizard-section">
            <h3>{t.guidance}</h3><p className="muted">{t.guideIntro}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-outline" onClick={guide} disabled={locked}>{busy === 'guide' ? t.checking : t.guideButton}</button>
              <Link className="text-link" to="/assistant" target="_blank" rel="noreferrer">{t.assistant}<ArrowUpRight size={16} /></Link>
            </div>
            {guidance && <><Guidance analysis={guidance.analysis} />{!guidance.analysis.safety && <Estimate estimate={guidance.estimate} battery={data.request_type === 'battery'} config={guidance} />}</>}
          </section>
          <PhotoPicker photos={photos} urls={urls} draftKey={draftKey} setPhotos={setPhotos} photoBusy={photoBusy} setPhotoBusy={setPhotoBusy} />
        </>}
        {step === 4 && <Review data={data} photos={photos} go={go} set={set} errors={errors} />}
        <div className="wizard-actions">
          {step > 0 ? <button className="btn btn-quiet" type="button" disabled={locked} onClick={() => go(step - 1)}><ArrowLeft size={18} />{t.back}</button> : <Link to="/" className="btn btn-quiet"><ArrowLeft size={18} />{t.home}</Link>}
          <button type="submit" className="btn btn-primary" disabled={locked || (step === 1 && (area === 'outside' || pin === 'loading'))}>
            {busy === 'submit' ? t.sending : step === 4 ? t.send : t.next}{step === 4 ? <Send size={17} /> : <ArrowRight size={18} />}
          </button>
        </div>
      </form>
    </div>
  </div>;
}
