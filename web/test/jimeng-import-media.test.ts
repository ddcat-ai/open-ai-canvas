import { describe, expect, test } from "bun:test";

import { JIMENG_MEDIA_RETRY_LIMIT, transferJimengImportMedia, type JimengMediaStoreBatch, type JimengMediaStoreItem } from "../src/services/jimeng-import-media";
import type { StoredJimengMedia } from "../src/lib/canvas/jimeng-import";
import type { RemoteResource } from "../src/services/api/resources";

function resource(id: string): RemoteResource {
    return { id, userId: "user-1", kind: "image", status: "ready", provider: "local", endpoint: "", bucket: "", objectKey: id, publicUrl: "", mimeType: "image/png", size: 3, createdAt: "", updatedAt: "" };
}

const toStoredMedia = (item: RemoteResource): StoredJimengMedia => ({ url: `/api/resources/${item.id}/file`, storageKey: `resource:${item.id}` });

function harness(script: (call: number, ids: string[]) => JimengMediaStoreItem[] | "throw", options: { stopAfterCalls?: number } = {}) {
    const calls: string[][] = [];
    const progress: number[] = [];
    const waits: number[][] = [];
    const run = () =>
        transferJimengImportMedia({
            resourceIds: ["a", "b", "c", "d", "e", "a"],
            store: async (ids) => {
                calls.push(ids);
                const outcome = script(calls.length, ids);
                if (outcome === "throw") throw new Error("network");
                return { items: outcome, retryAfterSeconds: 0 };
            },
            toStoredMedia,
            onProgress: ({ done }) => progress.push(done),
            shouldStop: () => calls.length >= (options.stopAfterCalls ?? Number.POSITIVE_INFINITY),
            waitForQuota: async (seconds, onTick) => {
                waits.push([seconds]);
                onTick(seconds);
            },
        });
    return { calls, progress, waits, run };
}

describe("Jimeng import media transfer", () => {
    test("retries transient failures, keeps deterministic ones as failures and dedupes input", async () => {
        const scripted = (call: number, ids: string[]): JimengMediaStoreItem[] =>
            ids.map((id) => {
                if (id === "a" || id === "e" || (id === "b" && call > 1)) return { resourceId: id, resource: resource(id) };
                if (id === "b") return { resourceId: id, deferred: true };
                if (id === "d") return { resourceId: id, error: "远程资源必须小于 50MB" };
                return { resourceId: id, error: "远程资源读取失败", retryable: true };
            });
        const h = harness(scripted);
        const outcome = await h.run();
        expect(h.calls).toEqual([["a", "b", "c", "d", "e"], ["b", "c"], ["c"]]);
        expect([...outcome.stored.keys()].sort()).toEqual(["a", "b", "e"]);
        expect(outcome.stored.get("a")).toEqual({ url: "/api/resources/a/file", storageKey: "resource:a" });
        expect([...outcome.failures.entries()].sort()).toEqual([
            ["c", "远程资源读取失败"],
            ["d", "远程资源必须小于 50MB"],
        ]);
        // 进度只增不减，结束时全部素材都有结果。
        expect(h.progress).toEqual([...h.progress].sort((left, right) => left - right));
        expect(h.progress.at(-1)).toBe(5);
        expect(h.waits).toEqual([]);
    });

    test("waits for the site limit when the server defers items", async () => {
        const calls: string[][] = [];
        const ticks: number[] = [];
        const outcome = await transferJimengImportMedia({
            resourceIds: ["a", "b"],
            store: async (ids) => {
                calls.push(ids);
                return calls.length === 1 ? { items: ids.map((resourceId) => ({ resourceId, deferred: true })), retryAfterSeconds: 42 } : { items: ids.map((resourceId) => ({ resourceId, resource: resource(resourceId) })), retryAfterSeconds: 0 };
            },
            toStoredMedia,
            onProgress: () => {},
            shouldStop: () => false,
            waitForQuota: async (seconds, onTick) => {
                ticks.push(seconds);
                onTick(seconds - 1);
            },
        });
        expect(calls).toEqual([
            ["a", "b"],
            ["a", "b"],
        ]);
        expect(ticks).toEqual([42]);
        expect(outcome.stored.size).toBe(2);
        expect(outcome.failures.size).toBe(0);
    });

    test("retries a failed request a limited number of times and then records it", async () => {
        const h = harness(() => "throw");
        const outcome = await h.run();
        expect(h.calls.length).toBe(1 + JIMENG_MEDIA_RETRY_LIMIT);
        expect(outcome.stored.size).toBe(0);
        expect([...outcome.failures.values()]).toEqual(["a", "b", "c", "d", "e"].map(() => "转存请求失败"));
    });

    test("stops without recording the untouched remainder when asked", async () => {
        const h = harness((call, ids) => ids.map((id) => (call === 1 && id !== "e" ? { resourceId: id, resource: resource(id) } : { resourceId: id, deferred: true })), { stopAfterCalls: 1 });
        const outcome = await h.run();
        expect(h.calls).toEqual([["a", "b", "c", "d", "e"]]);
        expect([...outcome.stored.keys()]).toEqual(["a", "b", "c", "d"]);
        // 被 stop 时留在队列里的素材既不算已转存也不算失败，由调用方按“未转存”提示。
        expect(outcome.failures.size).toBe(0);
    });
});
