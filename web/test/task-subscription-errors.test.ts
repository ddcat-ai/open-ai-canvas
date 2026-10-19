import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ApiError } from "../src/services/api/request";
import { createGenerationTaskSubscriptionService, type GenerationTask } from "../src/services/api/task-center";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const running: GenerationTask = { id: "original-task", type: "image", status: "running", prompt: "fixture", attempts: 1, createdAt: "2026-10-17", updatedAt: "2026-10-17" };
const succeeded: GenerationTask = { ...running, status: "succeeded" };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let scope: string;
let stops: Array<() => void>;
let restoreWarning: () => void;

beforeEach(() => {
    scope = "first-user";
    stops = [];
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    restoreWarning = () => warning.mockRestore();
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: { getItem: () => scope } }) });
});

afterEach(async () => {
    for (const stop of stops) stop();
    await tick();
    restoreWarning();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

for (const stage of ["query", "wait"] as const) {
    test(`${stage} observation errors reach subscribers and reconnect the original task`, async () => {
        const error = new ApiError("任务状态暂不可读", { status: stage === "query" ? 404 : 503 });
        let queries = 0;
        const service = createGenerationTaskSubscriptionService({
            async queryTask(id) {
                expect(id).toBe(running.id);
                if (++queries > 1) return succeeded;
                if (stage === "query") throw error;
                return running;
            },
            async waitTask() {
                throw error;
            },
        });
        const updates: GenerationTask[] = [];
        const errors: unknown[][] = [];
        stops.push(
            service.subscribe(
                [running.id],
                (task) => updates.push(task),
                (id, cause) => errors.push([id, cause]),
            ),
        );
        await tick();
        expect(errors).toEqual([[running.id, error]]);
        expect(updates.some((task) => task.status === "failed")).toBe(false);
        window.dispatchEvent(new Event("online"));
        await tick();
        expect(queries).toBe(2);
        expect(updates.at(-1)).toEqual(succeeded);
        expect(errors).toHaveLength(1);
    });
}

test("unsubscribing one shared observer removes only its own error callback", async () => {
    let rejectQuery!: (error: Error) => void;
    const service = createGenerationTaskSubscriptionService({
        queryTask: () =>
            new Promise<GenerationTask>((_resolve, reject) => {
                rejectQuery = reject;
            }),
        async waitTask() {
            return succeeded;
        },
    });
    const errors: unknown[][] = [];
    const onError = (id: string, error: unknown) => errors.push([id, error]);
    const stopFirst = service.subscribe([running.id], () => {}, onError);
    stops.push(
        stopFirst,
        service.subscribe([running.id], () => {}, onError),
    );
    stopFirst();
    const error = new Error("connection lost");
    rejectQuery(error);
    await tick();
    expect(errors).toEqual([[running.id, error]]);
});

for (const reason of ["unsubscribed", "account switched", "aborted"] as const) {
    test(`late observation errors are ignored after ${reason}`, async () => {
        let rejectQuery!: (error: Error) => void;
        const service = createGenerationTaskSubscriptionService({
            queryTask: () =>
                new Promise<GenerationTask>((_resolve, reject) => {
                    rejectQuery = reject;
                }),
            async waitTask() {
                return succeeded;
            },
        });
        const errors: unknown[][] = [];
        const stop = service.subscribe(
            [running.id],
            () => {},
            (id, error) => errors.push([id, error]),
        );
        stops.push(stop);
        if (reason === "unsubscribed") stop();
        if (reason === "account switched") scope = "second-user";
        rejectQuery(reason === "aborted" ? new DOMException("Aborted", "AbortError") : new Error("late network error"));
        await tick();
        expect(errors).toEqual([]);
    });
}

for (const status of ["failed", "cancelled"] as const) {
    test(`a confirmed ${status} task is a task result, not a synchronization error`, async () => {
        const terminal = { ...running, status, error: "模型任务结束" };
        const service = createGenerationTaskSubscriptionService({
            async queryTask() {
                return running;
            },
            async waitTask(_id, options) {
                options?.onTaskUpdate?.(terminal);
                throw new Error(terminal.error);
            },
        });
        const updates: GenerationTask[] = [];
        const errors: unknown[][] = [];
        stops.push(
            service.subscribe(
                [running.id],
                (task) => updates.push(task),
                (id, error) => errors.push([id, error]),
            ),
        );
        await tick();
        expect(updates).toEqual([running, terminal]);
        expect(errors).toEqual([]);
    });
}
