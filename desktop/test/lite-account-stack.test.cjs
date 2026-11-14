const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createLiteAccountStack } = require("../src/lite-account-stack");
const { createLiteAccountLifecycle } = require("../src/lite-account-lifecycle");

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

test("account stack isolates paths and waits for sync before stopping services", async () => {
    const events = [];
    const entered = deferred();
    const release = deferred();
    let bridgeOptions;
    const stack = createLiteAccountStack({
        account: { scope: "scope-a", dataDir: path.join("root", "accounts", "a", "data"), credentials: { username: "local" } },
        resources: {}, origin: "http://127.0.0.1:17831",
        createBackend: (dir) => ({ baseUrl: "http://127.0.0.1:1", start: async () => events.push(`start ${dir}`), stop: async () => events.push("stop backend") }),
        createBrowserHost: (scope) => ({ start: async () => ({ scope }), stop: async () => events.push("stop host") }),
        createBridge: (options) => { bridgeOptions = options; return { start: async () => events.push("start bridge"), stop: async () => events.push("stop bridge"), scheduleRestart() {} }; },
        authenticate: async () => "local-session",
        installCookie: async (scope, value) => events.push(`cookie ${scope} ${value}`),
        syncChannels: async ({ signal }) => { entered.resolve(); await release.promise; events.push(`sync ended ${signal.aborted}`); },
    });
    await stack.start(new AbortController().signal);
    assert.equal(bridgeOptions.dataDir, path.join("root", "accounts", "a", "doubao-bridge", "data"));
    assert.equal(bridgeOptions.profileDir, path.join("root", "accounts", "a", "doubao-bridge", "profiles"));
    stack.publish();
    await entered.promise;
    const stopped = stack.stop();
    await Promise.resolve();
    assert.equal(events.includes("stop backend"), false);
    release.resolve();
    await stopped;
    assert.ok(events.indexOf("sync ended true") < events.indexOf("stop backend"));
    assert.ok(events.includes("stop bridge") && events.includes("stop host"));
    const count = events.length;
    bridgeOptions.onStatus({ phase: "ready" });
    await stack.sync();
    assert.equal(events.length, count);
});

test("superseded startup never installs a cookie or starts the bridge", async () => {
    const entered = deferred();
    const release = deferred();
    const events = [];
    const lifecycle = createLiteAccountLifecycle({
        invalidate() {},
        prepare: () => createLiteAccountStack({
            account: { scope: "a", dataDir: path.join("root", "a", "data"), credentials: {} },
            resources: {}, origin: "http://127.0.0.1:1",
            createBackend: () => ({ baseUrl: "http://127.0.0.1:1", start: async () => { entered.resolve(); await release.promise; }, stop: async () => events.push("backend stopped") }),
            createBrowserHost: () => ({ stop: async () => events.push("host stopped") }),
            createBridge: () => ({ start: async () => events.push("bridge started"), stop: async () => events.push("bridge stopped") }),
            authenticate: async () => "session", installCookie: async () => events.push("cookie installed"), syncChannels: async () => {},
        }),
        publish: (candidate) => candidate.publish(),
    });
    const login = lifecycle.activate({ id: "a" });
    await entered.promise;
    const logout = lifecycle.deactivate();
    release.resolve();
    assert.equal(await login, false);
    await logout;
    assert.deepEqual(events.sort(), ["backend stopped", "bridge stopped", "host stopped"]);
});

test("synchronous bridge startup failure does not prevent publication or cleanup", async () => {
    const events = [];
    const stack = createLiteAccountStack({
        account: { scope: "a", dataDir: path.join("root", "a", "data"), credentials: {} },
        origin: "http://127.0.0.1:1",
        createBackend: () => ({ start: async () => {}, stop: async () => events.push("backend stopped") }),
        createBrowserHost: () => ({ stop: async () => events.push("host stopped") }),
        createBridge: () => ({ start() { throw new Error("start failed"); }, scheduleRestart() { events.push("restart scheduled"); }, stop() { events.push("bridge stopped"); throw new Error("stop failed"); } }),
        authenticate: async () => "session", installCookie: async () => {}, syncChannels: async () => {},
    });
    await stack.start(new AbortController().signal);
    stack.publish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(events.includes("restart scheduled"));
    await assert.rejects(stack.stop(), /stop failed/);
    assert.ok(events.includes("host stopped") && events.includes("backend stopped"));
});

test("bridge retry remains within the active account and is disabled after shutdown", async () => {
    let starts = 0;
    const stack = createLiteAccountStack({
        account: { scope: "a", dataDir: path.join("root", "a", "data"), credentials: {} },
        origin: "http://127.0.0.1:1",
        createBackend: () => ({ start: async () => {}, stop: async () => {} }),
        createBrowserHost: () => ({ stop: async () => {} }),
        createBridge: () => ({ start: async () => { starts++; }, stop: async () => {}, scheduleRestart() {} }),
        authenticate: async () => "session", installCookie: async () => {}, syncChannels: async () => {},
    });
    assert.equal(await stack.retryBridge(), false);
    await stack.start(new AbortController().signal);
    stack.publish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await stack.retryBridge(), true);
    assert.equal(starts, 2);
    await stack.stop();
    assert.equal(await stack.retryBridge(), false);
    assert.equal(starts, 2);
});
