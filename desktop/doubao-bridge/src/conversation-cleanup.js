'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./runtime-paths');
const { readRecoverableJSON, writeJSON } = require('./json-store');

const file = path.join(dataDir, 'conversation-cleanup.json');
const valid = (v) => v && typeof v.enabled === 'boolean' && Array.isArray(v.pending) && v.pending.every((r) =>
  r && /^acct\d+$/.test(r.accountId) && /^task_[a-zA-Z0-9_]+$/.test(r.taskId) &&
  /^\d+$/.test(r.conversationId) && typeof r.fingerprint === 'string' && r.fingerprint.length > 0 && Number.isInteger(r.attempt) && r.attempt > 0 && Number.isFinite(r.dueAt));
// An old snapshot may contain already-deleted conversations; never replay it.
let store = readRecoverableJSON(file, valid, () => ({ enabled: false, pending: [] })) || { enabled: false, pending: [] };
function persist(next) { writeJSON(file, next, valid); store = next; }
function settings() { return { enabled: store.enabled, delayMinutes: 10 }; }
function isNewConversationPath(value) { return /^\/chat(?:\/local_[a-zA-Z0-9_-]+)?\/?$/.test(value); }
function configure(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  persist({ ...store, enabled });
  return settings();
}
function resultSaved(task, accountId) {
  if (!task || task.status !== 'completed' || task.accountId !== accountId || !Number.isInteger(task.attempt) || task.attempt < 1) return false;
  const result = task.result || {};
  if (result.kind === 'text') {
    if (typeof result.text !== 'string' || !result.text.trim() || task.submissionState !== 'accepted') return false;
  } else if (result.kind === 'image') {
    if (result.cleanupComplete !== true) return false;
    if (!Array.isArray(result.imageFiles) || !result.imageFiles.length || !result.imageFiles.every((f) => {
      if (!f || typeof f.name !== 'string' || path.basename(f.name) !== f.name || !f.name.startsWith(task.id + '-')) return false;
      try { const stat = fs.lstatSync(path.join(dataDir, 'images', f.name)); return stat.isFile() && stat.size === f.bytes && f.bytes > 0; } catch { return false; }
    })) return false;
  } else return false;
  return true;
}
function register(task, accountId, conversationId, fingerprint, now = Date.now()) {
  if (!store.enabled || !resultSaved(task, accountId) || !/^\d+$/.test(conversationId || '') || !fingerprint) return false;
  if (store.pending.some((r) => r.accountId === accountId && r.conversationId === conversationId)) return false;
  persist({ ...store, pending: [...store.pending, { accountId, taskId: task.id, attempt: task.attempt, conversationId, fingerprint, dueAt: now + 600000 }] });
  return true;
}
function due(accountId, now = Date.now()) {
  return store.enabled ? store.pending.find((r) => r.accountId === accountId && r.dueAt <= now) || null : null;
}
function remove(entry) { persist({ ...store, pending: store.pending.filter((r) => !(r.accountId === entry.accountId && r.taskId === entry.taskId && r.attempt === entry.attempt && r.conversationId === entry.conversationId)) }); }
function defer(entry, now = Date.now()) { persist({ ...store, pending: store.pending.map((r) => r.accountId === entry.accountId && r.taskId === entry.taskId && r.attempt === entry.attempt && r.conversationId === entry.conversationId ? { ...r, dueAt: now + 3600000 } : r) }); }
module.exports = { settings, configure, register, due, remove, defer, resultSaved, isNewConversationPath };
