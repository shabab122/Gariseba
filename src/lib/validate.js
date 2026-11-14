'use strict';
const clean = (v, max) => {
  if (typeof v !== 'string') return '';
  // strip control chars except newline/tab, collapse CRLF
  return v.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n/g, '\n').trim().slice(0, max);
};

// Bangladesh mobile: +8801XXXXXXXXX or 01XXXXXXXXX (operators 013-019)
function normalizePhone(v) {
  const raw = digits(clean(v, 30)).replace(/[\s\-()]/g, '');
  const m = raw.match(/^(?:\+?880|0)(1[3-9]\d{8})$/);
  return m ? '+880' + m[1] : null;
}

const digits = (value) => value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
const TYPES = ['battery', 'repair', 'other'];
const FUELS = ['petrol', 'diesel', 'octane', 'cng', 'lpg', 'hybrid', 'electric', 'unknown'];
const LABELS = ['vehicle', 'dashboard', 'damage', 'battery', 'other'];
const CATEGORIES = ['battery', 'tyre', 'brakes', 'engine', 'overheating', 'electrical', 'ac', 'fuel', 'other'];

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(email)) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  return local + '@' + email.slice(at + 1).toLowerCase();
}

function validateRequest(body) {
  const errors = {};
  const out = {};
  const b = body && typeof body === 'object' ? body : {};

  out.request_type = TYPES.includes(b.request_type) ? b.request_type : (errors.request_type = 'Choose a request type.', null);
  out.urgency = b.urgency === 'urgent' ? 'urgent' : 'normal';
  out.next_step = ['technician', 'callback', 'chat_only'].includes(b.next_step) ? b.next_step : 'technician';
  out.language = b.language === 'bn' ? 'bn' : 'en';

  out.customer_name = clean(b.customer_name, 80);
  if (out.customer_name.length < 2) errors.customer_name = 'Please enter your name.';

  out.callback_phone = normalizePhone(b.callback_phone);
  if (!out.callback_phone) errors.callback_phone = 'Enter a valid Bangladesh mobile number, e.g. 017XXXXXXXX.';

  out.location_text = clean(b.location_text, 300);
  if (out.location_text.length < 3) errors.location_text = 'Please describe where the car is (area, road, landmark).';
  const hasCoordinates = [b.map_lat, b.map_lng].some((v) => v != null && v !== '');
  if (hasCoordinates) {
    const lat = b.map_lat, lng = b.map_lng;
    if (!Number.isFinite(lat) || lat < 20.5 || lat > 26.7 || !Number.isFinite(lng) || lng < 88 || lng > 92.8) {
      errors.map_lat = 'Map position looks invalid.';
    } else {
      out.map_lat = Math.round(lat * 1e5) / 1e5;
      out.map_lng = Math.round(lng * 1e5) / 1e5;
    }
  }

  out.vehicle_make = clean(b.vehicle_make, 40);
  out.vehicle_model = clean(b.vehicle_model, 40);
  if (!out.vehicle_make) errors.vehicle_make = 'Please enter the car make (e.g. Toyota).';
  if (!out.vehicle_model) errors.vehicle_model = 'Please enter the car model (e.g. Axio).';
  const yearText = typeof b.vehicle_year === 'number' ? String(b.vehicle_year) : digits(clean(b.vehicle_year, 10));
  const yr = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
  const maxYear = new Date().getFullYear() + 1;
  if (b.vehicle_year !== undefined && b.vehicle_year !== '' && b.vehicle_year !== null) {
    if (!(yr >= 1960 && yr <= maxYear)) errors.vehicle_year = 'Enter a valid year.'; else out.vehicle_year = yr;
  }
  out.fuel_type = FUELS.includes(b.fuel_type) ? b.fuel_type : 'unknown';
  out.registration = clean(b.registration, 30) || null;
  out.maintenance_history = clean(b.maintenance_history, 600) || null;

  out.symptoms = clean(b.symptoms, 1200);
  if (out.symptoms.length < 3) errors.symptoms = 'Please tell us what is happening with the car.';
  out.started_when = clean(b.started_when, 120) || null;
  out.safety_flag = b.safety_flag === true;
  out.category = CATEGORIES.includes(b.category) ? b.category : (out.request_type === 'battery' ? 'battery' : 'other');

  out.consent_store = b.consent_store === true;
  if (!out.consent_store) errors.consent_store = 'We need your permission to store these details so we can help you.';
  out.consent_whatsapp_share = b.consent_whatsapp_share === true;

  const ids = b.photo_ids ?? [];
  if (!Array.isArray(ids) || ids.length > 5 || ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id))) {
    errors.photo_ids = 'Check the selected photos.';
  }
  out.photo_ids = errors.photo_ids ? [] : [...new Set(ids)];
  out.consent_status_email = b.consent_status_email === true;
  out.notification_email = out.consent_status_email ? normalizeEmail(b.notification_email) : null;
  if (out.consent_status_email && !out.notification_email) errors.notification_email = 'Enter a valid email address for status updates.';
  // Omit false for compatibility with fingerprints created before SMS existed.
  if (b.consent_status_sms === true) out.consent_status_sms = true;

  return { ok: Object.keys(errors).length === 0, errors, value: out };
}

module.exports = { clean, digits, normalizePhone, normalizeEmail, validateRequest, TYPES, FUELS, LABELS, CATEGORIES };
