'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readJSON(file, validate) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(text);
  if (!validate(value)) {
    const error = new Error(`Invalid store: ${path.basename(file)}; restore a verified backup before starting`);
    error.code = 'INVALID_STORE';
    throw error;
  }
  return value;
}

// Only stores with an explicit recovery policy may fall back to an older snapshot.
function readRecoverableJSON(file, validate, recover) {
  let originalError;
  try {
    const value = readJSON(file, validate);
    if (value !== null || !fs.existsSync(file + '.backup')) return value;
    originalError = new Error(`Missing store: ${path.basename(file)}`);
  } catch (error) {
    if (!(error instanceof SyntaxError) && error.code !== 'INVALID_STORE') throw error;
    originalError = error;
  }
  let backup;
  try { backup = readJSON(file + '.backup', validate); }
  catch { throw originalError; }
  if (backup === null) throw originalError;
  const value = recover(backup);
  if (!validate(value)) throw new Error(`Invalid recovered store: ${path.basename(file)}`);
  const suffix = `.recovery-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  // Keep both inputs before replacing the primary: later writes rotate .backup.
  fs.copyFileSync(file + '.backup', file + suffix + '.backup', fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(file)) fs.copyFileSync(file, file + suffix + '.corrupt', fs.constants.COPYFILE_EXCL);
  atomicWrite(file, JSON.stringify(value));
  console.warn(`[store] ${path.basename(file)} recovered from an older backup; original and snapshot preserved`);
  return value;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Antivirus/indexers can briefly hold the destination on Windows. Keep the
    // original intact and retry only sharing-related failures for a bounded time.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
      }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

function writeJSON(file, value, validate) {
  if (!validate(value)) throw new Error(`Invalid store write: ${path.basename(file)}`);
  // A damaged primary must never be replaced with an empty in-memory store.
  const previous = readJSON(file, validate);
  if (previous !== null) atomicWrite(file + '.backup', JSON.stringify(previous));
  atomicWrite(file, JSON.stringify(value));
}

module.exports = { readJSON, readRecoverableJSON, writeJSON, atomicWrite };
