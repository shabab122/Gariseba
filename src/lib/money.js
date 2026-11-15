'use strict';
const { digits } = require('./validate');
const { HttpError } = require('./http');
const money = (poisha) => (poisha / 100).toFixed(2);
function parseMoney(value) {
  const text = typeof value === 'number' ? String(value) : digits(typeof value === 'string' ? value.trim() : '');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) throw new HttpError(422, 'validation', 'Enter an amount with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
module.exports = { money, parseMoney };
