import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ApiError, http } from "../src/services/api/request";
import { createGenerationTaskSubscriptionService, waitForGenerationTask, type GenerationTask } from "../src/services/api/task-center";
import { runCanvasGenerationTaskToConsumer } from "../src/lib/canvas/canvas-project-generation";
import { commitCanvasGenerationResult } from "../src/lib/canvas/canvas-generation-result";
import { defaultConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const running: GenerationTask = { id: "long-video", type: "canvas_video", status: "running", prompt: "fixture", attempts: 1, createdAt: "2026-10-04T16:03:36Z", updatedAt: "2026-10-04T16:03:36Z" };
const succeeded: GenerationTask = { ...running, status: "succeeded", resultJson: '{"video":{"storageKey":"resource:video"}}' };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let restores: Array<() => void>;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    restores = [];
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { setTimeout, clearTimeout, localStorage: { getItem: () => "fixture" } }) });
});
afterEach(() => {
    for (const restore of restores.reverse()) restore();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});
function queries(read: () => GenerationTask | Promise<GenerationTask>) {
    const spy = spyOn(http, "get").mockImplementation(read as typeof http.get);
    restores.push(() => spy.mockRestore());
    return spy;
}

test("a video finishing after 49 minutes still reaches its real backend success", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    restores.push(() => clock.mockRestore());
    let calls = 0;
    queries(() => {
        now = 49 * 60 * 1000 + 52 * 1000;
        return ++calls === 1 ? running : succeeded;
    });
    const updates: string[] = [];
    expect(await waitForGenerationTask(running.id, { initialTask: running, intervalMs: 1, onTaskUpdate: (task) => updates.push(task.status) })).toEqual(succeeded);
    expect(updates).toEqual(["running", "succeeded"]);
    expect(calls).toBe(2);
});

test("late success reaches the current canvas consumer once without a second generation", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    restores.push(() => clock.mockRestore());
    let calls = 0;
    queries(() => {
        now = 49 * 60 * 1000 + 52 * 1000;
        return ++calls === 1 ? running : succeeded;
    });
    const before: CanvasNodeData = { id: "video-node", type: CanvasNodeType.Video, title: "镜头", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { status: "loading", taskId: running.id } };
    let nodes = [{ ...before, position: { x: 200, y: 100 } }];
    let submissions = 0;
    let consumptions = 0;
    const run = () =>
        runCanvasGenerationTaskToConsumer(
            { projectId: "saved-canvas", nodeId: before.id, mode: "video", prompt: "fixture", config: defaultConfig, clientOperationId: "long-video-operation" },
            {
                bindTask() {},
                async runTask(options) {
                    submissions += 1;
                    options.onTaskCreated?.(running);
                    await waitForGenerationTask(running.id, { intervalMs: 1, initialTask: running, onTaskUpdate: options.onTaskCreated });
                    return { video: { dataUrl: "/api/resources/video/file", storageKey: "resource:video" } };
                },
                async consumeTask(task) {
                    consumptions += 1;
                    const result = { ...before, metadata: { ...before.metadata, status: "success" as const, storageKey: JSON.parse(task.resultJson!).video.storageKey } };
                    nodes = commitCanvasGenerationResult(nodes, before, result, task.id);
                },
            },
        );
    await Promise.all([run(), run()]);
    expect(submissions).toBe(1);
    expect(consumptions).toBe(1);
    expect(nodes[0].metadata).toMatchObject({ status: "success", taskId: running.id, storageKey: "resource:video" });
    expect(nodes[0].position).toEqual({ x: 200, y: 100 });
});

test("six temporary status-query failures reconnect without failing the task", async () => {
    let calls = 0;
    queries(() => {
        if (++calls <= 6) throw new ApiError("network unavailable", { retryable: true });
        return succeeded;
    });
    expect(await waitForGenerationTask(running.id, { intervalMs: 1 })).toEqual(succeeded);
    expect(calls).toBe(7);
});

test("real backend failure is still published and rejected", async () => {
    const failed = { ...running, status: "failed" as const, error: "作品已生成，但保存未完成：登记作品失败" };
    queries(() => failed);
    const updates: GenerationTask[] = [];
    await expect(waitForGenerationTask(running.id, { onTaskUpdate: (task) => updates.push(task) })).rejects.toThrow("登记作品失败");
    expect(updates).toEqual([failed]);
});

test("explicit observer deadlines remain bounded", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    restores.push(() => clock.mockRestore());
    const spy = queries(() => {
        now = 2000;
        return running;
    });
    await expect(waitForGenerationTask(running.id, { timeoutMs: 1000, intervalMs: 1 })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
});

test("aborting the page observer stops retries without a cancel request", async () => {
    const controller = new AbortController();
    const spy = queries(() => {
        controller.abort();
        throw new ApiError("offline", { retryable: true });
    });
    await expect(waitForGenerationTask(running.id, { signal: controller.signal, intervalMs: 1 })).rejects.toMatchObject({ name: "AbortError" });
    expect(spy).toHaveBeenCalledTimes(1);
});

test("a permanent missing-task response is not retried forever", async () => {
    const spy = queries(() => {
        throw new ApiError("任务不存在", { status: 404 });
    });
    await expect(waitForGenerationTask(running.id, { intervalMs: 1 })).rejects.toThrow("任务不存在");
    expect(spy).toHaveBeenCalledTimes(1);
});

test("a response arriving after observer abort is not published or consumed", async () => {
    const controller = new AbortController();
    const updates: GenerationTask[] = [];
    queries(async () => {
        controller.abort();
        return succeeded;
    });
    await expect(waitForGenerationTask(running.id, { signal: controller.signal, onTaskUpdate: (task) => updates.push(task) })).rejects.toMatchObject({ name: "AbortError" });
    expect(updates).toEqual([]);
});

test("normal polling removes completed delay abort listeners", async () => {
    const controller = new AbortController();
    const add = spyOn(controller.signal, "addEventListener");
    const remove = spyOn(controller.signal, "removeEventListener");
    restores.push(
        () => add.mockRestore(),
        () => remove.mockRestore(),
    );
    let calls = 0;
    queries(() => (++calls < 4 ? running : succeeded));
    await waitForGenerationTask(running.id, { signal: controller.signal, intervalMs: 1 });
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
});

for (const outage of ["initial query", "wait channel"]) {
    test(`shared observation reconnects existing subscribers after a ${outage} outage`, async () => {
        let calls = 0;
        const warn = spyOn(console, "warn").mockImplementation(() => undefined);
        restores.push(() => warn.mockRestore());
        const service = createGenerationTaskSubscriptionService({
            async queryTask() {
                if (++calls === 1) {
                    if (outage === "initial query") throw new Error("temporary outage");
                    return running;
                }
                return succeeded;
            },
            async waitTask() {
                throw new Error("temporary outage");
            },
        });
        const updates: GenerationTask[] = [];
        const unsubscribe = service.subscribe([running.id], (task) => updates.push(task));
        try {
            await new Promise((resolve) => setTimeout(resolve, 2200));
            expect(updates.at(-1)).toEqual(succeeded);
            expect(calls).toBe(2);
        } finally {
            unsubscribe();
            await tick();
        }
    });
}

test("unsubscribe aborts the abandoned observer and drops its late updates", async () => {
    let signal: AbortSignal | undefined;
    let release!: (task: GenerationTask) => void;
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            return running;
        },
        async waitTask(_id, options) {
            signal = options?.signal;
            return new Promise<GenerationTask>((resolve) => {
                release = resolve;
            });
        },
    });
    const updates: GenerationTask[] = [];
    const unsubscribe = service.subscribe([running.id], (task) => updates.push(task));
    await tick();
    unsubscribe();
    await tick();
    release(succeeded);
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(updates).toEqual([running]);
});

test("a new subscription rechecks a previously failed task instead of replaying a stale terminal", async () => {
    let current: GenerationTask = { ...running, status: "failed" };
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            return current;
        },
        async waitTask() {
            return succeeded;
        },
    });
    const first = service.subscribe([running.id], () => undefined);
    await tick();
    current = running;
    const updates: GenerationTask[] = [];
    const second = service.subscribe([running.id], (task) => updates.push(task));
    await tick();
    first();
    second();
    await tick();
    expect(updates.map((task) => task.status)).toEqual(["running", "succeeded"]);
});

test("a subscriber added during terminal delivery also receives a fresh result", async () => {
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            return succeeded;
        },
        async waitTask() {
            return succeeded;
        },
    });
    const updates: GenerationTask[] = [];
    let second: (() => void) | undefined;
    const first = service.subscribe([running.id], () => {
        second ??= service.subscribe([running.id], (task) => updates.push(task));
    });
    await tick();
    first();
    second?.();
    await tick();
    expect(updates).toEqual([succeeded]);
});
