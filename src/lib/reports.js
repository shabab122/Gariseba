'use strict';
const { HttpError } = require('./http');
const { TYPES } = require('./validate');
const { STATUSES } = require('./business');
const { dhakaDayStart } = require('./request-dates');

async function requestReport(db, query) {
  const from = dhakaDayStart(query.from);
  const to = dhakaDayStart(query.to);
  const dayMs = 24 * 60 * 60 * 1000;
  if (!from || !to || from > to || to - from >= 366 * dayMs) {
    throw new HttpError(422, 'validation', 'Choose a date range of 1 to 366 days, with the start on or before the end.');
  }
  const { type = '', status = '' } = query;
  if (type !== '' && !TYPES.includes(type)) throw new HttpError(422, 'validation', 'Choose a valid request type.');
  if (status !== '' && !STATUSES.includes(status)) throw new HttpError(422, 'validation', 'Choose a valid status.');
  const criteria = { state: 'submitted', created_at: { $gte: from, $lt: new Date(to.getTime() + dayMs) } };
  if (type) criteria.request_type = type;
  if (status) criteria.status = status;
  const rows = await db.requests.aggregate([
    { $match: criteria },
    { $group: {
      _id: { date: { $dateToString: { date: '$created_at', format: '%Y-%m-%d', timezone: 'Asia/Dhaka' } }, type: '$request_type', status: '$status' },
      count: { $sum: 1 },
    } },
    { $sort: { '_id.date': 1, '_id.type': 1, '_id.status': 1 } },
    { $project: { _id: 0, date: '$_id.date', type: '$_id.type', status: '$_id.status', count: 1 } },
  ]).toArray();
  let total = 0;
  const types = new Map();
  const statuses = new Map();
  for (const row of rows) {
    total += row.count;
    types.set(row.type, (types.get(row.type) || 0) + row.count);
    statuses.set(row.status, (statuses.get(row.status) || 0) + row.count);
  }
  return {
    from: query.from, to: query.to, type, status, total, rows, generatedAt: new Date().toISOString(),
    byType: Array.from(types, ([value, count]) => ({ value, count })),
    byStatus: Array.from(statuses, ([value, count]) => ({ value, count })),
  };
}

function reportCsv(report) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const records = [
    ['Date (Dhaka)', 'Request type', 'Status', 'Count'],
    ...report.rows.map((row) => [row.date, row.type, row.status, row.count]),
  ];
  return '\uFEFF' + records.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { requestReport, reportCsv };
