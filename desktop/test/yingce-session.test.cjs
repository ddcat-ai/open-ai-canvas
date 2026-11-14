const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { normalizeApiUrl, accountScope, createSessionVault, createYingceSessionClient, YingceApiError, parseEnvelope } = require("../src/yingce-session");

function storage() {
    const key = crypto.randomBytes(32);
    return {
        isEncryptionAvailable: () => true,
        encryptString(value) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
            const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]);
        },
        decryptString(value) {
            const cipher = crypto.createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
            cipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
        },
    };
}

test("API URL and account identity separate environments and reject unsafe endpoints", () => {
    assert.equal(normalizeApiUrl("https://api.example.test/api/"), "https://api.example.test/api");
    assert.throws(() => normalizeApiUrl("http://api.example.test/api"));
    assert.throws(() => normalizeApiUrl("https://user:password@example.test/api"));
    assert.throws(() => normalizeApiUrl("https://example.test/not-api"));
    assert.notEqual(accountScope("https://a.test/api", 1), accountScope("https://b.test/api", 1));
    assert.notEqual(accountScope("https://a.test/api", 1), accountScope("https://a.test/api", 2));
});

test("vault encrypts session, binds it to the API environment, and refuses insecure storage", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-vault-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const vault = createSessionVault({ directory, safeStorage: storage() });
    vault.save("https://a.test/api", "secret-session");
    assert.equal(fs.readFileSync(path.join(directory, "yingce-session.enc")).includes(Buffer.from("secret-session")), false);
    assert.equal(vault.load("https://a.test/api"), "secret-session");
    assert.equal(vault.load("https://b.test/api"), null);
    vault.save("https://a.test/api", "replacement");
    assert.equal(vault.load("https://a.test/api"), "replacement");
    vault.clear();
    assert.equal(vault.load("https://a.test/api"), null);
    const unavailable = createSessionVault({ directory, safeStorage: { isEncryptionAvailable: () => false } });
    assert.throws(() => unavailable.save("https://a.test/api", "secret"), /安全存储/);
    const plaintext = createSessionVault({ directory, safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" } });
    assert.throws(() => plaintext.save("https://a.test/api", "secret"), /安全存储/);
});

test("PKCE exchange keeps the session out of returned data, caches the account, and clears it even if logout fails", async (t) => {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
            calls.push({ url: req.url, authorization: req.headers.authorization, body });
            res.setHeader("content-type", "application/json");
            if (req.url === "/api/auth/desktop/token") return res.end(JSON.stringify({ code: 0, data: { user: { id: 42, username: "alice", displayName: "Alice" }, session: "opaque", expiresIn: 3600 } }));
            if (req.url === "/api/auth/session") return res.end(JSON.stringify({ code: 0, data: { user: null } }));
            if (req.url === "/api/auth/logout") { res.statusCode = 503; return res.end(JSON.stringify({ code: 7, reason: "unavailable", msg: "failed" })); }
            res.statusCode = 404;
            return res.end(JSON.stringify({ code: 404, reason: "not_found", msg: "not found" }));
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-client-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const apiUrl = `http://127.0.0.1:${server.address().port}/api`;
    const vault = createSessionVault({ directory, safeStorage: storage() });
    const client = createYingceSessionClient({ apiUrl, vault });
    assert.deepEqual(await client.exchangeDesktopAuthorizationCode({ clientId: "peekreel-lite", redirectUri: "http://127.0.0.1:49152/oauth/callback", code: "one-time", codeVerifier: "v".repeat(43) }), {
        user: { id: 42, username: "alice", displayName: "Alice" }, expiresIn: 3600,
    });
    assert.deepEqual(client.cachedUser(), { id: "42", username: "alice", displayName: "Alice" });
    assert.deepEqual(await client.session(), { user: null });
    assert.equal(calls[1].authorization, "Bearer opaque");
    assert.equal(JSON.parse(calls[0].body).codeVerifier, "v".repeat(43));
    await assert.rejects(client.logout(), (error) => error instanceof YingceApiError && error.status === 503 && error.reason === "unavailable");
    assert.equal(vault.load(apiUrl), null);
});

test("logout removes an unreadable local session without sending an unauthenticated request", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-logout-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const apiUrl = "https://example.test/api";
    const file = path.join(directory, "yingce-session.enc");
    const safeStorage = storage();
    const vault = createSessionVault({ directory, safeStorage });
    let calls = 0;
    const client = createYingceSessionClient({ apiUrl, vault, fetchImpl: async () => { calls++; } });

    vault.save(apiUrl, "secret");
    fs.writeFileSync(file, "damaged");
    await assert.rejects(client.logout());
    assert.equal(fs.existsSync(file), false);

    vault.save(apiUrl, "secret");
    safeStorage.isEncryptionAvailable = () => false;
    await assert.rejects(client.logout(), /安全存储/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(calls, 0);
});

test("late authorization exchange cannot restore a session after logout or overwrite a newer account", async () => {
    let session = null;
    const pending = [];
    const vault = { load: () => session, save: (_base, value) => { session = value; }, clear: () => { session = null; } };
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault, fetchImpl: async (url) => {
        if (url.endsWith("/auth/logout")) return new Response(JSON.stringify({ code: 0, data: {} }));
        return new Promise((resolve) => pending.push(resolve));
    } });
    const response = (id) => new Response(JSON.stringify({ code: 0, data: { user: { id }, session: `session-${id}`, expiresIn: 60 } }));
    const exchange = (code) => client.exchangeDesktopAuthorizationCode({ clientId: "peekreel-lite", redirectUri: "http://127.0.0.1:49152/oauth/callback", code, codeVerifier: "v".repeat(43) });
    const first = exchange("first");
    const second = exchange("second");
    pending[1](response(2));
    await second;
    pending[0](response(1));
    await assert.rejects(first, (error) => error.reason === "auth_superseded");
    assert.equal(session, "session-2");
    const late = exchange("late");
    await client.logout();
    pending[2](response(3));
    await assert.rejects(late, (error) => error.reason === "auth_superseded");
    assert.equal(session, null);
});

test("late logout response does not clear a newer session", async () => {
    let session = "old";
    let finishLogout;
    let logoutAuthorization;
    const vault = { load: () => session, save: (_base, value) => { session = value; }, clear: () => { session = null; } };
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault, fetchImpl: async (url, options) => {
        if (url.endsWith("/auth/logout")) {
            logoutAuthorization = options.headers.authorization;
            return new Promise((resolve) => { finishLogout = resolve; });
        }
        return new Response(JSON.stringify({ code: 0, data: { user: { id: 2 }, session: "new", expiresIn: 60 } }));
    } });
    const logout = client.logout();
    assert.equal(session, null);
    await client.exchangeDesktopAuthorizationCode({ clientId: "peekreel-lite", redirectUri: "http://127.0.0.1:49152/oauth/callback", code: "new", codeVerifier: "v".repeat(43) });
    finishLogout(new Response(JSON.stringify({ code: 0, data: {} })));
    await logout;
    assert.equal(logoutAuthorization, "Bearer old");
    assert.equal(session, "new");
});

test("late session and catalog responses are discarded after an account change", async () => {
    let session = "old";
    const pending = [];
    const vault = { load: () => session, save: (_base, value) => { session = value; }, clear: () => { session = null; } };
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault, fetchImpl: async (url) => {
        if (url.endsWith("/auth/desktop/token")) return new Response(JSON.stringify({ code: 0, data: { user: { id: 2 }, session: "new", expiresIn: 60 } }));
        return new Promise((resolve) => pending.push(resolve));
    } });
    const oldSession = client.session();
    const oldCatalog = client.modelCatalog();
    await client.exchangeDesktopAuthorizationCode({ clientId: "peekreel-lite", redirectUri: "http://127.0.0.1:49152/oauth/callback", code: "new", codeVerifier: "v".repeat(43) });
    pending[0](new Response(JSON.stringify({ code: 0, data: { user: { id: 1 } } })));
    pending[1](new Response(JSON.stringify({ code: 0, data: { channels: [{ id: "old" }] } })));
    await assert.rejects(oldSession, (error) => error.reason === "auth_superseded");
    await assert.rejects(oldCatalog, (error) => error.reason === "auth_superseded");
});

test("an intent cannot survive logout and a login returning the same session value", async () => {
    let session = "same";
    let generationCalls = 0;
    const vault = { load: () => session, save: (_base, value) => { session = value; }, clear: () => { session = null; } };
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault, fetchImpl: async (url) => {
        if (url.endsWith("/auth/logout")) return new Response(JSON.stringify({ code: 0, data: {} }));
        if (url.endsWith("/auth/desktop/token")) return new Response(JSON.stringify({ code: 0, data: { user: { id: 1 }, session: "same", expiresIn: 60 } }));
        generationCalls++;
        throw new Error("unexpected generation");
    } });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: {} });
    await client.logout();
    await client.exchangeDesktopAuthorizationCode({ clientId: "peekreel-lite", redirectUri: "http://127.0.0.1:49152/oauth/callback", code: "same", codeVerifier: "v".repeat(43) });
    await assert.rejects(intent.send(), (error) => error.reason === "unauthorized");
    assert.equal(generationCalls, 0);
});

test("HTTP 200 business errors remain errors and preserve code and reason", async () => {
    const vault = { load: () => null, save: () => assert.fail(), clear() {} };
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault, fetchImpl: async () => new Response(JSON.stringify({ code: 17, reason: "model_catalog_unavailable", msg: "closed" }), { status: 200 }) });
    await assert.rejects(client.modelCatalog(), (error) => error instanceof YingceApiError && error.code === 17 && error.reason === "model_catalog_unavailable");
});

test("business errors have actionable messages even under HTTP 200", () => {
    for (const [body, expected] of [
        [{ code: 40301, reason: "quota_exceeded" }, /积分不足/],
        [{ code: 401, reason: "unauthorized" }, /重新登录/],
        [{ code: 42901, reason: "rate_limited" }, /频繁/],
        [{ code: 400, reason: "model_unavailable" }, /模型不可用/],
        [{ code: 40901, reason: "conflict" }, /核对/],
        [{ code: 0, reason: "insufficient_credits" }, /积分不足/],
    ]) assert.throws(() => parseEnvelope(200, body), (error) => error.code === body.code && expected.test(error.message));
});

test("generation rejects an HTTP 200 error reason even when its code is missing", async () => {
    let calls = 0;
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => {
        calls++;
        return new Response(JSON.stringify({ reason: "insufficient_credits", msg: "insufficient" }), { headers: { "content-type": "application/json" } });
    } });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: {} });
    await assert.rejects(intent.send(), (error) => error.status === 200 && error.reason === "insufficient_credits" && /积分不足/.test(error.message));
    assert.equal(calls, 1);
});

test("unrecognized error bodies retain actionable HTTP status without retries", async () => {
    for (const [status, body, expected] of [
        [409, "invalid", /核对/],
        [409, JSON.stringify({ error: "duplicate" }), /核对/],
        [401, "invalid", /重新登录/],
        [429, "invalid", /频繁/],
    ]) {
        let calls = 0;
        const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => {
            calls++;
            return new Response(body, { status, headers: { "content-type": "application/json" } });
        } });
        const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: {} });
        await assert.rejects(intent.send(), (error) => error.status === status && expected.test(error.message));
        assert.equal(calls, 1);
    }
});

test("generation intent reuses its key and body, reports conflicts and accepts audio", async () => {
    const calls = [];
    let response = () => new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } });
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret", save() {}, clear() {} }, fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        return response();
    } });
    const body = { model: "model-a", messages: [{ role: "user", content: "hello" }] };
    const intent = client.createGenerationIntent({ channelId: "channel-a", providerPath: "/chat/completions", capability: "text", body });
    body.model = "changed";
    await intent.send();
    response = () => new Response(JSON.stringify({ code: 9, reason: "duplicate", msg: "duplicate" }), { status: 409, headers: { "content-type": "application/json" } });
    await assert.rejects(intent.send(), (error) => error.status === 409 && error.reason === "duplicate" && /核对/.test(error.message));
    assert.equal(calls[0].url, "https://example.test/api/ai/system/channel-a/chat/completions");
    assert.equal(calls[0].headers.authorization, "Bearer secret");
    assert.equal(calls[0].headers["x-idempotency-key"], calls[1].headers["x-idempotency-key"]);
    assert.equal(JSON.parse(calls[0].body).model, "model-a");
    response = () => new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    const audio = client.createGenerationIntent({ channelId: "channel-a", providerPath: "/audio/speech", capability: "audio", body: { model: "voice", input: "hello" } });
    assert.deepEqual(await audio.send(), { contentType: "audio/mpeg", bytes: Buffer.from([1, 2, 3]) });
    assert.notEqual(calls[1].headers["x-idempotency-key"], calls[2].headers["x-idempotency-key"]);
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/videos", capability: "video", body: { model: "x" } }));
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/tasks", capability: "audio", body: { model: "x" } }));
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/%2e%2e/auth", capability: "text", body: {} }));
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/models%2f..%2fauth", capability: "text", body: {} }));
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/%252e%252e/auth", capability: "text", body: {} }));
    assert.doesNotThrow(() => client.createGenerationIntent({ channelId: "a", providerPath: "/models/gemini:generateContent", capability: "text", body: { contents: [] } }));
});

test("image edit multipart snapshots repeated fields and files for the same intent", async (t) => {
    const calls = [];
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const form = await new Request("http://localhost/", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: Buffer.concat(chunks) }).formData();
        const files = await Promise.all(form.getAll("image").map(async (file) => ({ name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] })));
        calls.push({ authorization: req.headers.authorization, key: req.headers["x-idempotency-key"], contentType: req.headers["content-type"], prompts: form.getAll("prompt"), files });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const client = createYingceSessionClient({ apiUrl: `http://127.0.0.1:${server.address().port}/api`, vault: { load: () => "secret" } });
    const bytes = Uint8Array.from([1, 2, 3]);
    const entries = [{ name: "prompt", value: "one" }, { name: "prompt", value: "two" }, { name: "image", filename: "a.png", mimeType: "image/png", bytes }];
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/edits", capability: "image", multipart: entries });
    bytes[0] = 9;
    entries[0].value = "changed";
    await intent.send();
    await intent.send();
    for (const call of calls) {
        assert.equal(call.authorization, "Bearer secret");
        assert.match(call.contentType, /^multipart\/form-data; boundary=/);
        assert.deepEqual(call.prompts, ["one", "two"]);
        assert.deepEqual(call.files, [{ name: "a.png", type: "image/png", bytes: [1, 2, 3] }]);
    }
    assert.equal(calls[0].key, calls[1].key);
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", multipart: entries }));
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/images/edits", capability: "image", multipart: [{ name: "image", filename: "x", mimeType: "text/plain", bytes }] }));
    assert.throws(() => client.createGenerationIntent({ channelId: "a", providerPath: "/images/edits", capability: "image", multipart: Array(65).fill({ name: "x", value: "x" }) }));
    assert.equal(calls.length, 2);
});

test("an intent cannot cross sessions and cancellation after dispatch has an unknown outcome", async () => {
    let session = "first";
    let calls = 0;
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => session }, fetchImpl: async (_url, options) => {
        calls++;
        options.signal.throwIfAborted();
        throw new Error("connection lost");
    } });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/chat/completions", capability: "text", body: {} });
    session = "second";
    await assert.rejects(intent.send(), (error) => error.reason === "unauthorized");
    assert.equal(calls, 0);
    session = "first";
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(intent.send({ signal: controller.signal }));
    assert.equal(calls, 0);
    await assert.rejects(intent.send(), (error) => error.reason === "outcome_unknown");
    assert.equal(calls, 1);
});

test("generation does not retry automatically on uncertain outcome or HTTP 200 business error", async () => {
    let calls = 0;
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => {
        calls++;
        if (calls === 1) throw new Error("disconnected");
        return new Response(JSON.stringify({ code: 8, reason: "insufficient_credits", msg: "insufficient" }), { headers: { "content-type": "application/json" } });
    } });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: { model: "x" } });
    await assert.rejects(intent.send(), (error) => error.reason === "outcome_unknown");
    assert.equal(calls, 1);
    await assert.rejects(intent.send(), (error) => error.code === 8 && error.reason === "insufficient_credits");
    assert.equal(calls, 2);
});

test("a dispatched generation returns its result after an account change for scoped persistence", async () => {
    let session = "first";
    let finishRead;
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => session }, fetchImpl: async () => ({
        ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
        json: () => new Promise((resolve) => { finishRead = resolve; }),
    }) });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: {} });
    const result = intent.send();
    await new Promise((resolve) => setImmediate(resolve));
    session = "second";
    finishRead({ data: [{ b64_json: "result" }] });
    assert.deepEqual(await result, { data: [{ b64_json: "result" }] });
});

test("interrupted generation response body is an unknown outcome and is not retried", async () => {
    let calls = 0;
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "first" }, fetchImpl: async () => {
        calls++;
        return { ok: true, status: 200, headers: new Headers({ "content-type": "audio/mpeg" }), arrayBuffer: async () => { throw new Error("connection lost"); } };
    } });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/audio/speech", capability: "audio", body: {} });
    await assert.rejects(intent.send(), (error) => error.reason === "outcome_unknown");
    assert.equal(calls, 1);
});

test("generation gateway errors preserve server details and are treated as unknown without retries", async () => {
    for (const response of [
        new Response(JSON.stringify({ code: 50201, reason: "upstream_failure", msg: "failed" }), { status: 502, headers: { "content-type": "application/json" } }),
        new Response("bad gateway", { status: 502, headers: { "content-type": "text/plain" } }),
        new Response("invalid", { status: 503, headers: { "content-type": "application/json" } }),
    ]) {
        let calls = 0;
        const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => { calls++; return response; } });
        const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: {} });
        await assert.rejects(intent.send(), (error) => {
            assert.equal(error.status, response.status);
            assert.equal(error.outcomeUnknown, true);
            assert.match(error.message, /核对/);
            if (response.status === 502 && response.headers.get("content-type") === "application/json") {
                assert.equal(error.code, 50201);
                assert.equal(error.reason, "upstream_failure");
            }
            return true;
        });
        assert.equal(calls, 1);
    }
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => new Response("limited", { status: 429 }) });
    const intent = client.createGenerationIntent({ channelId: "a", providerPath: "/images/generations", capability: "image", body: {} });
    await assert.rejects(intent.send(), (error) => error.status === 429 && error.outcomeUnknown !== true && /频繁/.test(error.message));
});
