import { expect, test } from "bun:test";

import { applyCreationAgentTaskState, projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import { applyRecoveredCreationResult, attachCreationTaskContexts, reconcileCreationTaskMessages, type PersistedCreationTask } from "../src/pages/create/creation-conversations";

const at = "2026-10-17T10:00:00Z";
const runtime = { recoverCreationTextTask: () => null } as unknown as Parameters<typeof reconcileCreationTaskMessages>[0];

function agentConversation() {
    const session = { id: "session", title: "五张产品图", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
    const run = {
        id: "run",
        sessionId: session.id,
        canvasId: "",
        surface: "creation",
        userPrompt: "生成五张产品图",
        status: "completed",
        permissionMode: "auto",
        createdAt: at,
        updatedAt: at,
        events: Array.from({ length: 5 }, (_, index) => ({
            eventId: `event-${index}`,
            runId: "run",
            seq: index + 1,
            type: "generation_task_created",
            createdAt: at,
            payload: { taskId: `image-${index}`, mode: "image", title: `场景图 ${index + 1}`, imageBatchId: "five-images", imageBatchTotal: 5 },
        })),
    };
    return projectCreationAgentConversation(session, [run]);
}

function task(status: PersistedCreationTask["status"], extra: Partial<PersistedCreationTask> = {}): PersistedCreationTask {
    return { id: "image-0", type: "image", status, prompt: "场景图提示词", attempts: 1, createdAt: at, updatedAt: at, ...extra };
}

test("Agent 五图批次的单任务复核不会覆盖场景标题或把失败重新变成等待五张", () => {
    const failed = task("failed", { error: "图片生成等待超时，请稍后重试。" });
    const live = applyCreationAgentTaskState(agentConversation(), failed);
    const contextual = attachCreationTaskContexts([failed], [live]);
    expect(contextual[0].clientContext?.batchCount).toBe(1);

    const restored = reconcileCreationTaskMessages(runtime, [live], contextual)[0];
    expect(restored.messages.find((message) => message.id === "task-image-0")).toMatchObject({
        content: "场景图 1",
        status: "error",
        error: failed.error,
        batchId: "five-images",
        batchTotal: 5,
    });
    const repeated = reconcileCreationTaskMessages(runtime, [restored], contextual)[0];
    expect(repeated.messages.find((message) => message.id === "task-image-0")?.content).toBe("场景图 1");
});

test("Agent 单项资源消费只完成该交付，保留整套数量与标题并清除旧错误", () => {
    const message = agentConversation().messages.find((entry) => entry.id === "task-image-0")!;
    const completed = applyRecoveredCreationResult({ ...message, status: "error", error: "旧超时", generationErrorCode: "provider_request_failed" }, [], ["resource:image-0"], 1);
    expect(completed).toMatchObject({ content: "场景图 1", status: "done", batchTotal: 5, resultStorageKeys: ["resource:image-0"] });
    expect(completed.error).toBeUndefined();
    expect(completed.generationErrorCode).toBeUndefined();
});

test("Agent 单项任务的成功、重试中和取消复核不会继承旧失败错误", () => {
    for (const [status, expected] of [
        ["succeeded", "done"],
        ["running", "pending"],
        ["cancelled", "cancelled"],
    ] as const) {
        const cached = applyCreationAgentTaskState(agentConversation(), task("failed", { error: "旧超时" }));
        const observed = task(status, status === "succeeded" ? { creationResultStorageKeys: ["resource:image-0"] } : {});
        const restored = reconcileCreationTaskMessages(runtime, [cached], attachCreationTaskContexts([observed], [cached]))[0];
        const message = restored.messages.find((entry) => entry.id === "task-image-0")!;
        expect(message).toMatchObject({ content: "场景图 1", status: expected, batchTotal: 5 });
        expect(message.error).toBeUndefined();
        expect(message.generationErrorCode).toBeUndefined();
    }
});

test("Agent 成功任务尚无可读结果时明确报错，不假装仍在等待整个批次", () => {
    const cached = agentConversation();
    const restored = reconcileCreationTaskMessages(runtime, [cached], attachCreationTaskContexts([task("succeeded")], [cached]))[0];
    expect(restored.messages.find((entry) => entry.id === "task-image-0")).toMatchObject({
        content: "场景图 1",
        status: "error",
        batchTotal: 5,
        error: "任务已结束，但生成结果暂时无法读取",
    });
});
