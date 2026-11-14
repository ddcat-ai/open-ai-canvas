const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { startLocalServer } = require("../src/local-server");
const { createYingceSystemRelay, createYingceAccountRelay, systemProviderPath } = require("../src/yingce-system-relay");

async function listen(server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
}

test("system relay is same-origin or local-key gated and injects only the remote session", async (t) => {
    let captured;
    const remote = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            captured = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
            res.writeHead(202, { "content-type": "text/event-stream", "cache-control": "private" });
            res.end("data: accepted\n\n");
        });
    });
    const remotePort = await listen(remote);
    t.after(() => remote.close());

    let session = "remote-session";
    const relay = createYingceSystemRelay({
        apiUrl: `http://127.0.0.1:${remotePort}/api`,
        getSession: () => session,
        getRelayKey: () => "local-relay-key",
        getLocalSession: () => "local-session",
    });
    const local = await startLocalServer(".", null, { port: await listenPort(), lite: true, yingceSystemRelay: relay });
    t.after(() => new Promise((resolve) => local.server.close(resolve)));

    const response = await fetch(`${local.url}/api/ai/system/channel_1/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-idempotency-key": "intent-1",
            "sec-fetch-site": "same-origin",
            origin: local.url,
            cookie: "open_ai_canvas_session=local-session",
            authorization: "Bearer renderer-value",
            "x-yingce-lite-relay-key": "not-the-key",
        },
        body: "{\"model\":\"m\"}",
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.match(await response.text(), /data: accepted/);
    assert.equal(captured.method, "POST");
    assert.equal(captured.url, "/api/ai/system/channel_1/v1/chat/completions?stream=true");
    assert.equal(captured.headers.authorization, "Bearer remote-session");
    assert.equal(captured.headers["x-idempotency-key"], "intent-1");
    assert.equal(captured.headers.cookie, undefined);
    assert.equal(captured.headers["x-yingce-lite-relay-key"], undefined);

    const internal = await fetch(`${local.url}/api/ai/system/channel_1/v1/models`, {
        headers: { "x-yingce-lite-relay-key": "local-relay-key" },
    });
    assert.equal(internal.status, 202);
    await internal.text();

    session = "";
    const offline = await fetch(`${local.url}/api/ai/system/channel_1/v1/models`, {
        headers: { "x-yingce-lite-relay-key": "local-relay-key" },
    });
    assert.equal(offline.status, 401);
    await offline.text();
});

test("system relay rejects non-local callers, unrelated routes, and path escapes", async (t) => {
    const remote = http.createServer((_req, res) => res.end("unexpected"));
    const remotePort = await listen(remote);
    t.after(() => remote.close());
    const relay = createYingceSystemRelay({ apiUrl: `http://127.0.0.1:${remotePort}/api`, getSession: () => "session", getRelayKey: () => "key", getLocalSession: () => "cookie" });
    const local = await startLocalServer(".", null, { port: await listenPort(), lite: true, yingceSystemRelay: relay });
    t.after(() => new Promise((resolve) => local.server.close(resolve)));

    const denied = await fetch(`${local.url}/api/ai/system/channel/v1/models`, { headers: { origin: "https://attacker.test", cookie: "open_ai_canvas_session=cookie" } });
    assert.equal(denied.status, 403);
    await denied.text();
    assert.equal(systemProviderPath("/api/ai/system/channel/%2F..%2Fsecret"), null);
    assert.equal(systemProviderPath("/api/ai/system/channel/../secret"), null);
    assert.equal(systemProviderPath("/api/wallet"), null);
});

test("account relay exposes only wallet reads and writes through the active local session", async (t) => {
    let captured;
    const remote = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            captured = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 0, data: { remote: true } }));
        });
    });
    const remotePort = await listen(remote);
    t.after(() => remote.close());
    const relay = createYingceAccountRelay({
        apiUrl: `http://127.0.0.1:${remotePort}/api`,
        getSession: () => "remote-session",
        getLocalSession: () => "local-session",
    });
    const local = await startLocalServer(".", null, { port: await listenPort(), lite: true, yingceAccountRelay: relay });
    t.after(() => new Promise((resolve) => local.server.close(resolve)));

    const response = await fetch(`${local.url}/api/wallet?page=3&pageSize=10`, {
        headers: { "sec-fetch-site": "same-origin", origin: local.url, cookie: "open_ai_canvas_session=local-session" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: 0, data: { remote: true } });
    assert.equal(captured.url, "/api/wallet?page=3&pageSize=10");
    assert.equal(captured.headers.authorization, "Bearer remote-session");
    assert.equal(captured.headers.cookie, undefined);

    const blocked = await fetch(`${local.url}/api/admin/users`, {
        headers: { "sec-fetch-site": "same-origin", origin: local.url, cookie: "open_ai_canvas_session=local-session" },
    });
    assert.equal(blocked.status, 403);
    await blocked.text();
    const readOnly = await fetch(`${local.url}/api/ecommerce/knowledge/orchestration`, {
        method: "PUT",
        headers: { "sec-fetch-site": "same-origin", origin: local.url, cookie: "open_ai_canvas_session=local-session", "content-type": "application/json" },
        body: "{}",
    });
    assert.equal(readOnly.status, 403);
    await readOnly.text();
});

test("Lite auth session maps local runtime features to the remote account identity", async (t) => {
    const backend = http.createServer((req, res) => {
        if (req.url !== "/api/auth/session") return res.writeHead(404).end();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: 0, data: { user: { id: "local-admin", username: "lite_admin", role: "admin" }, features: { canvas: true } } }));
    });
    const backendPort = await listen(backend);
    t.after(() => backend.close());
    const local = await startLocalServer(".", `http://127.0.0.1:${backendPort}`, { port: await listenPort(), lite: true, getYingceUser: () => ({ id: "remote-user", username: "writer", displayName: "Writer" }) });
    t.after(() => new Promise((resolve) => local.server.close(resolve)));
    const response = await fetch(`${local.url}/api/auth/session`);
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.data.user.id, "remote-user");
    assert.equal(envelope.data.user.role, "user");
    assert.equal(envelope.data.features.canvas, true);
    assert.equal(JSON.stringify(envelope).includes("local-admin"), false);
});

async function listenPort() {
    const server = http.createServer();
    const port = await listen(server);
    await new Promise((resolve) => server.close(resolve));
    return port;
}
