'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { syncDirectChannelsAtBoot } = require('../src/direct-channels');
const { startLocalServer } = require('../src/local-server');

test('first activation synchronizes local bridge credentials from the main process', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-sync-'));
    const originalFetch = global.fetch;
    const originalSeed = global.PeekReelSeed;
    try {
        fs.writeFileSync(path.join(dir, 'seed-core.js'), `globalThis.PeekReelSeed = {
            syncDirectChannels: async (api, catalog, log, local) => {
                await api('/api/admin/channels');
                return { synced: local.doubao.apiKey === 'private-bridge-token' ? 1 : 0 };
            }
        };`);
        const calls = [];
        global.fetch = async (url, init) => {
            calls.push({ url, cookie: init.headers.Cookie });
            return new Response(JSON.stringify({ code: 0, data: {} }), {
                headers: url.endsWith('/login') ? { 'set-cookie': 'session=abc; HttpOnly' } : {},
            });
        };
        const result = await syncDirectChannelsAtBoot({
            backendBaseUrl: 'http://127.0.0.1:18080', catalogUrl: 'https://catalog.example',
            activation: { username: 'user', password: 'pass' }, activationDir: dir,
            localChannels: { doubao: { baseUrl: 'http://127.0.0.1:8787', apiKey: 'private-bridge-token' } },
            log: () => {},
        });
        assert.equal(result.direct.synced, 1);
        assert.equal(calls[1].cookie, 'session=abc');
    } finally {
        global.fetch = originalFetch;
        global.PeekReelSeed = originalSeed;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('activation configuration never returns bridge credentials', async () => {
    const reservation = net.createServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const server = await startLocalServer(os.tmpdir(), 'http://127.0.0.1:18080', {
        port, getDoubaoBridge: () => ({ token: 'private-bridge-token' }),
    });
    try {
        const response = await fetch(`${server.url}/peekreel-activation/config`);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.doesNotMatch(body, /private-bridge-token|doubaoBridge/);
    } finally { await new Promise((resolve) => server.server.close(resolve)); }
});

test('account cancellation rejects a late catalog response before any channel writes', async () => {
    const previousSeed = global.PeekReelSeed;
    const controller = new AbortController();
    let releaseCatalog;
    let catalogStarted;
    const started = new Promise((resolve) => { catalogStarted = resolve; });
    const catalog = new Promise((resolve) => { releaseCatalog = resolve; });
    const calls = [];
    try {
        const syncing = syncDirectChannelsAtBoot({
            backendBaseUrl: 'http://127.0.0.1:18080', catalogUrl: 'https://catalog.example',
            activation: { username: 'local', password: 'secret' },
            activationDir: path.resolve(__dirname, '../activation'), signal: controller.signal,
            fetchImpl: async (url, options) => {
                calls.push({ url, signal: options.signal });
                if (url === 'https://catalog.example') { catalogStarted(); return catalog; }
                return new Response(JSON.stringify({ code: 0, data: {} }), { headers: { 'set-cookie': 'session=local; HttpOnly' } });
            },
            log: () => {},
        });
        await started;
        controller.abort();
        releaseCatalog(new Response(JSON.stringify({ channels: [{ name: 'stale' }] })));
        await assert.rejects(syncing, { name: 'AbortError' });
        assert.deepEqual(calls.map((call) => call.url), ['http://127.0.0.1:18080/api/auth/login', 'https://catalog.example']);
        assert.ok(calls.every((call) => call.signal === controller.signal));
    } finally { global.PeekReelSeed = previousSeed; }
});

test('HTTP failure cannot be treated as successful local login even with a success envelope', async () => {
    const previousSeed = global.PeekReelSeed;
    try {
        const result = await syncDirectChannelsAtBoot({
            backendBaseUrl: 'http://127.0.0.1:18080', catalogUrl: 'https://catalog.example',
            activation: { username: 'local', password: 'secret' },
            activationDir: path.resolve(__dirname, '../activation'),
            fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 500 }),
            log: () => {},
        });
        assert.deepEqual(result, { skipped: 'login-failed' });
    } finally { global.PeekReelSeed = previousSeed; }
});
