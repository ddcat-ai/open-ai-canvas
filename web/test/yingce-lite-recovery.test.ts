import { describe, expect, test } from "bun:test";
import { recoverYingceGenerations, waitForYingceRecoveredReceipt } from "../src/services/api/yingce-lite-recovery";
import type { YingceJournalRecord } from "../src/services/api/yingce-lite-ipc";
import type { GenerationTask } from "../src/services/api/task-center";

const context = { id: "yingce-local:test", prompt: "hello", model: "model", createdAt: "2026-01-01T00:00:00Z", projectId: "project", nodeId: "node" };
type Dependencies = NonNullable<Parameters<typeof recoverYingceGenerations>[0]>;

function setup(records: YingceJournalRecord[]) {
    let scope = "alice";
    const receipts = new Map<string, GenerationTask>();
    const blobs = new Map<string, Blob>();
    const acknowledgements: string[] = [];
    const deps = {
        scope: () => scope,
        readJournal: async () => ({ owner: "a".repeat(64), scope: "alice", records }),
        acknowledge: async (_owner: string, id: string) => {
            acknowledgements.push(id);
        },
        getReceipt: async (id: string) => receipts.get(id),
        saveReceipt: async (task: GenerationTask) => {
            if (!receipts.has(task.id)) receipts.set(task.id, task);
        },
        lock: async (_scope: string, operation: () => Promise<unknown>) => operation(),
        writeImage: async (key: string, blob: Blob) => {
            blobs.set(key, blob);
            return "";
        },
        readImage: async (key: string) => blobs.get(key) || null,
        writeAudio: async (key: string, blob: Blob) => {
            blobs.set(key, blob);
            return "";
        },
        readAudio: async (key: string) => blobs.get(key) || null,
        fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    } as unknown as Dependencies;
    return {
        deps,
        receipts,
        blobs,
        acknowledgements,
        setScope: (value: string) => {
            scope = value;
        },
    };
}

describe("Lite generation journal recovery", () => {
    test("等待活跃请求结束；没有回执时提示状态未确认，不重发", async () => {
        let active = true;
        let waits = 0;
        const signal = new AbortController().signal;
        await expect(
            waitForYingceRecoveredReceipt(context.id, signal, {
                recover: async () => ({ restored: 0, failures: [], unknown: active ? 0 : 1, pendingIds: active ? [context.id] : [] }),
                get: async () => undefined,
                wait: async () => {
                    waits++;
                    active = false;
                },
            }),
        ).rejects.toThrow("状态未确认");
        expect(waits).toBe(1);
    });

    test("活跃请求的回执迟到时可以恢复；取消后不再返回结果", async () => {
        const controller = new AbortController();
        const receipt: GenerationTask = { id: context.id, type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" };
        let available = false;
        const deps = {
            recover: async () => ({ restored: 0, failures: [], unknown: 0, pendingIds: [context.id] }),
            get: async () => (available ? receipt : undefined),
            wait: async () => {
                available = true;
            },
        };
        expect(await waitForYingceRecoveredReceipt(context.id, controller.signal, deps)).toEqual(receipt);
        available = false;
        await expect(
            waitForYingceRecoveredReceipt(context.id, controller.signal, {
                ...deps,
                wait: async () => {
                    controller.abort();
                },
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
    });
    test("restores text, Gemini image and audio before acknowledging; unknown requests are never replayed", async () => {
        const records: YingceJournalRecord[] = [
            { version: 1, status: "completed", context: { ...context, capability: "text", textWire: "chat-completion" }, result: { choices: [{ message: { content: "answer" } }] } },
            {
                version: 1,
                status: "completed",
                context: { ...context, id: "yingce-local:image", capability: "image", protocol: "gemini-image", batchId: "batch", batchIndex: 0, batchCount: 2 },
                result: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQID" } }] } }] },
            },
            { version: 1, status: "completed", context: { ...context, id: "yingce-local:audio", capability: "audio", format: "mp3" }, result: { contentType: "audio/mpeg", bytesBase64: "AQID" } },
            { version: 1, status: "unknown", context: { ...context, id: "yingce-local:unknown", capability: "text" } },
        ];
        const { deps, receipts, blobs, acknowledgements } = setup(records);
        expect(await recoverYingceGenerations(deps)).toEqual({ restored: 3, failures: [], unknown: 1, pendingIds: [] });
        expect(acknowledgements).toEqual(["yingce-local:test", "yingce-local:image", "yingce-local:audio"]);
        expect(JSON.parse(receipts.get("yingce-local:test")!.resultJson!).text).toBe("answer");
        expect(JSON.parse(receipts.get("yingce-local:test")!.inputJson!).metadata.nodeId).toBe("node");
        expect(receipts.get("yingce-local:image")!.clientContext).toEqual({ batchId: "batch", batchIndex: 0, batchCount: 2 });
        expect([...blobs.keys()].every((key) => key.includes(":alice:"))).toBe(true);
        expect(JSON.parse(receipts.get("yingce-local:audio")!.resultJson!).audio.mimeType).toBe("audio/mpeg");
    });

    test("retains completed records after local save failure or account switch", async () => {
        const record: YingceJournalRecord = { version: 1, status: "completed", context: { ...context, capability: "text", textWire: "chat-completion" }, result: { choices: [{ message: { content: "answer" } }] } };
        const test = setup([record]);
        test.deps.saveReceipt = async () => {
            throw new Error("disk full");
        };
        expect(await recoverYingceGenerations(test.deps)).toMatchObject({ restored: 0, failures: [context.id] });
        expect(test.acknowledgements).toEqual([]);
        test.deps.saveReceipt = async () => {
            test.setScope("bob");
        };
        expect(await recoverYingceGenerations(test.deps)).toMatchObject({ restored: 0 });
        expect(test.acknowledgements).toEqual([]);
    });

    test("acknowledges an existing receipt without replacing its full metadata", async () => {
        const record: YingceJournalRecord = { version: 1, status: "completed", context: { ...context, capability: "text", textWire: "chat-completion" }, result: {} };
        const test = setup([record]);
        test.receipts.set(context.id, { id: context.id, type: "canvas_text", status: "succeeded", prompt: "original", attempts: 1, createdAt: context.createdAt, updatedAt: context.createdAt });
        expect(await recoverYingceGenerations(test.deps)).toMatchObject({ restored: 1 });
        expect(test.receipts.get(context.id)!.prompt).toBe("original");
        expect(test.acknowledgements).toEqual([context.id]);
    });

    test("restores canvas routing and result-processing metadata from the journal", async () => {
        const record: YingceJournalRecord = {
            version: 1,
            status: "completed",
            context: { ...context, capability: "text", textWire: "chat-completion", sourceNodeId: "source", domainProjectId: "domain", edit: "mask", layerDecomposition: true },
            result: { choices: [{ message: { content: "answer" } }] },
        };
        const state = setup([record]);
        await recoverYingceGenerations(state.deps);
        expect(JSON.parse(state.receipts.get(context.id)!.inputJson!).metadata).toEqual({ nodeId: "node", sourceNodeId: "source", domainProjectId: "domain", edit: "mask", layerDecomposition: true });
    });

    test("reports a damaged record while restoring other results", async () => {
        const test = setup([
            { version: 1, status: "invalid", context: { id: "yingce-local:damaged" } },
            { version: 1, status: "completed", context: { ...context, capability: "text", textWire: "chat-completion" }, result: { choices: [{ message: { content: "answer" } }] } },
        ]);
        expect(await recoverYingceGenerations(test.deps)).toEqual({ restored: 1, failures: ["yingce-local:damaged"], unknown: 0, pendingIds: [] });
        expect(test.acknowledgements).toEqual([context.id]);
    });
});
