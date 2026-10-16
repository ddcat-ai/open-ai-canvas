import { expect, test } from "bun:test";
import { createCanvasEditLeaseClient } from "../src/services/canvas-edit-leases";
import type { changeCanvasEditLease } from "../src/services/api/user-data";
import { ApiError } from "../src/services/api/request";

function fixture() {
    let now = 0;
    let scope = "account-a";
    let fail = false;
    let paused: (() => Promise<void>) | undefined;
    let sequence = 0;
    const calls: string[] = [];
    const client = createCanvasEditLeaseClient({
        now: () => now,
        scope: () => scope,
        sessionId: () => `browser-${scope}`,
        change: (async (_canvas, proof, action) => {
            calls.push(action);
            await paused?.();
            if (fail) throw new Error("offline");
            if (action === "release") return { serverTime: new Date(now).toISOString() };
            return {
                serverTime: new Date(now).toISOString(),
                token: action === "acquire" ? `token-${++sequence}` : proof.token,
                lease: {
                    nodeId: proof.nodeId,
                    sessionId: proof.sessionId,
                    expiresAt: new Date(now + 30000).toISOString(),
                },
            };
        }) as typeof changeCanvasEditLease,
    });
    return {
        client,
        calls,
        time: (value: number) => {
            now = value;
        },
        scope: (value: string) => {
            scope = value;
        },
        fail: (value = true) => {
            fail = value;
        },
        pause: (value?: () => Promise<void>) => {
            paused = value;
        },
    };
}
const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
const nodes = new Set(["node"]);

test("admission rejection immediately blocks a different run and an older poll cannot unlock it", () => {
    const f = fixture();
    const status = {
        revision: 1,
        serverTime: new Date(0).toISOString(),
        leases: [],
        agent: null,
    };
    const oldPoll = f.client.statusToken("canvas");
    const activity = {
        runId: "server-run",
        status: "waiting_approval",
        cleanupPending: false,
    };
    const rejection = new ApiError("busy", {
        status: 409,
        reason: "canvas_agent_busy",
        details: { canvasId: "canvas", agent: activity },
    });
    expect(rejection.retryable).toBe(false);
    expect(f.client.agentRejected("canvas", rejection)).toBe(true);
    expect(f.client.agent("canvas")).toEqual(activity);
    f.client.status("canvas", status, oldPoll);
    expect(f.client.agent("canvas")).toEqual(activity);
    const freshPoll = f.client.statusToken("canvas");
    f.client.status("canvas", status, freshPoll);
    expect(f.client.agent("canvas")).toBeNull();
    expect(f.calls).toEqual([]);
});

test("admission observations reject malformed or foreign data and invalidate across account reset", () => {
    const f = fixture();
    const activity = {
        runId: "server-run",
        status: "cancelled",
        cleanupPending: true,
    };
    const error = {
        reason: "canvas_agent_busy",
        details: { canvasId: "canvas", agent: activity },
    };
    expect(f.client.agentRejected("other", error)).toBe(false);
    expect(
        f.client.agentRejected("canvas", {
            ...error,
            reason: "different_conflict",
        }),
    ).toBe(false);
    expect(
        f.client.agentRejected("canvas", {
            ...error,
            details: { canvasId: "canvas", agent: { runId: "invalid" } },
        }),
    ).toBe(false);
    const oldPoll = f.client.statusToken("canvas");
    f.client.agentRejected("canvas", error);
    f.scope("account-b");
    f.client.reset();
    f.client.status(
        "canvas",
        {
            revision: 1,
            serverTime: new Date(0).toISOString(),
            leases: [],
            agent: activity,
        },
        oldPoll,
    );
    expect(f.client.agent("canvas")).toBeUndefined();
});

test("Agent occupancy follows server status, stays isolated per canvas and account, and clears on completion", () => {
    const f = fixture();
    const activity = {
        runId: "run-a",
        status: "waiting_approval",
        cleanupPending: false,
    };
    const status = {
        revision: 1,
        serverTime: new Date(0).toISOString(),
        leases: [],
    };
    f.client.status("canvas", { ...status, agent: activity });
    expect(f.client.agent("canvas")).toEqual(activity);
    expect(f.client.agent("different-canvas")).toBeUndefined();
    f.time(600000);
    expect(f.client.agent("canvas")).toEqual(activity);
    f.client.status("canvas", {
        ...status,
        agent: { ...activity, status: "cancelled", cleanupPending: true },
    });
    expect(f.client.agent("canvas")?.cleanupPending).toBe(true);
    f.client.status("canvas", { ...status, agent: null });
    expect(f.client.agent("canvas")).toBeNull();
    f.client.status("canvas", { ...status, agent: activity });
    f.scope("account-b");
    expect(f.client.agent("canvas")).toBeUndefined();
    f.client.status("other", status);
    f.scope("account-a");
    expect(f.client.agent("canvas")).toBeUndefined();
    expect(f.calls).toEqual([]);
});

test("viewing and polling do not acquire; pending drafts retain all input while saving waits for a grant", async () => {
    const f = fixture();
    f.client.state("canvas", "node");
    await f.client.tick("canvas");
    expect(f.calls).toEqual([]);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
        finish = resolve;
    });
    f.pause(() => gate);
    expect(f.client.input("canvas", "node")).toBe(true);
    expect(f.client.state("canvas", "node").acquiring).toBe(true);
    for (let i = 0; i < 20; i++) expect(f.client.input("canvas", "node")).toBe(true);
    let submitted = false;
    const saving = f.client.proofs("canvas", nodes).then((proofs) => {
        submitted = true;
        return proofs;
    });
    await settle();
    expect(submitted).toBe(false);
    f.pause();
    finish();
    const proofs = await saving;
    expect(f.calls).toEqual(["acquire"]);
    expect(proofs[0].token).toBe("token-1");
    expect(f.client.versions("canvas")).toEqual({ node: 21 });
    expect(f.client.state("canvas", "node").blocked).toBe(false);
    for (let i = 0; i < 20; i++) expect(f.client.input("canvas", "node")).toBe(true);
    expect(f.calls).toEqual(["acquire"]);
    expect(f.client.versions("canvas")).toEqual({ node: 41 });
});

test("renewal is throttled and stops after input stops even if save fails", async () => {
    const f = fixture();
    f.client.input("canvas", "node");
    await settle();
    f.time(4999);
    await f.client.tick("canvas");
    expect(f.calls).toEqual(["acquire"]);
    f.time(5000);
    f.client.input("canvas", "node");
    await f.client.tick("canvas");
    expect(f.calls).toEqual(["acquire", "renew"]);
    f.time(15000);
    await f.client.tick("canvas");
    f.time(35001);
    await f.client.tick("canvas");
    expect(f.calls).toEqual(["acquire", "renew"]);
    expect(f.client.state("canvas", "node").typing).toBe(false);
    expect(f.client.pending("canvas", "node")).toBe(true);
});

test("saving an older input version cannot release a newer draft", async () => {
    const f = fixture();
    f.client.input("canvas", "node");
    await settle();
    const saved = f.client.versions("canvas");
    f.time(1000);
    f.client.input("canvas", "node");
    f.client.acknowledged("canvas", saved);
    f.time(3000);
    await f.client.tick("canvas");
    expect(f.calls).toEqual(["acquire"]);
    expect(f.client.pending("canvas", "node")).toBe(true);
    f.client.acknowledged("canvas", f.client.versions("canvas"));
    await f.client.tick("canvas");
    expect(f.calls).toEqual(["acquire", "release"]);
});

test("input during release waits for a fresh server token before saving", async () => {
    const f = fixture();
    f.client.input("canvas", "node");
    await settle();
    f.client.acknowledged("canvas", f.client.versions("canvas"));
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
        finish = resolve;
    });
    f.pause(() => gate);
    f.time(2000);
    const ticking = f.client.tick("canvas");
    f.client.input("canvas", "node");
    const saving = f.client.proofs("canvas", nodes);
    f.pause();
    finish();
    await ticking;
    expect((await saving)[0].token).toBe("token-2");
    expect(f.calls).toEqual(["acquire", "release", "acquire"]);
    expect(f.client.pending("canvas", "node")).toBe(true);
});

test("failed acquisitions freeze further edits and preserve drafts until explicit retry", async () => {
    const f = fixture();
    f.fail();
    f.client.input("canvas", "node");
    await settle();
    for (let i = 0; i < 20; i++) f.client.input("canvas", "node");
    await settle();
    expect(f.calls).toEqual(["acquire"]);
    expect(f.client.state("canvas", "node").blocked).toBe(true);
    expect(f.client.versions("canvas")).toEqual({ node: 1 });
    await expect(f.client.proofs("canvas", nodes)).rejects.toThrow("offline");
    f.time(5000);
    f.client.input("canvas", "node");
    await settle();
    expect(f.calls).toEqual(["acquire"]);
    f.time(40000);
    await f.client.tick("canvas");
    expect(f.calls).toHaveLength(1);
    expect(f.client.pending("canvas", "node")).toBe(true);
    f.fail(false);
    expect(await f.client.retry("canvas", "node")).toBe(true);
    expect(f.client.state("canvas", "node").blocked).toBe(false);
    expect(f.client.versions("canvas")).toEqual({ node: 1 });
    expect(f.client.pending("canvas", "node")).toBe(true);
    expect((await f.client.proofs("canvas", nodes))[0].token).toBe("token-1");
});

test("remote ownership blocks editing until server expiry and scope changes discard grants", async () => {
    const f = fixture();
    f.client.status("canvas", {
        revision: 1,
        serverTime: new Date(0).toISOString(),
        leases: [
            {
                nodeId: "node",
                sessionId: "other-browser",
                expiresAt: new Date(30000).toISOString(),
            },
        ],
    });
    expect(f.client.state("canvas", "node").blocked).toBe(true);
    expect(f.client.input("canvas", "node")).toBe(false);
    expect(f.calls).toEqual([]);
    f.time(30000);
    expect(f.client.state("canvas", "node").blocked).toBe(false);
    f.client.input("canvas", "node");
    await settle();
    f.scope("account-b");
    expect(await f.client.proofs("canvas", nodes)).toEqual([]);
    expect(f.client.pending("canvas", "node")).toBe(false);
});

test("an unsaved expired grant cannot accept more edits or bypass another owner through retry", async () => {
    const f = fixture();
    f.client.input("canvas", "node");
    await settle();
    f.time(30001);
    expect(f.client.state("canvas", "node").blocked).toBe(true);
    expect(f.client.input("canvas", "node")).toBe(false);
    f.client.status("canvas", {
        revision: 1,
        serverTime: new Date(30001).toISOString(),
        leases: [
            {
                nodeId: "node",
                sessionId: "other-browser",
                expiresAt: new Date(60001).toISOString(),
            },
        ],
    });
    expect(await f.client.retry("canvas", "node")).toBe(false);
    expect(f.calls).toEqual(["acquire"]);
    f.time(60002);
    expect(await f.client.retry("canvas", "node")).toBe(true);
    expect(f.client.state("canvas", "node").blocked).toBe(false);
    expect(f.client.versions("canvas")).toEqual({ node: 1 });
});

test("an open editor without further input does not renew after a confirmed save", async () => {
    const f = fixture();
    f.client.input("canvas", "node");
    await settle();
    f.client.acknowledged("canvas", f.client.versions("canvas"));
    for (let time = 2000; time <= 60000; time += 2000) {
        f.time(time);
        f.client.state("canvas", "node");
        await f.client.tick("canvas");
    }
    expect(f.calls).toEqual(["acquire", "release"]);
    expect(f.client.state("canvas", "node").blocked).toBe(false);
    expect(f.client.state("canvas", "node").typing).toBe(false);
});

test("released grants are omitted from later movement or result saves", async () => {
    const f = fixture();
    f.client.input("canvas", "node");
    await settle();
    f.client.acknowledged("canvas", f.client.versions("canvas"));
    f.time(2000);
    await f.client.tick("canvas");
    expect(f.calls).toEqual(["acquire", "release"]);
    expect(await f.client.proofs("canvas", nodes)).toEqual([]);
});
