'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DoubaoBrowserHost } = require('../src/doubao-browser-host');

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.visible = options.show;
    this.destroyed = false;
    this.marker = '';
    this.webContents = new EventEmitter();
    this.webContents.session = {
      setPermissionRequestHandler: (handler) => { this.permissionRequestHandler = handler; },
      setPermissionCheckHandler: (handler) => { this.permissionCheckHandler = handler; },
    };
    this.webContents.setUserAgent = (value) => { this.userAgent = value; };
    this.webContents.setAudioMuted = () => {};
    this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
    this.webContents.isDestroyed = () => this.destroyed;
    this.webContents.executeJavaScript = async () => { this.marker = `yingce-doubao:${this.options.webPreferences.partition.split('-').at(-1)}`; };
    this.loadURL = async (url) => { this.url = url; };
  }
  isDestroyed() { return this.destroyed; }
  hide() { this.visible = false; }
  show() { this.visible = true; this.emit('show'); }
  showInactive() { this.visible = true; }
  showAndFocus() { this.visible = true; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}

test('desktop host keeps per-account Doubao windows hidden and isolated', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-browser-host-'));
  const devtools = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/test' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  const cdpPort = devtools.address().port;
  fs.writeFileSync(path.join(root, 'DevToolsActivePort'), `${cdpPort}\n/devtools/browser/test\n`);
  const created = [];
  const host = new DoubaoBrowserHost({
    BrowserWindow: class extends FakeBrowserWindow {
      constructor(options) { super(options); created.push(this); }
    },
    userDataDir: root,
    logger: { warn() {}, error() {} },
  });
  t.after(async () => {
    await host.stop();
    await new Promise((resolve) => devtools.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const info = await host.start();
  assert.equal(info.cdpPort, cdpPort);
  const first = await host.ensure('acct1');
  const second = await host.ensure('acct2');
  assert.equal(created.length, 2);
  assert.equal(created[0].options.show, false);
  assert.equal(created[0].options.skipTaskbar, true);
  assert.equal(created[0].options.webPreferences.devTools, false);
  assert.equal(created[0].options.webPreferences.paintWhenInitiallyHidden, true);
  assert.equal(created[0].visible, false);
  assert.equal(created[0].options.webPreferences.partition, 'persist:peekreel-doubao-acct1');
  assert.equal(created[1].options.webPreferences.partition, 'persist:peekreel-doubao-acct2');
  assert.equal(first.marker, 'yingce-doubao:acct1');
  assert.equal(second.marker, 'yingce-doubao:acct2');
  assert.match(first.userAgent, /Chrome\//);
  assert.deepEqual(created[0].openHandler(), { action: 'deny' });
  assert.equal(created[0].permissionCheckHandler(), false);
  await new Promise((resolve) => created[0].permissionRequestHandler(null, 'notifications', resolve));

  for (const method of ['show', 'showInactive', 'showAndFocus']) {
    created[0][method]();
    assert.equal(created[0].visible, false, `${method}() must not reveal the browser window`);
  }
  created[0].visible = true;
  created[0].emit('show');
  assert.equal(created[0].visible, false, 'the show event must hide unexpected visibility');
  created[0].visible = true;
  created[0].emit('ready-to-show');
  assert.equal(created[0].visible, false, 'ready-to-show must leave the window hidden');

  host.windows.get('acct1').lastUsedAt = Date.now() - 5000;
  assert.deepEqual(host.closeIdle(1000), ['acct1']);
  assert.equal(created[0].destroyed, true);
  assert.equal(created[1].destroyed, false);
  host.windows.get('acct2').lastUsedAt = Date.now() - 5000;
  assert.deepEqual(host.closeIdle(1000), [], 'the last idle window stays warm');
  const third = await host.ensure('acct3');
  host.windows.get('acct2').lastUsedAt = Date.now() - 5000;
  host.busyAccounts.add('acct2');
  assert.deepEqual(host.closeIdle(1000), [], 'busy windows are never evicted');
  assert.equal(second.window.destroyed, false);
  host.busyAccounts.delete('acct2');
  assert.deepEqual(host.closeIdle(1000), ['acct2']);
  assert.equal(third.window.destroyed, false);
});

test('control endpoint requires its random bearer token', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-browser-host-auth-'));
  const devtools = http.createServer((_req, res) => res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://test' })));
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(root, 'DevToolsActivePort'), `${devtools.address().port}\n/devtools/browser/test\n`);
  const host = new DoubaoBrowserHost({ BrowserWindow: FakeBrowserWindow, userDataDir: root, logger: { warn() {} } });
  const info = await host.start();
  t.after(async () => {
    await host.stop();
    await new Promise((resolve) => devtools.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const denied = await fetch(`${info.url}/accounts/acct1/ensure`, { method: 'POST' });
  assert.equal(denied.status, 401);
  const allowed = await fetch(`${info.url}/healthz`);
  assert.equal((await allowed.json()).cdpPort, undefined);
  assert.equal(allowed.status, 200);
  const headers = { Authorization: `Bearer ${info.token}` };
  assert.equal((await fetch(`${info.url}/accounts/acct1/begin`, { method: 'POST', headers })).status, 200);
  await host.ensure('acct1');
  await host.ensure('acct2');
  host.windows.get('acct1').lastUsedAt = Date.now() - 5000;
  const cleanup = await fetch(`${info.url}/maintenance/close-idle?idleMs=1000`, { method: 'POST', headers });
  assert.deepEqual((await cleanup.json()).closed, []);
  await fetch(`${info.url}/accounts/acct1/end`, { method: 'POST', headers });
  assert.equal(host.busyAccounts.has('acct1'), false);
});

test('remote account scope isolates Doubao browser partitions', async () => {
  const created = [];
  const BrowserWindow = class extends FakeBrowserWindow {
    constructor(options) { super(options); created.push(this); }
  };
  const scopeA = 'a'.repeat(64);
  const scopeB = 'b'.repeat(64);
  const first = new DoubaoBrowserHost({ BrowserWindow, userDataDir: '.', accountScope: scopeA });
  const second = new DoubaoBrowserHost({ BrowserWindow, userDataDir: '.', accountScope: scopeB });
  await first.ensure('acct1');
  await second.ensure('acct1');
  assert.equal(created[0].options.webPreferences.partition, `persist:peekreel-doubao-${scopeA}-acct1`);
  assert.equal(created[1].options.webPreferences.partition, `persist:peekreel-doubao-${scopeB}-acct1`);
  assert.notEqual(created[0].options.webPreferences.partition, created[1].options.webPreferences.partition);
  assert.throws(() => new DoubaoBrowserHost({ BrowserWindow, userDataDir: '.', accountScope: '../unsafe' }), /隔离标识/);
  await first.stop();
  await second.stop();
});

test('stopping while a browser window loads prevents it from being published', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let created;
  class DelayedWindow extends FakeBrowserWindow {
    constructor(options) { super(options); created = this; }
    async loadURL() { await gate; }
  }
  const host = new DoubaoBrowserHost({ BrowserWindow: DelayedWindow, userDataDir: '.' });
  const pending = host.ensure('acct1');
  await host.stop();
  assert.equal(created.destroyed, true);
  release();
  await assert.rejects(pending, /已停止/);
  await assert.rejects(host.ensure('acct1'), /已停止/);
  assert.equal(host.windows.size, 0);
});
