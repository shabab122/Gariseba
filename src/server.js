'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const config = require('./config');
const { connectDatabase, ensureDefaults } = require('./db');
const { publicRoutes } = require('./routes/public');
const { adminRoutes } = require('./routes/admin');
const { HttpError } = require('./lib/http');
const sec = require('./lib/security');

function createApp(db, { analyzer, aiConnectionTest } = {}) {
  const app = express();
  const limits = sec.makeLimits();
  const dist = path.join(config.root, 'dist');
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'], 'connect-src': ["'self'"], 'font-src': ["'self'"],
      'object-src': ["'none'"], 'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': config.isProd ? [] : null,
    } },
    strictTransportSecurity: config.isProd ? undefined : false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'geolocation=(self), microphone=(), camera=(self)');
    if (config.isProd && !req.secure) return res.redirect(308, config.publicUrl.origin + req.originalUrl);
    next();
  });
  app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await db.db.command({ ping: 1 }, { timeoutMS: 1800 });
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, limits.general, express.json({ limit: '50kb' }), sec.sessionMiddleware(db), sec.csrfProtect);
  app.use('/api', publicRoutes(db, limits, analyzer));
  app.use('/api/admin', adminRoutes(db, limits, aiConnectionTest));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'This endpoint does not exist.' }));

  app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));
  app.use(express.static(dist, {
    index: false, dotfiles: 'ignore',
    setHeaders(res, file) {
      res.set('Cache-Control', file.startsWith(path.join(dist, 'assets') + path.sep)
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.get(['/', '/request', '/assistant', '/track', '/privacy', '/admin'], (req, res) => {
    const index = path.join(dist, 'index.html');
    res.set('Cache-Control', 'no-cache');
    if (!fs.existsSync(index)) return res.status(503).type('text').send('Run npm run build, or use the Vite URL printed by npm run dev.');
    res.sendFile(index);
  });
  app.use((req, res) => res.status(404).type('text').send('Page not found.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.code, message: error.message, ...error.details });
    }
    if (error instanceof multer.MulterError) {
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'upload', message: 'Upload one image up to 5 MB.',
      });
    }
    const photoErrors = {
      bad_type: [415, 'Choose a JPEG, PNG or WebP image.'],
      bad_image: [422, 'This photo could not be read.'],
      too_large: [413, 'This photo is too large after compression.'],
      infected: [422, 'The photo failed the safety scan.'],
      scan_error: [503, 'The safety scanner is unavailable. Try again later.'],
    };
    if (Object.hasOwn(photoErrors, error.code)) {
      const [status, message] = photoErrors[error.code];
      return res.status(status).json({ error: error.code, message });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'The request is too large.' });
    console.error('[server]', error.name, error.code || '');
    res.status(500).json({ error: 'server', message: 'Something went wrong. Please try again.' });
  });
  return app;
}

async function main() {
  const db = await connectDatabase();
  try {
    await ensureDefaults(db);
    const server = createApp(db).listen(config.port, config.host, () => {
      console.log(`GariSeba listening on http://${config.host}:${server.address().port} | /admin`);
      console.log(`Assistant: ${config.aiConfigured ? 'provider configured' : 'built-in guidance'}`);
    });
    server.on('error', async (error) => {
      console.error('Could not listen:', error.code || error.name);
      await db.client.close();
      process.exitCode = 1;
    });
    const shutdown = () => server.close(() => db.client.close());
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    await db.client.close();
    throw error;
  }
}

if (require.main === module) main().catch((error) => {
  console.error('Could not start GariSeba. Check MONGODB_URI, MongoDB availability and .env settings.', error.name);
  process.exitCode = 1;
});

module.exports = { createApp };
