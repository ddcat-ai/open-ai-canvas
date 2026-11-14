const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { startLocalServer } = require("../src/local-server");

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

test("switching local account closes old streams and blocks requests until the new backend is ready", async (t) => {
    let oldClosed;
    const disconnected = new Promise((resolve) => { oldClosed = resolve; });
    const oldBackend = http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: old\n\n");
        res.on("close", oldClosed);
    });
    const newBackend = http.createServer((_req, res) => res.end("new account"));
    const oldPort = await listen(oldBackend);
    const newPort = await listen(newBackend);
    const reservation = http.createServer();
    const port = await listen(reservation);
    await close(reservation);
    const local = await startLocalServer(__dirname, `http://127.0.0.1:${oldPort}`, { port });
    t.after(async () => { await close(local.server); await close(oldBackend); await close(newBackend); });

    const stream = await new Promise((resolve, reject) => {
        const request = http.get(`${local.url}/api/events`, (response) => {
            response.once("data", () => resolve(response));
        });
        request.on("error", reject);
    });
    const streamClosed = new Promise((resolve) => stream.on("close", resolve));
    local.setBackend(null);
    await Promise.all([streamClosed, disconnected]);
    const unavailable = await fetch(`${local.url}/api/test`);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).reason, "account_unavailable");
    local.setBackend(`http://127.0.0.1:${newPort}`);
    const response = await fetch(`${local.url}/api/test`);
    assert.equal(await response.text(), "new account");
});

test("account invalidation disconnects bridge streams and blocks new bridge requests", async (t) => {
    let bridgeClosed;
    const disconnected = new Promise((resolve) => { bridgeClosed = resolve; });
    const bridge = http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: old\n\n");
        res.on("close", bridgeClosed);
    });
    const bridgePort = await listen(bridge);
    const reservation = http.createServer();
    const port = await listen(reservation);
    await close(reservation);
    const local = await startLocalServer(__dirname, "http://127.0.0.1:1", {
        port, getDoubaoBridge: () => ({ baseUrl: `http://127.0.0.1:${bridgePort}`, adminToken: "test" }),
    });
    t.after(async () => { await close(local.server); await close(bridge); });
    const headers = { "sec-fetch-site": "same-origin" };
    const stream = await new Promise((resolve, reject) => {
        const request = http.get(`${local.url}/doubao-bridge/v1/events`, { headers }, (response) => {
            response.once("data", () => resolve(response));
        });
        request.on("error", reject);
    });
    const streamClosed = new Promise((resolve) => stream.on("close", resolve));
    local.setBackend(null);
    await Promise.all([streamClosed, disconnected]);
    const response = await fetch(`${local.url}/doubao-bridge/v1/events`, { headers });
    assert.equal(response.status, 503);
});

test("Lite serves only its account page and rejects legacy relay endpoints", async (t) => {
    const reservation = http.createServer();
    const port = await listen(reservation);
    await close(reservation);
    const local = await startLocalServer(__dirname, null, {
        port, lite: true, activationDir: path.join(__dirname, "..", "activation"),
        relayUrl: "https://example.com",
    });
    t.after(() => close(local.server));
    const page = await fetch(`${local.url}/peekreel-activation`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /lite\.js/);
    for (const route of ["/peekreel-activation/config", "/peekreel-activation/index.html", "/peekreel-activation/seed-core.js", "/peekreel-relay/v1/models", "/peekreel-passport/api/user/login", "/peekreel-remote/api/auth/session"]) {
        assert.equal((await fetch(`${local.url}${route}`)).status, 404, route);
    }
    assert.equal((await fetch(`${local.url}/peekreel-activation/lite-policy.js`)).status, 200);
});
