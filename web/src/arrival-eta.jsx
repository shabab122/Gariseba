import { Field } from './ui.jsx';

export function dhakaEtaInput(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? new Date(date.getTime() + 6 * 3600000).toISOString().slice(0, 16) : '';
}

export function etaRequestValue(value) {
  if (!value) return null;
  const date = new Date(value + '+06:00');
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

export function ArrivalEtaField({ id, value, onChange, disabled }) {
  return <Field id={id} label="Estimated arrival (Dhaka time)" optional>
    <input id={id} type="datetime-local" value={value} max={dhakaEtaInput(Date.now() + 48 * 3600000)} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    <small className="muted">An estimate within the next 48 hours. Reassigning a technician or closing the request clears it.</small>
    {value && !disabled && <button type="button" className="text-link justify-self-start text-sm" onClick={() => onChange('')}>Clear arrival estimate</button>}
  </Field>;
}
