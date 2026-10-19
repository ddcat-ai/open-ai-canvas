import { expect, test } from "bun:test";

import * as recovery from "../src/pages/create/creation-conversations";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";
import type { GenerationTask } from "../src/services/api/task-center";

const timestamp = "2026-10-01T00:00:00Z";
const message: CreationMessage = { id: "result", role: "assistant", mode: "video", status: "error", content: "生成失败", error: "状态同步中断", generationErrorCode: "network_error", createdAt: timestamp, taskIds: ["original"] };
const conversation = (item = message): CreationConversation => ({ id: "conversation", title: "原创作", updatedAt: timestamp, messages: [{ id: "prompt", role: "user", mode: item.mode, content: "原创作提示词", createdAt: timestamp }, item] });
const task = (status: GenerationTask["status"], extra: Partial<recovery.PersistedCreationTask> = {}): recovery.PersistedCreationTask => ({
    id: "original",
    type: "canvas_video",
    status,
    prompt: "原创作提示词",
    attempts: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...extra,
});
const runtime = { recoverCreationTextTask: () => null } as unknown as Parameters<typeof recovery.reconcileCreationTaskMessages>[0];

test("历史误报失败的视频只在原任务物化成功后恢复，并清除旧错误", () => {
    const current = [conversation()];
    const succeeded = task("succeeded", { creationResultStorageKeys: ["resource:video"] });
    const next = recovery.reconcileCreationTaskMessages(runtime, current, [succeeded]);
    expect(next[0].messages[1]).toMatchObject({ status: "done", content: "视频已生成", resultStorageKeys: ["resource:video"], taskIds: ["original"] });
    expect(next[0].messages[1].error).toBeUndefined();
    expect(next[0].messages[1].generationErrorCode).toBeUndefined();
    const raw = recovery.reconcileCreationTaskMessages(runtime, current, [task("succeeded", { resultJson: '{"video":{"url":"https://provider.invalid/raw.mp4"}}' })]);
    expect(raw[0].messages[1].status).toBe("pending");
    expect(raw[0].messages[1].resultUrls).toEqual([]);
});

test("物化暂不可用不记生成失败，原任务恢复后仍补回结果", () => {
    const pending = conversation({ ...message, mode: "image", status: "pending", content: "", batchTotal: 1 });
    const interrupted = recovery.reconcileCreationTaskMessages(runtime, [pending], [task("succeeded", { type: "canvas_image", creationError: "资源暂不可用" })]);
    expect(interrupted[0].messages[1].status).toBe("pending");
    expect(interrupted[0].messages[1].batchFailedCount).toBe(0);
    const completed = recovery.reconcileCreationTaskMessages(runtime, interrupted, [task("succeeded", { type: "canvas_image", creationResultStorageKeys: ["resource:image"] })]);
    expect(completed[0].messages[1]).toMatchObject({ status: "done", resultStorageKeys: ["resource:image"], batchFailedCount: 0 });
});

test("任务仍执行时误报失败恢复为等待，真实失败保持失败，主动取消不被成功回放复活", () => {
    const running = recovery.reconcileCreationTaskMessages(runtime, [conversation()], [task("running")]);
    expect(running[0].messages[1].status).toBe("pending");
    expect(running[0].messages[1].error).toBeUndefined();
    const failed = recovery.reconcileCreationTaskMessages(runtime, [conversation()], [task("failed", { error: "上游生成失败" })]);
    expect(failed[0].messages[1]).toMatchObject({ status: "error", error: "上游生成失败" });
    const cancelled = conversation({ ...message, status: "cancelled", content: "已停止" });
    expect(recovery.reconcileCreationTaskMessages(runtime, [cancelled], [task("succeeded", { creationResultStorageKeys: ["resource:late"] })])[0].messages[1]).toBe(cancelled.messages[1]);
    expect(recovery.applyRecoveredCreationResult(cancelled.messages[1], [], ["resource:late"], 1)).toBe(cancelled.messages[1]);
});

test("重试任务沿原消息精确归属恢复，旧失败尝试不重复计数", () => {
    const current = conversation({ ...message, mode: "image", batchTotal: 1, batchFailedCount: 1 });
    const retry = task("succeeded", { id: "retry", retryOf: "original", attemptGroupId: "original", type: "canvas_image", creationResultStorageKeys: ["resource:retry"] });
    const contextual = recovery.attachCreationTaskContexts([retry], [current]);
    expect(contextual[0].clientContext).toMatchObject({ conversationId: current.id, messageId: message.id, batchIndex: 0, batchCount: 1 });
    const next = recovery.reconcileCreationTaskMessages(runtime, [current], [task("failed", { type: "canvas_image" }), ...contextual]);
    expect(next[0].messages[1]).toMatchObject({ status: "done", resultStorageKeys: ["resource:retry"], batchFailedCount: 0, taskIds: ["original", "retry"] });
    const unrelated = task("succeeded", { id: "unrelated", clientContext: { conversationId: current.id, messageId: "another-message" }, creationResultStorageKeys: ["resource:wrong"] });
    expect(recovery.reconcileCreationTaskMessages(runtime, [current], [unrelated])).toEqual([current]);
});

test("卸载只结束观察，已创建任务保持等待；主动停止与真实失败保持各自状态", () => {
    const pending = { ...message, status: "pending" as const, content: "" };
    const options = { cancelled: true, unmounted: true, boundTaskCount: 1 };
    expect(recovery.projectCreationTaskWaitFailure(pending, new DOMException("Aborted", "AbortError"), options)).toBe(pending);
    expect(recovery.projectCreationTaskWaitFailure(pending, new DOMException("Aborted", "AbortError"), { ...options, unmounted: false })).toMatchObject({ status: "cancelled", content: "已停止" });
    expect(recovery.projectCreationTaskWaitFailure(pending, new Error("真实生成失败"), { ...options, cancelled: false, unmounted: false })).toMatchObject({ status: "error", error: "真实生成失败" });
    const batch = { ...pending, mode: "image" as const, batchTotal: 2 };
    expect(recovery.projectCreationTaskWaitFailure(batch, new DOMException("Aborted", "AbortError"), { ...options, batchSubmission: true, batchTotal: 2 })).toBe(batch);
});

function refreshRuntime(current: GenerationTask | Error) {
    const reads: string[] = [];
    let materializations = 0;
    const stub = {
        ...runtime,
        queryGenerationTask: async (id: string) => {
            reads.push(id);
            if (current instanceof Error) throw current;
            return current;
        },
        runGenerationConsumer: async (_signal: AbortSignal | undefined, operation: (signal: AbortSignal) => unknown) => operation(new AbortController().signal),
        materializeGenerationTaskAssets: async (value: GenerationTask) => {
            materializations += 1;
            return value;
        },
        generationTaskMaterializedUrls: () => [],
        generationTaskMaterializedStorageKeys: () => ["resource:finished"],
    } as unknown as Parameters<typeof recovery.refreshCreationMessageTasks>[0];
    return { stub, reads, materializations: () => materializations };
}

test("重新生成前精确复核原任务：已成功只恢复，执行中继续等待，真实失败才允许重试", async () => {
    for (const status of ["succeeded", "running", "failed", "cancelled"] as const) {
        const fixture = refreshRuntime(task(status));
        const refreshed = await recovery.refreshCreationMessageTasks(fixture.stub, conversation(), message);
        expect(fixture.reads).toEqual(["original"]);
        expect(refreshed.canRetry).toBe(status === "failed" || status === "cancelled");
        if (status === "succeeded") {
            expect(fixture.materializations()).toBe(1);
            expect(refreshed.conversation.messages[1]).toMatchObject({ status: "done", resultStorageKeys: ["resource:finished"] });
        } else expect(fixture.materializations()).toBe(0);
    }
});

test("重新生成复核暂不可用或观察已中止时不放行重试，保存失败的成品不重复生成", async () => {
    const unavailable = refreshRuntime(new Error("查询暂不可用"));
    await expect(recovery.refreshCreationMessageTasks(unavailable.stub, conversation(), message)).rejects.toThrow("查询暂不可用");
    expect(unavailable.materializations()).toBe(0);
    const generated = refreshRuntime(task("failed", { canRecoverMedia: true }));
    expect((await recovery.refreshCreationMessageTasks(generated.stub, conversation(), message)).canRetry).toBe(false);
    const controller = new AbortController();
    controller.abort();
    const aborted = refreshRuntime(task("running"));
    await expect(recovery.refreshCreationMessageTasks(aborted.stub, conversation(), message, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted.reads).toEqual([]);
});

test("批量重试复核后仅返回真实失败项，成功、进行中、停止与可恢复产物都不重复提交", async () => {
    const tasks = [task("failed", { id: "failed" }), task("succeeded", { id: "done" }), task("running", { id: "running" }), task("cancelled", { id: "stopped" }), task("failed", { id: "recoverable", canRecoverMedia: true })];
    const fixture = refreshRuntime(tasks[0]);
    fixture.stub.queryGenerationTask = async (id) => {
        fixture.reads.push(id);
        return tasks.find((item) => item.id === id)!;
    };
    const batch = { ...message, mode: "image" as const, taskIds: [...tasks.map((item) => item.id), "failed"], batchTotal: tasks.length };
    const refreshed = await recovery.refreshCreationMessageTasks(fixture.stub, conversation(batch), batch);
    expect(fixture.reads).toEqual(tasks.map((item) => item.id));
    expect(refreshed.retryableTaskIds).toEqual(["failed"]);
    expect(refreshed.canRetry).toBe(true);
    expect(fixture.materializations()).toBe(1);
    expect(refreshed.conversation.messages[1].resultStorageKeys).toContain("resource:finished");
});
