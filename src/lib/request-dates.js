'use strict';
const { HttpError } = require('./http');

function dhakaDayStart(value) {
  if (value === undefined || value === '') return null;
  const invalid = () => new HttpError(422, 'validation', 'Enter valid dates in YYYY-MM-DD format.');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  const utcDate = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== value) throw invalid();
  return new Date(value + 'T00:00:00+06:00');
}

module.exports = { dhakaDayStart };
