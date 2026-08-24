import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http, { type Server } from "node:http";
import { test } from "node:test";

import { buildCanvasContext } from "../src/canvas-context.js";
import { CanvasSession } from "../src/canvas-session.js";
import { createLocalRuntimeApp } from "../src/local-runtime.js";
import { LocalRuntimeSessionManager } from "../src/local-runtime-session.js";
import { createCanvasAgentHttpModule } from "../src/modules/canvas-agent-http.js";
import { toolDescriptions, toolInputSchemas, toolNames } from "../src/schemas.js";
import type { LocalRuntimeConfig } from "../src/config.js";

const authority = "127.0.0.1:41743";
const endpoint = `http://${authority}`;
const origin = "http://127.0.0.1:3001";
const token = "legacy-canvas-token-fixture";

test("MCP manifest exposes the semantic canvas read tools with schemas and descriptions", () => {
    const expected = [
        "canvas_get_context",
        "canvas_find_nodes",
        "canvas_get_node",
        "canvas_get_connection",
        "canvas_get_generation_tasks",
        "canvas_get_resources",
        "canvas_validate_ops",
    ];
    for (const name of expected) {
        assert.ok(toolNames.includes(name as typeof toolNames[number]), `${name} is missing from toolNames`);
        assert.ok(toolDescriptions[name as keyof typeof toolDescriptions], `${name} is missing a description`);
        assert.ok(toolInputSchemas[name as keyof typeof toolInputSchemas], `${name} is missing an input schema`);
    }
    assert.deepEqual(
        toolNames.filter((name) => name.startsWith("canvas_")).slice(0, 10),
        [
            "canvas_get_state",
            "canvas_get_context",
            "canvas_find_nodes",
            "canvas_get_node",
            "canvas_get_connection",
            "canvas_get_generation_tasks",
            "canvas_get_resources",
            "canvas_validate_ops",
            "canvas_get_selection",
            "canvas_export_snapshot",
        ],
    );
});

test("Canvas module declares only Canvas scopes and constructs without CLI side effects", () => {
    const calls: string[] = [];
    const module = createCanvasAgentHttpModule(fixtureConfig(), sessionFixture(calls));

    assert.deepEqual(module.descriptor, {
        id: "canvas-agent",
        displayName: "Canvas Agent",
        apiVersion: 1,
        scopes: ["canvas:connect"],
    });
    assert.ok(module.routes.some((route) => route.path === "/events" && route.lastEventId));
    assert.ok(module.routes.every((route) => route.scope === "canvas:connect" && route.legacy));
    assert.deepEqual(calls, []);
});

test("Canvas legacy guard strips token before core handlers and rejects the wrong token", async () => {
    const calls: Array<{ name: string; value?: unknown }> = [];
    const session = sessionFixture(calls);
    const module = createCanvasAgentHttpModule(fixtureConfig(), session);
    const manager = new LocalRuntimeSessionManager({
        endpoint,
        trustedOrigins: [origin],
        registrations: [],
    });
    const app = createLocalRuntimeApp({
        authority,
        endpoint,
        version: "0.1.0",
        sessionManager: manager,
        modules: [module],
        legacyMasterToken: token,
        legacyOrigins: [origin],
    });
    const server = app.listen(0, "127.0.0.1");
    await listening(server);
    try {
        const accepted = await request(server, {
            method: "POST",
            path: `/canvas/state?clientId=fixture&token=${token}`,
            headers: jsonHeaders(),
            body: '{"nodes":[]}',
        });
        assert.equal(accepted.status, 200);
        assert.deepEqual(calls.at(-1), { name: "state", value: { nodes: [] } });

        const event = await request(server, {
            path: `/events?clientId=fixture&token=${token}`,
            headers: { Host: authority, Origin: origin },
        });
        assert.equal(event.status, 204);
        assert.deepEqual(calls.at(-1), {
            name: "events",
            value: { clientId: "fixture", token: null },
        });

        const before = calls.length;
        const rejected = await request(server, {
            method: "POST",
            path: "/canvas/state?token=wrong",
            headers: jsonHeaders(),
            body: '{"nodes":[]}',
        });
        assert.equal(rejected.status, 401);
        assert.equal(calls.length, before);
    } finally {
        manager.dispose();
        await close(server);
    }
});

test("CanvasSession dispose closes streams and a replaced stream cannot clear the active client", () => {
    const session = new CanvasSession();
    const first = eventResponse();
    const second = eventResponse();

    session.openEvents(new URL("http://127.0.0.1/events?clientId=fixture"), first.response as never);
    session.updateState({ nodes: [] }, "fixture");
    session.openEvents(new URL("http://127.0.0.1/events?clientId=fixture"), second.response as never);
    first.response.emit("close");
    assert.deepEqual(session.health(), { ok: true, hasCanvas: true, clients: 1 });

    session.dispose();
    assert.equal(second.ended(), 1);
    assert.deepEqual(session.health(), { ok: true, hasCanvas: false, clients: 0 });
    second.response.emit("close");
});

test("CanvasSession exposes precise node and connection reads", async () => {
    const session = new CanvasSession();
    const response = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=precise-read"), response.response as never);
    session.updateState({
        nodes: [
            { id: "node-a", type: "text", title: "A", position: { x: 0, y: 0 }, width: 320, height: 240 },
            { id: "node-b", type: "image", title: "B", position: { x: 400, y: 0 }, width: 320, height: 320, metadata: { status: "success", storageKey: "resource:b" } },
        ],
        connections: [{ id: "connection-1", fromNodeId: "node-a", toNodeId: "node-b" }],
    }, "precise-read");
    assert.equal((await session.callTool("canvas_get_node", { id: "node-b" }) as { found: boolean }).found, true);
    assert.equal((await session.callTool("canvas_get_connection", { id: "connection-1" }) as { found: boolean }).found, true);
    assert.equal((await session.callTool("canvas_get_node", { id: "missing" }) as { found: boolean }).found, false);
    session.dispose();
});

test("CanvasSession closes only streams owned by a revoked Runtime session", async () => {
    const session = new CanvasSession();
    const closeRuntimeSession = (session as CanvasSession & {
        closeRuntimeSession?: (sessionId: string) => void;
    }).closeRuntimeSession;
    assert.equal(typeof closeRuntimeSession, "function");
    if (!closeRuntimeSession) return;

    const first = eventResponse();
    const second = eventResponse();
    const legacy = eventResponse();
    const openEvents = session.openEvents as unknown as (
        url: URL,
        response: EventEmitter,
        runtimeSessionId?: string,
    ) => void;
    openEvents.call(session, new URL("http://127.0.0.1/events?clientId=first"), first.response, "session-a");
    openEvents.call(session, new URL("http://127.0.0.1/events?clientId=second"), second.response, "session-b");
    openEvents.call(session, new URL("http://127.0.0.1/events?clientId=legacy"), legacy.response);
    session.updateState({ nodes: [] }, "first");
    const pending = session.callTool("canvas_apply_ops", { ops: [] });

    closeRuntimeSession.call(session, "session-a");

    assert.equal(first.ended(), 1);
    assert.equal(second.ended(), 0);
    assert.equal(legacy.ended(), 0);
    assert.deepEqual(session.health(), { ok: true, hasCanvas: false, clients: 2 });
    await assert.rejects(pending, /会话已撤销/);
    session.dispose();
});

test("Canvas generation tool continuation survives a browser stream reconnect until the same request is resolved", async () => {
    const session = new CanvasSession();
    const first = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=agent-client-before-refresh"), first.response as never);
    session.updateState({
        nodes: [{ id: "existing-image", type: "image", title: "Existing", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { generationMode: "image", taskId: "dreamina:prior-task-0001" } }],
    }, "agent-client-before-refresh");

    try {
        const pending = session.callTool("canvas_run_generation", { nodeId: "existing-image", mode: "image", prompt: "Retry image", retry: true });
        const call = latestToolCall(first.writes());
        first.response.emit("close");
        let settled = false;
        void pending.finally(() => { settled = true; }).catch(() => undefined);
        await Promise.resolve();
        assert.equal(settled, false, "generation tool must remain resumable across a browser refresh");

        const second = eventResponse();
        session.openEvents(new URL("http://127.0.0.1/events?clientId=agent-client-after-refresh"), second.response as never);
        session.resolveResult({ requestId: call.requestId, result: { accepted: true } });
        assert.deepEqual(await pending, { accepted: true });
    } finally {
        session.dispose();
    }
});

test("CanvasSession expands a workflow into semantic nodes, non-overlapping layout, real edges, and selective generation", async () => {
    const session = new CanvasSession();
    const events = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=agent-workflow"), events.response as never);
    session.updateState({
        nodes: [{ id: "existing-character", type: "image", title: "角色原画", position: { x: 0, y: 0 }, width: 560, height: 380, metadata: { status: "success", storageKey: "resource:character" } }],
        connections: [],
    }, "agent-workflow");

    try {
        const pending = session.callTool("canvas_create_workflow", {
            title: "搞笑修仙小说流水线",
            nodes: [
                { ref: "cards", kind: "character_cards", title: "角色拆分图片卡片", referenceNodeIds: ["existing-character"] },
                { ref: "views", kind: "character_three_view", title: "角色三视图", prompt: "基于角色卡片生成正面、侧面、背面三视图", referenceRefs: ["cards"] },
                { ref: "storyboard", kind: "storyboard_video", title: "分镜剧情视频", prompt: "基于三视图制作分镜剧情视频", referenceRefs: ["views"], runGeneration: true },
            ],
        });
        const call = latestToolCall(events.writes());
        const ops = (call.input as { ops: Array<Record<string, unknown>> }).ops;
        const added = ops.filter((op) => op.type === "add_node");
        const edges = ops.filter((op) => op.type === "connect_nodes");
        const runs = ops.filter((op) => op.type === "run_generation");

        assert.deepEqual(added.map((op) => op.nodeType), ["image", "image", "video"]);
        assert.match(String((added[0]?.metadata as Record<string, unknown>)?.prompt), /拆分主要角色/);
        assert.equal(edges.length, 3, "two workflow edges plus one existing reference edge");
        assert.equal(runs.length, 1, "runGeneration only affects the explicitly requested node");
        assert.equal(runs[0]?.nodeId, added[2]?.id);
        assert.ok(Number((added[1]?.position as { x: number }).x) > Number((added[0]?.position as { x: number }).x) + Number(added[0]?.width));
        assert.ok(Number((added[2]?.position as { x: number }).x) > Number((added[1]?.position as { x: number }).x) + Number(added[1]?.width));
        assert.ok(edges.some((op) => op.fromNodeId === "existing-character" && op.toNodeId === added[0]?.id));

        session.resolveResult({ requestId: call.requestId, result: { accepted: true } });
        assert.deepEqual(await pending, { accepted: true });
    } finally {
        session.dispose();
    }
});

test("CanvasSession rejects media workflow nodes without real creative content", async () => {
    const session = new CanvasSession();
    const events = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=agent-workflow-invalid"), events.response as never);
    session.updateState({ nodes: [] }, "agent-workflow-invalid");
    try {
        await assert.rejects(
            session.callTool("canvas_create_workflow", {
                nodes: [{ ref: "empty-image", kind: "image", title: "空图片节点" }],
            }),
            /缺少 prompt\/content/,
        );
        assert.equal(events.writes().some((value) => value.includes("event: tool_call")), false);
    } finally {
        session.dispose();
    }
});

test("Canvas Dreamina image generation preserves the shared product model and auto quality before run_generation", async () => {
    const session = new CanvasSession();
    const events = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=agent-dreamina-product"), events.response as never);
    session.updateState({ nodes: [] }, "agent-dreamina-product");

    try {
        const generated = session.callTool("canvas_generate_image", {
            prompt: "A cinematic city at night",
            model: "local:dreamina-cli:5.0",
            quality: "auto",
            size: "16:9",
            count: 1,
        });
        const call = latestToolCall(events.writes());
        const ops = (call.input as { ops: Array<Record<string, unknown>> }).ops;
        const target = ops.find((op) => op.type === "add_node" && op.nodeType === "image");
        const metadata = target?.metadata as Record<string, unknown> | undefined;
        const run = ops.find((op) => op.type === "run_generation");
        assert.equal(metadata?.model, "local:dreamina-cli:5.0");
        assert.equal(metadata?.quality, "auto");
        assert.equal(metadata?.size, "16:9");
        assert.deepEqual(run && { type: run.type, nodeId: run.nodeId, mode: run.mode }, {
            type: "run_generation",
            nodeId: target?.id,
            mode: "image",
        });
        session.resolveResult({ requestId: call.requestId, result: { accepted: true } });
        await generated;
    } finally {
        session.dispose();
    }
});

test("CanvasSession keeps ordinary tool timeout at 30s and generation continuation at 35min with one settlement", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const delays: number[] = [];
    const cleared = new Set<unknown>();
    let nextHandle = 0;
    Object.defineProperty(globalThis, "setTimeout", {
        configurable: true,
        value: ((_: (...args: unknown[]) => void, delay?: number) => {
            delays.push(Number(delay));
            return { id: ++nextHandle, unref() {} };
        }) as typeof setTimeout,
    });
    Object.defineProperty(globalThis, "clearTimeout", {
        configurable: true,
        value: ((handle: unknown) => { cleared.add(handle); }) as typeof clearTimeout,
    });
    const session = new CanvasSession();
    const events = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=timeout-client"), events.response as never);
    session.updateState({ nodes: [] }, "timeout-client");
    try {
        const ordinary = session.callTool("canvas_apply_ops", { ops: [{ type: "select_nodes", ids: [] }] });
        const ordinaryCall = latestToolCall(events.writes());
        assert.equal(delays.at(-1), 30_000);
        session.resolveResult({ requestId: ordinaryCall.requestId, result: { accepted: "ordinary" } });
        assert.deepEqual(await ordinary, { accepted: "ordinary" });

        const generation = session.callTool("canvas_generate_image", {
            prompt: "A safe fixture",
            model: "local:dreamina-cli:5.0",
            quality: "auto",
            size: "16:9",
            count: 1,
        });
        const generationCall = latestToolCall(events.writes());
        assert.equal(delays.at(-1), 35 * 60 * 1_000);
        let settlements = 0;
        void generation.then(() => { settlements += 1; }, () => { settlements += 1; });
        session.resolveResult({ requestId: generationCall.requestId, result: { accepted: "generation" } });
        assert.deepEqual(await generation, { accepted: "generation" });
        await Promise.resolve();
        assert.equal(settlements, 1);
        session.resolveResult({ requestId: generationCall.requestId, result: { accepted: "duplicate" } });
        await Promise.resolve();
        assert.equal(settlements, 1);
        assert.equal(cleared.size, 2);
    } finally {
        Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: originalSetTimeout });
        Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: originalClearTimeout });
        session.dispose();
    }
});

test("Canvas generation tools emit generic run operations and preserve product configuration values", async () => {
    const session = new CanvasSession();
    const events = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=agent-client"), events.response as never);
    session.updateState({
        nodes: [{ id: "existing-image", type: "image", title: "Existing", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { generationMode: "image" } }],
    }, "agent-client");

    try {
        const generated = session.callTool("canvas_generate_video", { prompt: "A short test clip", seconds: "4", vquality: "720" });
        const generateCall = latestToolCall(events.writes());
        const generateOps = (generateCall.input as { ops: Array<Record<string, unknown>> }).ops;
        const target = generateOps.find((op) => op.type === "add_node" && op.nodeType === "video");
        const run = generateOps.find((op) => op.type === "run_generation");
        assert.equal((target?.metadata as Record<string, unknown>)?.vquality, "720");
        assert.deepEqual(run && { type: run.type, nodeId: run.nodeId, mode: run.mode }, { type: "run_generation", nodeId: target?.id, mode: "video" });
        session.resolveResult({ requestId: generateCall.requestId, result: { accepted: true } });
        await generated;

        const rerun = session.callTool("canvas_run_generation", { nodeId: "existing-image", mode: "image", prompt: "Retry image", retry: true });
        const rerunCall = latestToolCall(events.writes());
        assert.deepEqual(rerunCall.input, { ops: [{ type: "run_generation", nodeId: "existing-image", mode: "image", prompt: "Retry image", retry: true }] });
        session.resolveResult({ requestId: rerunCall.requestId, result: { accepted: true } });
        await rerun;
    } finally {
        session.dispose();
    }
});

function fixtureConfig(): LocalRuntimeConfig {
    return {
        url: endpoint,
        token,
        ownerId: "owner-canvas-fixture-001",
        origins: [origin],
        trustedWebOrigins: [origin],
        browserRegistrations: [],
        canvases: {},
    };
}

function sessionFixture(calls: Array<string | { name: string; value?: unknown }>) {
    return {
        health: () => ({ ok: true, hasCanvas: false, clients: 0 }),
        openEvents: (url: URL, res: { status(code: number): unknown; end(): void }) => {
            calls.push({
                name: "events",
                value: { clientId: url.searchParams.get("clientId"), token: url.searchParams.get("token") },
            });
            res.status(204);
            res.end();
        },
        updateState: (value: unknown) => { calls.push({ name: "state", value }); },
        resolveResult: (value: unknown) => { calls.push({ name: "result", value }); },
        emitAll: () => undefined,
        callTool: async (name: unknown, value: unknown) => {
            calls.push({ name: String(name), value });
            return { accepted: true };
        },
        closeRuntimeSession: (sessionId: string) => { calls.push({ name: "revoke", value: sessionId }); },
        dispose: () => { calls.push("dispose"); },
    };
}

function jsonHeaders() {
    return { Host: authority, Origin: origin, "Content-Type": "application/json" };
}

function request(
    server: Server,
    options: { method?: string; path: string; headers: Record<string, string>; body?: string },
) {
    const address = server.address();
    assert(address && typeof address === "object");
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port: address.port,
            method: options.method ?? "GET",
            path: options.path,
            headers: options.headers,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.once("error", reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function eventResponse() {
    const writes: string[] = [];
    const response = new EventEmitter() as EventEmitter & {
        writeHead(): void;
        write(chunk: unknown): void;
        end(): void;
    };
    let ended = 0;
    response.writeHead = () => undefined;
    response.write = (chunk) => { writes.push(String(chunk)); };
    response.end = () => { ended += 1; };
    return { response, ended: () => ended, writes: () => [...writes] };
}

function latestToolCall(writes: string[]) {
    const event = [...writes].reverse().find((value) => value.startsWith("event: tool_call\n"));
    assert.ok(event);
    const data = event.split("\n").find((line) => line.startsWith("data: "));
    assert.ok(data);
    return JSON.parse(data.slice("data: ".length)) as { requestId: string; name: string; input: unknown };
}

function listening(server: Server) {
    if (server.listening) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
}

function close(server: Server) {
    return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("CanvasSession rejects stale state revisions and accepts idempotent retries", () => {
    const session = new CanvasSession();
    const first = session.updateState({ projectId: "canvas-1", nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 } }, "fixture");
    assert.equal(first.accepted, true);
    assert.equal(first.revision, 0);

    const idempotent = session.updateState({ projectId: "canvas-1", nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, revision: 0 }, "fixture");
    assert.equal(idempotent.accepted, true);
    assert.equal(idempotent.idempotent, true);

    const conflict = session.updateState({ projectId: "canvas-1", nodes: [{ id: "n-1", type: "text", position: { x: 0, y: 0 }, width: 100, height: 100 }], connections: [], viewport: { x: 0, y: 0, k: 1 }, revision: 0 }, "fixture");
    assert.equal(conflict.accepted, false);
    assert.equal(conflict.reason, "revision_conflict");

    const next = session.updateState({ projectId: "canvas-1", nodes: [{ id: "n-1", type: "text", position: { x: 0, y: 0 }, width: 100, height: 100 }], connections: [], viewport: { x: 0, y: 0, k: 1 }, revision: 1 }, "fixture");
    assert.equal(next.accepted, true);
    assert.equal(next.revision, 1);

    const stale = session.updateState({ projectId: "canvas-1", nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, revision: 0 }, "fixture");
    assert.equal(stale.accepted, false);
    assert.equal(stale.reason, "stale_revision");
    session.dispose();
});


test("canvas_apply_ops enforces expected revision and state hash before dispatch", async () => {
    const session = new CanvasSession();
    const events = eventResponse();
    session.openEvents(new URL("http://127.0.0.1/events?clientId=guarded-write"), events.response as never);
    session.updateState({ nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 } }, "guarded-write");
    const context = buildCanvasContext({ nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, revision: 0 });
    try {
        const accepted = session.callTool("canvas_apply_ops", { ops: [], expectedRevision: 0, expectedStateHash: context.stateHash });
        const call = latestToolCall(events.writes());
        session.resolveResult({ requestId: call.requestId, result: { accepted: true } });
        assert.deepEqual(await accepted, { accepted: true });

        const writeCount = events.writes().length;
        await assert.rejects(
            session.callTool("canvas_apply_ops", { ops: [], expectedRevision: 1 }),
            /revision.*重新读取 canvas_get_context/
        );
        assert.equal(events.writes().length, writeCount);
        await assert.rejects(
            session.callTool("canvas_apply_ops", { ops: [], expectedRevision: 0, expectedStateHash: "bad-hash" }),
            /画布状态已变化.*重新读取 canvas_get_context/
        );
        assert.equal(events.writes().length, writeCount);
    } finally {
        session.dispose();
    }
});
