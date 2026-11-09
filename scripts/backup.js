'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../src/config');

function main() {
  const folder = path.resolve(process.argv[2] || 'backups');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const archive = path.join(folder, `gariseba-${new Date().toISOString().replace(/[:.]/g, '-')}.archive.gz`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gariseba-backup-'));
  try {
    const authFile = path.join(temp, 'mongo.yml');
    fs.writeFileSync(authFile, JSON.stringify({ uri: config.mongoUri }), { mode: 0o600 });
    const descriptor = fs.openSync(archive, 'wx', 0o600);
    let result;
    try {
      result = spawnSync('mongodump', ['--config', authFile, '--db', config.mongoDb, '--excludeCollection', 'sessions', '--archive', '--gzip', '--quiet'], {
        stdio: ['ignore', descriptor, 'ignore'],
      });
    } finally {
      fs.closeSync(descriptor);
    }
    if (result.status !== 0) {
      fs.unlinkSync(archive);
      throw new Error(result.error?.code === 'ENOENT'
        ? 'Install MongoDB Database Tools and add mongodump to PATH.'
        : 'mongodump failed. Check the MongoDB connection and backup permissions.');
    }
    console.log(`Backup saved to ${archive}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
