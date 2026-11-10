import { describe, expect, test } from "bun:test";

import type { GenerationTaskEffectClaim } from "@/services/generation-task-materializer";

type WorkerRequest = { kind: "request"; id: number; action: string; args: unknown[] };
type WorkerResult = { kind: "result"; id: number; value?: unknown; error?: string };
type LockWaiter = { worker: Worker; id: number };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function sharedBrowserHarness(gateFirstRead = false) {
    const values = new Map<string, unknown>();
    const lockQueues = new Map<string, LockWaiter[]>();
    const workers: Worker[] = [];
    const firstRead = deferred<void>();
    let heldRead: (() => void) | undefined;
    let firstReadSeen = false;
    let storageReads = 0;
    let lockRequests = 0;
    function reply(worker: Worker, id: number, value?: unknown) {
        worker.postMessage({ kind: "response", id, value });
    }
    const createRealm = () => {
        const worker = new Worker(new URL("./helpers/generation-effect-lock.worker.ts", import.meta.url).href, { type: "module" });
        workers.push(worker);
        let sequence = 0;
        const commands = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
        worker.onmessage = (event: MessageEvent<WorkerRequest | WorkerResult>) => {
            const message = event.data;
            if (message.kind === "result") {
                const command = commands.get(message.id);
                commands.delete(message.id);
                if (message.error) command?.reject(new Error(message.error));
                else command?.resolve(message.value);
                return;
            }
            const [name, value] = message.args as [string, unknown];
            if (message.action === "get") {
                storageReads += 1;
                const snapshot = values.get(name) ?? null;
                if (gateFirstRead && !firstReadSeen) {
                    firstReadSeen = true;
                    heldRead = () => reply(worker, message.id, snapshot);
                    firstRead.resolve();
                } else {
                    reply(worker, message.id, snapshot);
                    heldRead?.();
                    heldRead = undefined;
                }
            } else if (message.action === "set") {
                values.set(name, value);
                reply(worker, message.id, value);
            } else if (message.action === "lock") {
                lockRequests += 1;
                const queue = lockQueues.get(name) ?? [];
                queue.push({ worker, id: message.id });
                lockQueues.set(name, queue);
                if (queue.length === 1) reply(worker, message.id);
                else {
                    heldRead?.();
                    heldRead = undefined;
                }
            } else if (message.action === "unlock") {
                const queue = lockQueues.get(name)!;
                queue.shift();
                reply(worker, message.id);
                if (queue.length) reply(queue[0].worker, queue[0].id);
                else lockQueues.delete(name);
            }
        };
        worker.onerror = (event) => {
            for (const command of commands.values()) command.reject(new Error(event.message));
        };
        return {
            invoke<T = unknown>(action: string, ...args: unknown[]): Promise<T> {
                const id = ++sequence;
                return new Promise((resolve, reject) => {
                    commands.set(id, { resolve: resolve as (value: unknown) => void, reject });
                    worker.postMessage({ kind: "command", id, action, args });
                });
            },
        };
    };
    return {
        createRealm,
        firstRead: firstRead.promise,
        get storageReads() {
            return storageReads;
        },
        get lockRequests() {
            return lockRequests;
        },
        dispose: () => workers.forEach((worker) => worker.terminate()),
    };
}

describe("生成副作用跨标签租约", () => {
    test("两个独立页面同时领取只有一个owner，另一页面等待后可读到完成结果", async () => {
        const harness = sharedBrowserHarness(true);
        try {
            const first = harness.createRealm();
            const second = harness.createRealm();
            await Promise.all([first.invoke("initialize", { browserLocks: true, required: true }), second.invoke("initialize", { browserLocks: true, required: true })]);
            const claimingFirst = first.invoke<GenerationTaskEffectClaim>("claim", "materialize:shared-task:0", "shared-task");
            await harness.firstRead;
            const claimingSecond = second.invoke<GenerationTaskEffectClaim>("claim", "materialize:shared-task:0", "shared-task");
            const [owner, contender] = await Promise.all([claimingFirst, claimingSecond]);
            expect(owner.status).toBe("claimed");
            expect(contender.status).toBe("busy");
            if (owner.status !== "claimed") throw new Error("Expected a claimed lease");
            await expect(first.invoke("renew", "materialize:shared-task:0", "shared-task", owner.binding)).resolves.toEqual({ fence: owner.fence });
            await first.invoke("complete", "materialize:shared-task:0", "shared-task", { materializedAssetId: "saved-asset" }, owner.binding);
            await expect(second.invoke("claim", "materialize:shared-task:0", "shared-task")).resolves.toEqual({ status: "completed", result: { materializedAssetId: "saved-asset" } });
            expect(harness.lockRequests).toBe(5);
        } finally {
            harness.dispose();
        }
    });

    test("生产要求跨标签锁而浏览器未提供时，降级为进程内互斥仍可领取", async () => {
        const harness = sharedBrowserHarness();
        try {
            const realm = harness.createRealm();
            await realm.invoke("initialize", { browserLocks: false, required: true });
            const owner = await realm.invoke<GenerationTaskEffectClaim>("claim", "materialize:no-lock:0", "no-lock");
            expect(owner.status).toBe("claimed");
            if (owner.status !== "claimed") throw new Error("Expected a claimed lease");
            await realm.invoke("complete", "materialize:no-lock:0", "no-lock", { materializedAssetId: "saved-without-web-locks" }, owner.binding);
            await expect(realm.invoke("claim", "materialize:no-lock:0", "no-lock")).resolves.toEqual({
                status: "completed",
                result: { materializedAssetId: "saved-without-web-locks" },
            });
            expect(harness.lockRequests).toBe(0);
            expect(harness.storageReads).toBeGreaterThan(0);
        } finally {
            harness.dispose();
        }
    });

    test("未要求跨标签锁的现有调用仍可使用进程内降级", async () => {
        const harness = sharedBrowserHarness();
        try {
            const realm = harness.createRealm();
            await realm.invoke("initialize", { browserLocks: false, required: false });
            const owner = await realm.invoke<GenerationTaskEffectClaim>("claim", "materialize:fallback:0", "fallback");
            expect(owner.status).toBe("claimed");
            if (owner.status !== "claimed") throw new Error("Expected a claimed lease");
            await realm.invoke("complete", "materialize:fallback:0", "fallback", {}, owner.binding);
            await expect(realm.invoke("claim", "materialize:fallback:0", "fallback")).resolves.toEqual({ status: "completed", result: {} });
            expect(harness.lockRequests).toBe(0);
        } finally {
            harness.dispose();
        }
    });
});
