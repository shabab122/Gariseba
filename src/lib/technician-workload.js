'use strict';

async function technicianWorkload(db) {
  const [technicians, groups] = await Promise.all([
    db.technicians.find({}, { projection: { name: 1, active: 1 } }).sort({ active: -1, name: 1, _id: 1 }).toArray(),
    db.requests.aggregate([
      { $match: { state: 'submitted', status: { $in: ['received', 'confirmed', 'in_progress'] } } },
      { $group: {
        _id: { $ifNull: ['$technician.id', null] },
        name: { $first: '$technician.name' },
        waiting: { $sum: { $cond: [{ $in: ['$status', ['received', 'confirmed']] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
      } },
    ]).toArray(),
  ]);
  const rows = technicians.map((item) => ({ id: item._id, name: item.name, active: item.active, waiting: 0, inProgress: 0, total: 0 }));
  const byId = new Map(rows.map((item) => [item.id, item]));
  const unassigned = { waiting: 0, inProgress: 0, total: 0 };
  const totals = { waiting: 0, inProgress: 0, total: 0 };
  for (const group of groups) {
    let row = group._id ? byId.get(group._id) : unassigned;
    if (!row) {
      row = { id: group._id, name: group.name || 'Unavailable technician', active: null, waiting: 0, inProgress: 0, total: 0 };
      rows.push(row);
      byId.set(row.id, row);
    }
    for (const key of ['waiting', 'inProgress']) {
      row[key] += group[key];
      totals[key] += group[key];
    }
    row.total = row.waiting + row.inProgress;
  }
  totals.total = totals.waiting + totals.inProgress;
  return { technicians: rows, unassigned, totals, generatedAt: new Date().toISOString() };
}

module.exports = { technicianWorkload };
