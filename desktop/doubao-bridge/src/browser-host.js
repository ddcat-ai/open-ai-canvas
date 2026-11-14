'use strict';

// The desktop process owns Chromium and creates one hidden Electron window per
// Doubao account. The bridge may attach over CDP, but never launches a browser.
const ACCOUNT_ID = /^acct\d+$/;
const HOST_URL = String(process.env.DOUBAO_BROWSER_HOST_URL || '').replace(/\/$/, '');
const HOST_TOKEN = process.env.DOUBAO_BROWSER_HOST_TOKEN || '';
const CDP_PORT = Number(process.env.DOUBAO_BROWSER_CDP_PORT) || 0;
const MARKER_PREFIX = 'yingce-doubao:';

async function request(path, method = 'GET') {
  if (!HOST_URL || !HOST_TOKEN || !CDP_PORT) throw new Error('客户端 Chromium 宿主配置缺失');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(HOST_URL + path, {
      method,
      headers: { Authorization: `Bearer ${HOST_TOKEN}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Chromium 宿主请求失败 (${response.status})`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function ensure(accountId) {
  if (!ACCOUNT_ID.test(String(accountId || ''))) throw new Error('豆包账号标识无效');
  const result = await request(`/accounts/${accountId}/ensure`, 'POST');
  if (result.accountId !== accountId || result.cdpPort !== CDP_PORT || result.pageMarker !== MARKER_PREFIX + accountId) {
    throw new Error('客户端 Chromium 宿主返回了不匹配的账号窗口');
  }
  return {
    port: CDP_PORT,
    pageMarker: result.pageMarker,
    userAgent: result.userAgent,
    reused: true,
    family: 'electron-chromium',
  };
}

async function stop(accountId) {
  if (!ACCOUNT_ID.test(String(accountId || ''))) return false;
  await request(`/accounts/${accountId}`, 'DELETE');
  return true;
}

async function touch(accountId) {
  if (!ACCOUNT_ID.test(String(accountId || ''))) return false;
  await request(`/accounts/${accountId}/touch`, 'POST');
  return true;
}

async function setBusy(accountId, busy) {
  if (!ACCOUNT_ID.test(String(accountId || ''))) throw new Error('豆包账号标识无效');
  await request(`/accounts/${accountId}/${busy ? 'begin' : 'end'}`, 'POST');
}

async function stopIdle(idleMs) {
  const result = await request(`/maintenance/close-idle?idleMs=${encodeURIComponent(Number(idleMs))}`, 'POST');
  return Array.isArray(result.closed) ? result.closed : [];
}

module.exports = { ensure, stop, touch, setBusy, stopIdle, ACCOUNT_ID, MARKER_PREFIX };
