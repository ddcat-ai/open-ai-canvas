import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, CreateAgentRunInput } from "../src/services/api/agent";

// Exercise the production protocol, isolating only transport/storage dependencies.
// Temporary modules avoid mock.module leaking into unrelated Bun test suites.
const dir = mkdtempSync(join(tmpdir(), "agent-reliability-"));
const root = new URL("../src/", import.meta.url);
const requestPath = join(dir, "request.ts");
writeFileSync(requestPath, 'export const apiBaseURL = "https://agent.invalid/api"; export const http = { post: async () => { throw new Error("unexpected POST"); } };');
writeFileSync(join(dir, "agent.ts"), readFileSync(new URL("services/api/agent.ts", root), "utf8")
    .replace('"@/services/api/request"', JSON.stringify(requestPath))
    .replace('"@/services/api/task-text-stream"', JSON.stringify(fileURLToPath(new URL("services/api/task-text-stream.ts", root)))));
const storagePath = join(dir, "storage.ts");
writeFileSync(storagePath, 'export const data = new Map(); export const localForageStorageForScope = () => ({ getItem: async (k) => data.get(k) ?? null, setItem: async (k,v) => {data.set(k,v);}, removeItem: async (k) => {data.delete(k);} });');
writeFileSync(join(dir, "scope.ts"), 'export const getActiveUserScope = () => "test-user";');
writeFileSync(join(dir, "conversations.ts"), readFileSync(new URL("services/cloud-agent-conversations.ts", root), "utf8")
    .replace('"@/lib/localforage-storage"', JSON.stringify(storagePath))
    .replace('"@/lib/user-scope"', JSON.stringify(join(dir, "scope.ts")))
    .replace('"@/lib/markdown-plain-text"', JSON.stringify(fileURLToPath(new URL("lib/markdown-plain-text.ts", root)))));
// Write every temporary module before Bun caches this directory on first import.
const api: typeof import("../src/services/api/agent") = await import(join(dir, "agent.ts"));
const transport = await import(requestPath);
const conversations: typeof import("../src/services/cloud-agent-conversations") = await import(join(dir, "conversations.ts"));
const storage = await import(storagePath);
const nativeFetch = globalThis.fetch;
const nativeTimer = globalThis.setTimeout;
let delays: number[] = [];
let stops: Array<() => void> = [];
beforeEach(() => {
    delays = [];
    storage.data.clear();
    // Retain watchdog semantics; accelerate only retry waits, recording real delays.
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        delays.push(ms ?? 0);
        return nativeTimer(fn, ms === 45_000 ? ms : Math.min(ms ?? 0, 1), ...args);
    }) as typeof setTimeout;
});
afterEach(() => {
    stops.forEach((stop) => stop());
    stops = [];
    globalThis.fetch = nativeFetch;
    globalThis.setTimeout = nativeTimer;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const snapshot = (status: string, extra = {}) => frame("run_snapshot", { id: "run", status, ...extra });
const event = (seq: number) => frame("agent_event", { runId: "run", eventId: `run:${seq}`, seq, type: "tool_completed", payload: { nodeId: "node" } });
const stream = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } });
function observe(options: { timeoutMs?: number; after?: number } = {}) {
    const events: AgentEvent[] = [];
    const statuses: string[] = [];
    let finish!: (error?: unknown) => void;
    const done = new Promise<unknown>((resolve, reject) => {
        const deadline = nativeTimer(() => reject(new Error("subscription did not settle")), 3000);
        finish = (error) => { clearTimeout(deadline); resolve(error); };
    });
    const stop = api.subscribeAgentEvents("run", (e) => {
        events.push(e);
        if (e.type === "run_status" && !e.payload.cleanupPending && ["completed", "failed", "cancelled"].includes(String(e.payload.status))) finish();
    }, { ...options, onError: finish, onConnectionChange: (s) => statuses.push(s) });
    stops.push(stop);
    return { events, statuses, done, stop, finish };
}

describe("Agent SSE recovery", () => {
    it("sends the user's final image settings with the approval and keeps cancellation", async () => {
        const requests: unknown[][] = [];
        transport.http.post = async (...args: unknown[]) => { requests.push(args); return { accepted: true }; };
        const signal = new AbortController().signal;
        const mediaSettings = { logicalModelId: "chosen-image", size: "1536x1024", quality: "high" };
        await api.decideAgentApproval("run/id", "approval/id", "approve", "", signal, mediaSettings);
        expect(requests).toEqual([["/agent/runs/run%2Fid/approvals/approval%2Fid/decision", { decision: "approve", reason: undefined, mediaSettings }, { signal }]]);
    });
    it.each([401, 403, 404, 422])("stops immediately on definitive %s", async (status) => {
        let requests = 0;
        globalThis.fetch = (async () => { requests++; return new Response("", { status }); }) as typeof fetch;
        const result = observe();
        expect(await result.done).toMatchObject({ status });
        expect(requests).toBe(1);
        expect(result.statuses.at(-1)).toBe("disconnected");
    });

    it.each(["", snapshot("running")])("bounds clean EOF retries even with repeated snapshots", async (body) => {
        let requests = 0;
        globalThis.fetch = (async () => { requests++; return stream(body); }) as typeof fetch;
        const result = observe();
        expect(await result.done).toBeInstanceOf(Error);
        expect(requests).toBe(5);
        expect(delays.filter((ms) => ms !== 45_000)).toHaveLength(4);
    });

    it("resumes the persisted cursor and deduplicates replayed events", async () => {
        const cursors: string[] = [];
        globalThis.fetch = (async (url, init) => {
            const cursor = new URL(String(url)).searchParams.get("after")!;
            cursors.push(cursor);
            expect((init?.headers as Record<string, string>)["Last-Event-ID"]).toBe(cursor);
            if (cursors.length === 2) throw new TypeError("connection reset");
            return stream(cursors.length === 1 ? event(1) + snapshot("running") : event(1) + event(2) + snapshot("completed"));
        }) as typeof fetch;
        const result = observe();
        expect(await result.done).toBeUndefined();
        expect(cursors).toEqual(["0", "1", "1"]);
        expect(result.events.filter((e) => e.seq > 0).map((e) => e.seq)).toEqual([1, 2]);
    });

    it("waits for durable cleanup after a terminal status", async () => {
        let requests = 0;
        globalThis.fetch = (async () => stream(snapshot("cancelled", { cleanupPending: ++requests === 1 }))) as typeof fetch;
        const result = observe();
        expect(await result.done).toBeUndefined();
        expect(requests).toBe(2);
        expect(result.events.filter((e) => e.type === "run_status").map((e) => e.payload.cleanupPending)).toEqual([true, false]);
    });

    it("honors Retry-After rather than immediately retrying 429", async () => {
        let requests = 0;
        globalThis.fetch = (async () => ++requests === 1 ? new Response("", { status: 429, headers: { "retry-after": "60" } }) : stream(snapshot("completed"))) as typeof fetch;
        const result = observe();
        await result.done;
        expect(requests).toBe(2);
        expect(delays).toContain(60_000);
    });

    it("returns long Retry-After waits to the user without retrying early", async () => {
        let requests = 0;
        globalThis.fetch = (async () => { requests++; return new Response("", { status: 429, headers: { "retry-after": "600" } }); }) as typeof fetch;
        const result = observe();
        expect(await result.done).toMatchObject({ status: 429 });
        expect(requests).toBe(1);
    });

    it("times out a stalled connection with a bounded retry budget", async () => {
        let requests = 0;
        globalThis.fetch = (async (_url, init) => {
            requests++;
            return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
        }) as typeof fetch;
        expect(await observe({ timeoutMs: 10 }).done).toBeInstanceOf(Error);
        expect(requests).toBe(5);
    });

    it("unsubscribe aborts the live reader without reporting a run failure", async () => {
        let cancelled = false;
        globalThis.fetch = (async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
        const result = observe();
        await new Promise((resolve) => nativeTimer(resolve, 5));
        result.stop();
        await new Promise((resolve) => nativeTimer(resolve, 5));
        expect(cancelled).toBe(true);
        expect(result.statuses).not.toContain("disconnected");
        result.finish();
        await result.done;
    });
});

describe("Agent admission replay and durable pending records", () => {
    const input: CreateAgentRunInput = { canvasId: "canvas", prompt: "generate", model: "original", idempotencyKey: "stable-key-123" };
    it("retries with a frozen original body/key and a bounded HTTP timeout", async () => {
        const bodies: unknown[] = [];
        const mutable = { ...input };
        transport.http.post = async (_path: string, body: unknown, options: unknown) => {
            bodies.push(structuredClone(body));
            expect(options).toEqual({ timeout: 15_000 });
            mutable.model = "changed";
            if (bodies.length < 3) throw { retryable: true };
            return { run: { id: "accepted" } };
        };
        expect(await api.createAgentRun(mutable)).toMatchObject({ run: { id: "accepted" } });
        expect(bodies).toEqual([input, input, input]);
    });

    it("limits transport failures to three attempts, but never retries admission rejection", async () => {
        let attempts = 0;
        transport.http.post = async () => { attempts++; throw { retryable: true }; };
        await expect(api.sendAgentMessage("parent", input)).rejects.toMatchObject({ retryable: true });
        expect(attempts).toBe(3);
        attempts = 0;
        transport.http.post = async () => { attempts++; throw { status: 400, retryable: false }; };
        await expect(api.createAgentRun(input)).rejects.toMatchObject({ status: 400 });
        expect(attempts).toBe(1);
    });

    it("restores the full original request and message identity, isolated by conversation", async () => {
        const pending = { fingerprint: "fingerprint", key: input.idempotencyKey, request: input, parentRunId: "parent", messageId: "bubble" };
        await conversations.saveCloudAgentPendingSubmission("canvas", "conversation", pending);
        expect(await conversations.loadCloudAgentPendingSubmission("canvas", "conversation")).toEqual(pending);
        expect(await conversations.loadCloudAgentPendingSubmission("canvas", "other")).toBeNull();
        await conversations.clearCloudAgentPendingSubmission("canvas", "conversation");
        expect(await conversations.loadCloudAgentPendingSubmission("canvas", "conversation")).toBeNull();
    });

    it.each(["{broken", "null", "{}", JSON.stringify({ fingerprint: "f", key: input.idempotencyKey, request: { ...input, idempotencyKey: "wrong-key" } })])("fails closed on corrupt pending recovery data", async (raw) => {
        await conversations.saveCloudAgentPendingSubmission("canvas", "conversation", { fingerprint: "f", key: input.idempotencyKey });
        const key = [...storage.data.keys()][0];
        storage.data.set(key, raw);
        await expect(conversations.loadCloudAgentPendingSubmission("canvas", "conversation")).rejects.toThrow("已暂停本对话发送");
        expect(storage.data.get(key)).toBe(raw);
    });
});
