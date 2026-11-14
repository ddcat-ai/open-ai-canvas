import { describe, expect, test } from "bun:test";
import { createYingceReceiptStore, YINGCE_RECEIPT_PREFIX } from "../src/services/api/yingce-lite-receipts";
import type { GenerationTask } from "../src/services/api/task-center";

const task = (id: string): GenerationTask => ({ id: YINGCE_RECEIPT_PREFIX + id, type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", resultJson: '{"text":"result"}' });

function setup(silentWrite = false) {
    const values = new Map<string, string>();
    let scope = "alice";
    const store = createYingceReceiptStore({
        getScope: () => scope,
        storageForScope: (owner) => ({
            getItem: (key) => values.get(`${owner}:${key}`) || null,
            setItem: (key, value) => {
                if (!silentWrite) values.set(`${owner}:${key}`, value);
            },
            removeItem: (key) => {
                values.delete(`${owner}:${key}`);
            },
        }),
        lock: async (_scope, action) => action(),
    });
    return {
        store,
        setScope: (next: string) => {
            scope = next;
        },
    };
}

describe("Lite generation receipts", () => {
    test("survives a new store instance and isolates accounts", async () => {
        const { store, setScope } = setup();
        await store.save(task("one"));
        setScope("bob");
        expect(await store.get(task("one").id)).toBeUndefined();
        await store.save(task("two"));
        setScope("alice");
        expect((await store.list()).map((item) => item.id)).toEqual([task("one").id]);
        expect((await store.get(task("one").id))?.resultJson).toContain("result");
    });

    test("does not report a silently skipped write as saved", async () => {
        const { store } = setup(true);
        await expect(store.save(task("one"))).rejects.toThrow("本地回执保存失败");
    });

    test("rejects guest and unfinished receipts", async () => {
        const { store, setScope } = setup();
        await expect(store.save({ ...task("one"), status: "running" })).rejects.toThrow();
        setScope("guest");
        await expect(store.save(task("one"))).rejects.toThrow();
    });
});
