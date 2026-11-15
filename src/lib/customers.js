'use strict';
const { HttpError } = require('./http');
const sec = require('./security');
const usernameOf = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
function validPassword(value) {
  return typeof value === 'string' && Array.from(value).length >= 15 && Buffer.byteLength(value, 'utf8') <= 72;
}
const publicCustomer = (row) => row ? { username: row.username, name: row.name } : null;
async function currentCustomer(db, req) {
  const session = req.session?.customer;
  if (!session || typeof session.id !== 'string') return null;
  return db.customers.findOne({ _id: session.id, authVersion: session.authVersion, enabled: true }, { projection: { username: 1, name: 1, authVersion: 1 } });
}
function requireCustomer(db) {
  return async (req, res, next) => {
    const row = await currentCustomer(db, req);
    if (!row) throw new HttpError(401, 'customer_auth', 'Sign in to your customer account.');
    req.customer = row; next();
  };
}
async function rotateCustomerSession(req, row) {
  const { draftId, admin } = req.session;
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  if (draftId) req.session.draftId = draftId;
  if (admin) req.session.admin = admin;
  if (row) req.session.customer = { id: row._id, authVersion: row.authVersion };
  return sec.ensureSession(req);
}
module.exports = { usernameOf, validPassword, publicCustomer, currentCustomer, requireCustomer, rotateCustomerSession };
