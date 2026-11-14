const test = require("node:test");
const assert = require("node:assert/strict");
const { createLiteAccountLifecycle } = require("../src/lite-account-lifecycle");

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

test("switch invalidates immediately, stops the previous account and publishes only the new one", async () => {
    const events = [];
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => events.push("invalidate"),
        prepare: async (user) => ({ id: user.id, stop: async () => events.push(`stop ${user.id}`) }),
        publish: (candidate) => events.push(`publish ${candidate.id}`),
    });
    await lifecycle.activate({ id: "a" });
    const switchResult = lifecycle.activate({ id: "b" });
    assert.deepEqual(events, ["invalidate", "publish a", "invalidate"]);
    assert.equal(await switchResult, true);
    assert.deepEqual(events, ["invalidate", "publish a", "invalidate", "stop a", "publish b"]);
    await lifecycle.deactivate();
    assert.deepEqual(events.slice(-2), ["invalidate", "stop b"]);
});

test("logout supersedes an in-flight startup and prevents its publication", async () => {
    const started = deferred();
    const release = deferred();
    const events = [];
    let signal;
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => events.push("invalidate"),
        prepare: async (_user, abortSignal) => {
            signal = abortSignal;
            started.resolve();
            await release.promise;
            return { stop: async () => events.push("stop stale") };
        },
        publish: () => events.push("publish stale"),
    });
    const login = lifecycle.activate({ id: "a" });
    await started.promise;
    const logout = lifecycle.deactivate();
    assert.equal(signal.aborted, true);
    release.resolve();
    assert.equal(await login, false);
    await logout;
    assert.deepEqual(events, ["invalidate", "invalidate", "stop stale"]);
});

test("failed publication stops its backend and does not block the next activation", async () => {
    const events = [];
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => {},
        prepare: async (user) => ({ id: user.id, stop: async () => events.push(`stop ${user.id}`) }),
        publish: (candidate) => { if (candidate.id === "a") throw new Error("failed"); events.push(`publish ${candidate.id}`); },
    });
    await assert.rejects(lifecycle.activate({ id: "a" }), /failed/);
    assert.equal(await lifecycle.activate({ id: "b" }), true);
    assert.deepEqual(events, ["stop a", "publish b"]);
});

test("a failed stop blocks publication until the old backend is stopped", async () => {
    const events = [];
    let failStop = true;
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => events.push("invalidate"),
        prepare: async (user) => ({ id: user.id, stop: async () => {
            events.push(`stop ${user.id}`);
            if (failStop) throw new Error("stop failed");
        } }),
        publish: (candidate) => events.push(`publish ${candidate.id}`),
    });
    await lifecycle.activate({ id: "a" });
    await assert.rejects(lifecycle.activate({ id: "b" }), /stop failed/);
    assert.equal(events.includes("publish b"), false);
    failStop = false;
    assert.equal(await lifecycle.activate({ id: "c" }), true);
    assert.deepEqual(events.slice(-2), ["stop a", "publish c"]);
});

test("a reentrant logout during publication invalidates and stops the candidate", async () => {
    const events = [];
    let lifecycle;
    let logout;
    lifecycle = createLiteAccountLifecycle({
        invalidate: () => events.push("invalidate"),
        prepare: async () => ({ stop: async () => events.push("stop") }),
        publish: () => { events.push("publish"); logout = lifecycle.deactivate(); },
    });
    assert.equal(await lifecycle.activate({ id: "a" }), false);
    await logout;
    assert.deepEqual(events, ["invalidate", "publish", "invalidate", "stop"]);
});

test("a stale candidate whose stop fails remains tracked and blocks the next account", async () => {
    const started = deferred();
    const release = deferred();
    const events = [];
    let failStop = true;
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => {},
        prepare: async (user) => {
            if (user.id === "a") { started.resolve(); await release.promise; }
            return { id: user.id, stop: async () => {
                events.push(`stop ${user.id}`);
                if (failStop) throw new Error("stop failed");
            } };
        },
        publish: (candidate) => events.push(`publish ${candidate.id}`),
    });
    const first = lifecycle.activate({ id: "a" });
    await started.promise;
    const second = lifecycle.activate({ id: "b" });
    release.resolve();
    assert.equal(await first, false);
    await assert.rejects(second, /stop failed/);
    assert.deepEqual(events, ["stop a", "stop a"]);
    failStop = false;
    assert.equal(await lifecycle.activate({ id: "c" }), true);
    assert.deepEqual(events.slice(-2), ["stop a", "publish c"]);
});

test("resources are tracked before candidate startup and a failed cleanup blocks the next account", async () => {
    const events = [];
    let failStop = true;
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => {},
        prepare: (user) => ({
            start: async () => { events.push(`start ${user.id}`); if (user.id === "a") throw new Error("start failed"); },
            stop: async () => { events.push(`stop ${user.id}`); if (failStop) throw new Error("stop failed"); },
        }),
        publish: (_candidate, user) => events.push(`publish ${user.id}`),
    });
    await assert.rejects(lifecycle.activate({ id: "a" }), /stop failed/);
    await assert.rejects(lifecycle.activate({ id: "b" }), /stop failed/);
    assert.deepEqual(events, ["start a", "stop a", "stop a"]);
    failStop = false;
    assert.equal(await lifecycle.activate({ id: "c" }), true);
    assert.deepEqual(events.slice(-3), ["stop a", "start c", "publish c"]);
});

test("a candidate superseded while preparing is stopped without starting", async () => {
    const started = deferred();
    const release = deferred();
    const events = [];
    const lifecycle = createLiteAccountLifecycle({
        invalidate: () => {},
        prepare: async () => {
            started.resolve();
            await release.promise;
            return { start: async () => events.push("start"), stop: async () => events.push("stop") };
        },
        publish: () => events.push("publish"),
    });
    const login = lifecycle.activate({ id: "a" });
    await started.promise;
    const logout = lifecycle.deactivate();
    release.resolve();
    assert.equal(await login, false);
    await logout;
    assert.deepEqual(events, ["stop"]);
});
