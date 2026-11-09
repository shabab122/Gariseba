'use strict';
const { businessSettings } = require('../db');

const STATUSES = ['received', 'confirmed', 'in_progress', 'completed', 'cancelled', 'out_of_area'];
const STATUS_TEXT = {
  received: { en: 'Request received. A technician is pending confirmation.', bn: 'অনুরোধ গ্রহণ করা হয়েছে। টেকনিশিয়ানের নিশ্চিতকরণের অপেক্ষায় আছে।' },
  confirmed: { en: 'Our team has confirmed your request.', bn: 'আমাদের টিম আপনার অনুরোধ নিশ্চিত করেছে।' },
  in_progress: { en: 'Work is in progress.', bn: 'কাজ চলছে।' },
  completed: { en: 'The request is complete.', bn: 'অনুরোধের কাজ সম্পন্ন হয়েছে।' },
  cancelled: { en: 'The request was cancelled.', bn: 'অনুরোধ বাতিল করা হয়েছে।' },
  out_of_area: { en: 'The location is outside our service area.', bn: 'অবস্থানটি আমাদের সেবা এলাকার বাইরে।' },
};

const normalizeArea = (text) => (text || '').normalize('NFC').toLowerCase().replace(/[\u200c\u200d]/g, '').trim();
const terms = (text) => text.split(',').map(normalizeArea).filter(Boolean);
function containsTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{M}\\p{N}])`, 'u').test(text);
}
async function matchArea(db, text) {
  const location = normalizeArea(text);
  const [settings, areas] = await Promise.all([businessSettings(db), db.areas.find({ active: true }).sort({ _id: 1 }).toArray()]);
  if (terms(settings.outside_keywords).some((term) => containsTerm(location, term))) return { status: 'outside' };
  const matches = areas.filter((area) =>
    [normalizeArea(area.name_en), normalizeArea(area.name_bn), ...terms(area.keywords)]
      .filter(Boolean).some((term) => containsTerm(location, term))
  );
  const area = matches.find((row) => row._id !== 'dhaka') || matches[0];
  return area ? { status: 'inside', area } : { status: 'unknown' };
}

async function pricingInfo(db) {
  const settings = await businessSettings(db);
  return { batteryStartBdt: settings.battery_start_bdt, pricingIsSample: settings.pricing_is_sample };
}
async function estimateFor(db, category, lang) {
  const [rows, info] = await Promise.all([
    db.pricing.find({ active: true, category }).sort({ min_bdt: 1 }).toArray(),
    pricingInfo(db),
  ]);
  if (!rows.length) return null;
  return {
    min: Math.min(...rows.map((r) => r.min_bdt)),
    max: Math.max(...rows.map((r) => r.max_bdt)),
    currency: 'BDT',
    sample: info.pricingIsSample || rows.some((row) => row.sample),
    basis: rows.map((r) => ({
      code: r._id, label: lang === 'bn' ? r.label_bn : r.label_en,
      min: r.min_bdt, max: r.max_bdt, note: lang === 'bn' ? r.note_bn : r.note_en,
    })),
  };
}

module.exports = { STATUSES, STATUS_TEXT, matchArea, pricingInfo, estimateFor };
