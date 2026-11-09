'use strict';
// Generate a customer-reviewed WhatsApp handoff.
const config = require('../config');
const { clean } = require('./validate');

const L = {
  en: { title: 'GariSeba request', type: 'Request', urgency: 'Urgency', name: 'Name', phone: 'Callback', loc: 'Location', map: 'Map', veh: 'Vehicle', reg: 'Registration', sym: 'Symptoms', since: 'Started', hist: 'Maintenance', ai: 'Tentative assessment (UNCONFIRMED, not a diagnosis)', est: 'Provisional estimate (subject to inspection)', next: 'Requested next step', code: 'Reference', photos: 'Photos', photosNote: 'Photos available on request (not attached)', types: { battery: 'Battery help', repair: 'Repair', other: 'Other' }, urg: { urgent: 'Urgent', normal: 'Normal' }, steps: { technician: 'Please send a technician', callback: 'Please call me back', chat_only: 'Just continue chatting for now' } },
  bn: { title: 'গাড়িসেবা অনুরোধ', type: 'অনুরোধ', urgency: 'জরুরি কিনা', name: 'নাম', phone: 'কলব্যাক', loc: 'অবস্থান', map: 'ম্যাপ', veh: 'গাড়ি', reg: 'রেজিস্ট্রেশন', sym: 'সমস্যা', since: 'শুরু', hist: 'মেইনটেন্যান্স', ai: 'প্রাথমিক ধারণা (অনিশ্চিত, নিশ্চিত ডায়াগনসিস নয়)', est: 'সম্ভাব্য খরচ (পরিদর্শন সাপেক্ষে)', next: 'পরবর্তী ধাপ', code: 'রেফারেন্স', photos: 'ছবি', photosNote: 'অনুরোধে ছবি দেওয়া যাবে (সংযুক্ত নয়)', types: { battery: 'ব্যাটারি সহায়তা', repair: 'মেরামত', other: 'অন্যান্য' }, urg: { urgent: 'জরুরি', normal: 'সাধারণ' }, steps: { technician: 'টেকনিশিয়ান পাঠান', callback: 'আমাকে কল করুন', chat_only: 'আপাতত শুধু চ্যাট' } },
};

// `r` is a request row (already reviewed + consented by the customer). Only consented fields are included.
function buildMessage(r, opts = {}) {
  const lang = r.language === 'bn' ? 'bn' : 'en';
  const t = L[lang];
  const lines = [];
  lines.push(`*${t.title}* (${t.code}: ${r.public_code})`);
  lines.push(`${t.type}: ${t.types[r.request_type] || r.request_type} | ${t.urgency}: ${t.urg[r.urgency]}`);
  lines.push(`${t.name}: ${r.customer_name}`);
  lines.push(`${t.phone}: ${r.callback_phone}`);
  lines.push(`${t.loc}: ${r.location_text}`);
  if (r.map_lat != null && r.map_lng != null) lines.push(`${t.map}: https://maps.google.com/?q=${r.map_lat},${r.map_lng}`);
  lines.push(`${t.veh}: ${[r.vehicle_make, r.vehicle_model, r.vehicle_year, r.fuel_type].filter(Boolean).join(' ')}`);
  if (r.registration) lines.push(`${t.reg}: ${r.registration}`);
  lines.push(`${t.sym}: ${r.symptoms}`);
  if (r.started_when) lines.push(`${t.since}: ${r.started_when}`);
  if (r.maintenance_history) lines.push(`${t.hist}: ${r.maintenance_history}`);
  if (r.ai_assessment) lines.push(`${t.ai}: ${r.ai_assessment}`);
  if (r.estimate && !r.estimate.sample) lines.push(`${t.est}: ৳${r.estimate.min}–৳${r.estimate.max}`);
  if (opts.photoCount) lines.push(`${t.photos}: ${opts.photoCount} - ${t.photosNote}`);
  lines.push(`${t.next}: ${t.steps[r.next_step]}`);
  return clean(lines.join('\n'), 3500);
}

function clickToChatUrl(message) {
  return `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

module.exports = { buildMessage, clickToChatUrl };
