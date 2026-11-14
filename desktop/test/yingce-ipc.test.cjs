const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerYingceIpc } = require("../src/yingce-ipc");
const { YingceApiError, createYingceSessionClient } = require("../src/yingce-session");
const { createGenerationJournal } = require("../src/yingce-generation-journal");

test("Yingce IPC limits calls to trusted top-level windows and exposes only browser login", async () => {
    let handler;
    const frame = { url: "http://127.0.0.1:17831/peekreel-activation" };
    const sender = { mainFrame: frame };
    const window = { isDestroyed: () => false, webContents: sender };
    let calls = 0;
    const client = {
        cachedUser() { return { id: "1", username: "alice" }; },
        async modelCatalog() { throw new YingceApiError("请重新登录", { status: 401, code: 401, reason: "unauthorized" }); },
    };
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } }, client,
        desktopLogin: { begin: async () => { calls++; return { id: "1", username: "alice" }; }, cancel: () => true },
        getWindows: () => [window], getOrigin: () => "http://127.0.0.1:17831", activate: async () => true, enter: () => true,
    });
    const event = { sender, senderFrame: frame };
    assert.deepEqual(await handler(event, "beginLogin"), { ok: true, data: { user: { id: "1", username: "alice" } } });
    assert.deepEqual(await handler(event, "catalog"), { ok: false, error: { message: "请重新登录", status: 401, code: 401, reason: "unauthorized" } });
    await assert.rejects(handler(event, "register"), /Unsupported/);
    await assert.rejects(handler({ sender, senderFrame: { url: frame.url } }, "beginLogin"), /Untrusted/);
    frame.url = "https://attacker.example/";
    await assert.rejects(handler(event, "beginLogin"), /Untrusted/);
    assert.equal(calls, 1);
});

test("successful PKCE login activates its local account before entering the workspace", async () => {
    let handler;
    const frame = { url: "http://127.0.0.1:17831/peekreel-activation/lite.html" };
    const sender = { mainFrame: frame };
    const window = { isDestroyed: () => false, webContents: sender };
    const events = [];
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: {}, desktopLogin: { begin: async () => { events.push("remote"); return { id: "a" }; } },
        getWindows: () => [window], getOrigin: () => "http://127.0.0.1:17831",
        activate: async (user) => { events.push(`local ${user.id}`); return true; },
        enter: () => { events.push("enter"); return true; },
    });
    assert.deepEqual(await handler({ sender, senderFrame: frame }, "beginLogin"), { ok: true, data: { user: { id: "a" } } });
    assert.deepEqual(events, ["remote", "local a", "enter"]);
});

test("a superseded activation is reported as a failed login", async () => {
    let handler;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: {}, desktopLogin: { begin: async () => ({ id: "a" }) },
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }],
        getOrigin: () => "http://127.0.0.1:17831", activate: async () => false,
    });
    const result = await handler({ sender, senderFrame: frame }, "beginLogin");
    assert.equal(result.ok, false);
    assert.match(result.error.message, /取代/);
});

test("generation uses a single main-process intent and returns classified failures", async () => {
    let handler;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    let created = 0;
    let sent = 0;
    const input = { channelId: "channel", providerPath: "/images/generations", capability: "image", body: { model: "image" } };
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: { createGenerationIntent(value) {
            created++;
            assert.deepEqual(value, input);
            return { async send() { sent++; throw new YingceApiError("请核对结果", { status: 409, reason: "duplicate" }); } };
        } },
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }],
        getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => true,
    });
    const result = await handler({ sender, senderFrame: frame }, "generate", input);
    assert.equal(result.ok, false);
    assert.equal(result.error.status, 409);
    assert.equal(result.error.reason, "duplicate");
    assert.equal(created, 1);
    assert.equal(sent, 1);
});

test("generation cannot use a session while the account workspace is switching", async () => {
    let handler;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    let calls = 0;
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: { createGenerationIntent() { calls++; } },
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }],
        getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => false,
    });
    const result = await handler({ sender, senderFrame: frame }, "generate", {});
    assert.equal(result.ok, false);
    assert.match(result.error.message, /账号工作区已切换/);
    assert.equal(calls, 0);
});

test("generation preserves an unknown gateway outcome through IPC and journal", async () => {
    let handler, recorded;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    const error = new YingceApiError("核对结果", { status: 502, code: 50201, reason: "upstream_failure" });
    error.outcomeUnknown = true;
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: { createGenerationIntent: () => ({ send: async () => { throw error; } }) },
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }], getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => true, getAccountScope: () => "alice",
        journal: { begin() {}, fail: (_scope, _context, failure) => { recorded = failure; } },
    });
    const result = await handler({ sender, senderFrame: frame }, "generate", { capability: "image", recovery: { capability: "image" } });
    assert.equal(recorded, error);
    assert.deepEqual(result.error, { message: "核对结果", status: 502, code: 50201, reason: "upstream_failure", outcomeUnknown: true });
});

test("unexpected successful generation content remains unknown in IPC and recovery journal", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-journal-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const scope = "a".repeat(64);
    const journal = createGenerationJournal(directory);
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    for (const [index, capability, providerPath, response] of [
        [1, "image", "/images/generations", () => new Response("unexpected", { headers: { "content-type": "text/html" } })],
        [2, "audio", "/audio/speech", () => new Response(JSON.stringify({ code: 0, data: {} }), { headers: { "content-type": "application/json" } })],
        [3, "audio", "/audio/speech", () => new Response(JSON.stringify({ result: "unexpected" }), { headers: { "content-type": "application/json" } })],
        [4, "audio", "/audio/speech", () => new Response(null, { headers: { "content-type": "audio/mpeg" } })],
    ]) {
        let handler, calls = 0;
        const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => { calls++; return response(); } });
        registerYingceIpc({
            ipcMain: { handle: (_name, fn) => { handler = fn; } }, client,
            getWindows: () => [{ isDestroyed: () => false, webContents: sender }], getOrigin: () => "http://127.0.0.1:17831",
            canGenerate: () => true, getAccountScope: () => scope, journal,
        });
        const recovery = { id: `yingce-local:${index}`, capability, prompt: "prompt", model: "model", createdAt: "now" };
        const result = await handler({ sender, senderFrame: frame }, "generate", { channelId: "a", providerPath, capability, body: {}, recovery });
        assert.equal(result.ok, false);
        assert.equal(result.error.status, 200);
        assert.equal(result.error.reason, "outcome_unknown");
        assert.match(result.error.message, /核对/);
        assert.equal(journal.list(scope).find((record) => record.context.id === recovery.id).status, "unknown");
        assert.equal(calls, 1);
    }
});

test("a malformed conflict response is shown as a conflict and journaled as unknown", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-journal-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const scope = "a".repeat(64);
    const journal = createGenerationJournal(directory);
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    let handler, calls = 0;
    const client = createYingceSessionClient({ apiUrl: "https://example.test/api", vault: { load: () => "secret" }, fetchImpl: async () => {
        calls++;
        return new Response("invalid", { status: 409, headers: { "content-type": "application/json" } });
    } });
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } }, client,
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }], getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => true, getAccountScope: () => scope, journal,
    });
    const recovery = { id: "yingce-local:conflict", capability: "image", prompt: "prompt", model: "model", createdAt: "now" };
    const result = await handler({ sender, senderFrame: frame }, "generate", { channelId: "a", providerPath: "/images/generations", capability: "image", body: {}, recovery });
    assert.equal(result.ok, false);
    assert.equal(result.error.status, 409);
    assert.match(result.error.message, /核对/);
    assert.equal(journal.list(scope)[0].status, "unknown");
    assert.equal(calls, 1);
});

test("journal retains the original account result after its window and account change", async () => {
    let handler, finish;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    let scope = "alice";
    const calls = [];
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: { createGenerationIntent: () => ({ send: () => new Promise((resolve) => { finish = resolve; }) }) },
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }], getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => true, getAccountScope: () => scope,
        journal: { begin: (owner) => calls.push(`begin:${owner}`), complete: (owner) => calls.push(`complete:${owner}`) },
    });
    const request = handler({ sender, senderFrame: frame }, "generate", { capability: "text", recovery: { capability: "text" } });
    scope = "bob";
    finish({ result: "ok" });
    assert.equal((await request).ok, true);
    assert.deepEqual(calls, ["begin:alice", "complete:alice"]);
});

test("journal failure before sending stops the request; a failed result write reports unknown", async () => {
    let handler, sends = 0, failBegin = true;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        client: { createGenerationIntent: () => ({ send: async () => { sends++; return {}; } }) },
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }], getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => true, getAccountScope: () => "alice",
        journal: { begin: () => { if (failBegin) throw new Error("disk full"); }, complete: () => { throw new Error("disk full"); } },
    });
    const event = { sender, senderFrame: frame };
    const input = { capability: "text", recovery: { capability: "text" } };
    assert.equal((await handler(event, "generate", input)).ok, false);
    assert.equal(sends, 0);
    failBegin = false;
    const reply = await handler(event, "generate", input);
    assert.equal(reply.ok, false);
    assert.equal(reply.error.reason, "outcome_unknown");
    assert.equal(sends, 1);
});

test("journal access is confined to the active account and acknowledgement owner", async () => {
    let handler, active = true, scope = "alice", acknowledged = 0;
    const frame = { url: "http://127.0.0.1:17831/" };
    const sender = { mainFrame: frame };
    registerYingceIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } }, client: {},
        getWindows: () => [{ isDestroyed: () => false, webContents: sender }], getOrigin: () => "http://127.0.0.1:17831",
        canGenerate: () => active, getAccountScope: () => scope,
        journal: { list: (owner) => [owner], acknowledge: () => { acknowledged++; } },
    });
    const event = { sender, senderFrame: frame };
    assert.deepEqual((await handler(event, "generationJournal")).data, { owner: "alice", records: ["alice"] });
    scope = "bob";
    assert.equal((await handler(event, "acknowledgeGeneration", { owner: "alice", id: "yingce-local:id" })).ok, false);
    active = false;
    assert.equal((await handler(event, "generationJournal")).ok, false);
    assert.equal(acknowledged, 0);
});
