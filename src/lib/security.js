'use strict';
const crypto = require('node:crypto');
const session = require('express-session');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const idleMs = 2 * 60 * 60 * 1000;
const cookieName = config.isProd ? '__Host-gariseba.sid' : 'gariseba.sid';
const cookie = { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: idleMs, path: '/' };

class MongoSessions extends session.Store {
  constructor(collection) {
    super();
    this.collection = collection;
  }

  get(id, done) {
    this.collection.findOne({ _id: id, expiresAt: { $gt: new Date() } })
      .then((row) => done(null, row?.data ?? null), done);
  }

  set(id, data, done = () => {}) {
    const expiresAt = data.cookie.expires ? new Date(data.cookie.expires) : new Date(Date.now() + idleMs);
    this.collection.updateOne({ _id: id }, { $set: { data, expiresAt } }, { upsert: true })
      .then(() => done(null), done);
  }

  touch(id, data, done = () => {}) {
    const expiresAt = data.cookie.expires ? new Date(data.cookie.expires) : new Date(Date.now() + idleMs);
    this.collection.updateOne({ _id: id }, { $max: { expiresAt } })
      .then(() => done(null), done);
  }

  destroy(id, done = () => {}) {
    this.collection.deleteOne({ _id: id }).then(() => done(null), done);
  }
}

function sessionMiddleware(db) {
  return session({
    name: cookieName, secret: config.sessionSecret, store: new MongoSessions(db.sessions),
    resave: false, saveUninitialized: false, rolling: true, cookie,
  });
}

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
function ensureSession(req) {
  req.session.csrf ||= randomToken();
  req.session.draftId ||= randomToken();
  return req.session.csrf;
}
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const received = req.get('x-csrf-token') || '';
  const expected = req.session?.csrf;
  if (!expected || !/^[A-Za-z0-9_-]{32}$/.test(received) ||
      !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return res.status(403).json({ error: 'csrf', message: 'Your session expired. Refresh the page and try again.' });
  }
  next();
}
function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex'), right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function publicCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return 'LN-' + Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}
const trackingToken = (draftId) => crypto.createHmac('sha256', config.sessionSecret)
  .update('gariseba-tracking:' + draftId).digest('base64url');

async function audit(db, req, actor, event, target = null) {
  try {
    await db.audit.insertOne({
      at: new Date(), actor, event, target,
      ip_hash: crypto.createHmac('sha256', config.ipSalt).update(req.ip || '').digest('hex').slice(0, 24),
    });
  } catch (error) {
    console.error('[audit] Write failed:', error.name);
  }
}

function limiter(minutes, limit) {
  return rateLimit({
    windowMs: minutes * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' }),
  });
}
function makeLimits() {
  return {
    general: limiter(1, 220), submit: limiter(15, 15), upload: limiter(10, 30),
    chat: limiter(5, 30), lookup: limiter(15, 25), login: limiter(15, 12), admin: limiter(1, 160),
  };
}

const roleRank = { viewer: 1, dispatcher: 2, owner: 3 };
function requireAdmin(db, role = 'viewer') {
  return async (req, res, next) => {
    const admin = req.session?.admin;
    const row = admin && await db.adminUsers.findOne({ _id: admin.id }, { projection: { role: 1, authVersion: 1 } });
    if (!row || row.authVersion !== admin.authVersion || !Object.hasOwn(roleRank, row.role)) {
      return res.status(401).json({ error: 'auth', message: 'Sign in to continue.' });
    }
    if (roleRank[row.role] < roleRank[role]) {
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot perform this action.' });
    }
    req.admin = { username: row._id, role: row.role };
    next();
  };
}

module.exports = {
  audit, cookie, cookieName, csrfProtect, ensureSession, makeLimits, publicCode, randomToken,
  requireAdmin, roleRank, safeEqualHex, sessionMiddleware, sha256, trackingToken,
};
