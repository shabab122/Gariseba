'use strict';
const { clean, digits, normalizePhone } = require('./validate');
const { HttpError } = require('./http');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function customerSearch(value = '') {
  if (typeof value !== 'string' || value.length > 80) {
    throw new HttpError(422, 'validation', 'Enter a customer name or phone number up to 80 characters.');
  }
  const text = clean(value, 80);
  if (!text) return {};
  const name = text.split(/\s+/u).map(escapeRegex).join('\\s+');
  const alternatives = [{ customer_name: { $regex: name, $options: 'i' } }];
  const normalized = digits(text);
  if (/^[\d\s()+-]+$/.test(normalized)) {
    const number = normalized.replace(/\D/g, '');
    if (number.length < 3 || number.length > 13) {
      throw new HttpError(422, 'validation', 'Enter 3 to 13 phone digits, or search by customer name.');
    }
    const numbers = new Set([number]);
    const full = normalizePhone(text);
    if (full) {
      numbers.add(full.slice(1));
      numbers.add('0' + full.slice(4));
    }
    // Imported requests can retain local prefixes, separators or Bangla digits.
    const patterns = [...numbers].map((phone) => [...phone].map((digit) =>
      '[' + digit + String.fromCharCode(0x09e6 + Number(digit)) + ']'
    ).join('[\\s()\\-]*'));
    alternatives.push({ callback_phone: { $regex: '(?:' + patterns.join('|') + ')' } });
  }
  return { $or: alternatives };
}

module.exports = { customerSearch };
