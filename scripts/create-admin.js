'use strict';
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const bcrypt = require('bcryptjs');
const { connectDatabase } = require('../src/db');
const { roleRank } = require('../src/lib/security');

async function askPassword() {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or set ADMIN_PASSWORD for this command.');
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const terminal = readline.createInterface({ input: process.stdin, output: silent, terminal: true });
  process.stdout.write('Password (hidden, 12+ characters, include a letter and a digit): ');
  try {
    return await terminal.question('');
  } finally {
    terminal.close();
    process.stdout.write('\n');
  }
}

async function main() {
  const [username, role = 'owner'] = process.argv.slice(2);
  if (!/^[a-z0-9._-]{3,40}$/.test(username || '') || !Object.hasOwn(roleRank, role)) {
    throw new Error('Usage: npm run create-admin -- <username> <owner|dispatcher|viewer>');
  }
  const password = process.env.ADMIN_PASSWORD || await askPassword();
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw new Error('Use at least 12 characters and at most 72 UTF-8 bytes, with a letter and a digit.');
  }
  const db = await connectDatabase();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.adminUsers.updateOne({ _id: username }, {
      $set: { passwordHash, role, failedLogins: 0, lockedUntil: null },
      $setOnInsert: { created_at: new Date() }, $inc: { authVersion: 1 },
    }, { upsert: true });
    console.log(`Saved ${username} with role ${role}. Any existing sessions for this account were revoked.`);
  } finally {
    await db.client.close();
  }
}

main().catch((error) => {
  console.error('Could not save staff account.', error.name === 'Error' ? error.message : error.name);
  process.exitCode = 1;
});
