'use strict';
const { randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', '.env');
const example = readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
const content = example.replaceAll('generate-with-setup', () => randomBytes(32).toString('hex'));
try {
  writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env. Start MongoDB or set MONGODB_URI before starting GariSeba.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists. Open it in your editor to change settings.');
}
