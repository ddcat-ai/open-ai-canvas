import { expect, test } from "bun:test";
import { recoverCreationGenerationSubmission, reconcileCreationTaskMessages, refreshCreationMessageTasks } from "../src/pages/create/creation-conversations";
import { createGenerationSubmissionStore } from "../src/services/generation-submission";
import { ApiError } from "../src/services/api/request";
import type { GenerationTask } from "../src/services/api/task-center";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";

const at = "2026-10-19T10:05:00Z";
const originalMessage = (mode: "image" | "video", count: number): CreationMessage => ({
    id: "assistant",
    role: "assistant",
    mode,
    content: "",
    status: "pending",
    submissionPending: true,
    clientOperationId: "original",
    createdAt: at,
    settings: { count: String(count), ratio: "1:1", seconds: "5", quality: "auto", videoQuality: "720P" },
});
function fixture(mode: "image" | "video", count: number) {
    let message = originalMessage(mode, count);
    const saved = new Map<string, string>(),
        tasks = new Map<string, GenerationTask>(),
        queries: string[] = [];
    const store = createGenerationSubmissionStore({
        getScope: () => "user",
        getStorage: () => ({
            getItem: async (key) => saved.get(key) || null,
            setItem: async (key, value) => {
                saved.set(key, value);
            },
            removeItem: async (key) => {
                saved.delete(key);
            },
        }),
        findTask: async (key) => {
            queries.push(key);
            return tasks.get(key) || null;
        },
    });
    for (let index = 0; index < count; index++) {
        const key = mode === "image" ? `original:batch:${index}` : "original";
        tasks.set(key, {
            id: `task-${index}`,
            type: `canvas_${mode}`,
            status: "failed",
            prompt: "original",
            attempts: 1,
            createdAt: at,
            updatedAt: at,
            error: "上游暂时不可用",
            clientContext: { conversationId: "conversation", messageId: "assistant", batchCount: count, batchIndex: index },
        });
    }
    const runtime = {
        recoverGenerationSubmission: store.recover,
        hasPendingGenerationSubmission: store.hasPending,
        queryGenerationTask: async (id: string) => {
            queries.push(id);
            const task = [...tasks.values()].find((item) => item.id === id);
            if (!task) throw new ApiError("任务不存在", { status: 404 });
            return task;
        },
        recoverCreationTextTask: () => null,
    } as unknown as Parameters<typeof recoverCreationGenerationSubmission>[0];
    return {
        store,
        tasks,
        queries,
        runtime,
        get message() {
            return message;
        },
        set message(value: CreationMessage) {
            message = value;
        },
        recover: () =>
            recoverCreationGenerationSubmission(runtime, "conversation", message, async (update) => {
                message = update(message);
            }),
    };
}

test.each(["image", "video"] as const)("%s 跨浏览器查询原任务恢复已失败消息，不依赖本地提交索引", async (mode) => {
    const f = fixture(mode, mode === "image" ? 10 : 1);
    await f.recover();
    expect(f.message.submissionPending).toBeUndefined();
    expect(f.message.status).toBe("error");
    expect(f.message.taskIds).toHaveLength(mode === "image" ? 10 : 1);
    expect(f.queries).toEqual([...f.tasks.keys()]);
});

test("历史已保存完整任务 ID 时直接复核任务，不要求请求索引仍在", async () => {
    const f = fixture("image", 2);
    f.message = { ...f.message, taskIds: ["task-0", "task-1"] };
    await f.recover();
    expect(f.queries).toEqual(["task-0", "task-1"]);
    expect(f.message).toMatchObject({ status: "error", taskIds: ["task-0", "task-1"] });
    expect(f.message.submissionPending).toBeUndefined();
});

test("原批次尚有任务未查到时保留已确认任务和待确认状态", async () => {
    const f = fixture("image", 2);
    f.tasks.delete("original:batch:1");
    await expect(f.recover()).rejects.toThrow("提交状态待确认");
    expect(f.message).toMatchObject({ status: "pending", submissionPending: true, taskIds: ["task-0"] });
});

test("历史轮询已看到完整批次时清除旧 submissionPending，真实失败可以重试", () => {
    const f = fixture("image", 10);
    const conversation: CreationConversation = { id: "conversation", title: "", updatedAt: at, messages: [f.message] };
    const result = reconcileCreationTaskMessages(f.runtime, [conversation], [...f.tasks.values()])[0].messages[0];
    expect(result).toMatchObject({ status: "error", batchFailedCount: 10 });
    expect(result.submissionPending).toBeUndefined();
});

test("轮询只看到部分批次时不能把待确认误判成全部受理", () => {
    const f = fixture("image", 10);
    const conversation: CreationConversation = { id: "conversation", title: "", updatedAt: at, messages: [f.message] };
    const result = reconcileCreationTaskMessages(f.runtime, [conversation], [[...f.tasks.values()][0]])[0].messages[0];
    expect(result).toMatchObject({ status: "pending", submissionPending: true });
});

test("原请求明确拒绝而没有任务时恢复为失败，不能留下空白生成中", async () => {
    const f = fixture("video", 1);
    await f.store.prepare("original", ["original"]);
    await expect(
        f.store.submit("original", "original", async () => {
            throw new ApiError("余额不足", { status: 400 });
        }),
    ).rejects.toThrow();
    await expect(f.recover()).rejects.toMatchObject({ reason: "generation_submission_rejected" });
    expect(f.message.status).toBe("error");
    expect(f.message.submissionPending).toBeUndefined();
});

test("混合批次复核原状态后仅返回已经结算的明确失败任务", async () => {
    const f = fixture("image", 10);
    const states: Array<Partial<GenerationTask>> = [
        { status: "running" },
        { status: "succeeded" },
        { status: "failed", billing: { status: "refunded", amountMicrocredits: 0 } },
        { status: "failed", stage: "submission_unknown" },
        { status: "failed", providerCancelStatus: "requested" },
        { status: "failed", providerCancelStatus: "uncertain" },
        { status: "failed", billing: { status: "uncertain", amountMicrocredits: 1 } },
        { status: "failed", canRecoverMedia: true },
        { status: "failed", stage: "任务失败", billing: { status: "refunded", amountMicrocredits: 0 }, diagnostic: { submissionOutcome: "unknown" } },
        { status: "failed", stage: "任务失败", billing: { status: "refunded", amountMicrocredits: 0 }, diagnostic: { retryClass: "reconcile_submission" } },
    ];
    [...f.tasks.entries()].forEach(([key, task], index) => {
        f.tasks.set(key, { ...task, ...states[index] });
    });
    const message = { ...f.message, submissionPending: undefined, taskIds: [...f.tasks.values()].map((item) => item.id) };
    const conversation: CreationConversation = { id: "conversation", title: "", updatedAt: at, messages: [message] };
    const result = await refreshCreationMessageTasks(f.runtime, conversation, message);
    expect(result.canRetry).toBe(true);
    expect(result.retryableTaskIds).toEqual(["task-2"]);
    expect(f.queries).toEqual(message.taskIds);
});

test("同一原任务的多个重试尝试不能冒充整批提交回执", () => {
    const f = fixture("image", 2);
    const source = [...f.tasks.values()][0];
    const attempts = [source, { ...source, id: "retry-first", retryOf: source.id }, { ...source, id: "retry-second", retryOf: source.id }];
    const conversation: CreationConversation = { id: "conversation", title: "", updatedAt: at, messages: [f.message] };
    const result = reconcileCreationTaskMessages(f.runtime, [conversation], attempts)[0].messages[0];
    expect(result).toMatchObject({ status: "pending", submissionPending: true, batchFailedCount: 1 });
});

test("原任务晚到的观察不会盖掉同时间戳的重试成功", () => {
    const f = fixture("image", 1);
    const source = [...f.tasks.values()][0];
    const retry = { ...source, id: "retry", retryOf: source.id, status: "succeeded" as const, creationResultStorageKeys: ["resource:result"] };
    const conversation: CreationConversation = { id: "conversation", title: "", updatedAt: at, messages: [f.message] };
    const result = reconcileCreationTaskMessages(f.runtime, [conversation], [retry, source])[0].messages[0];
    expect(result).toMatchObject({ status: "done", resultStorageKeys: ["resource:result"] });
    expect(result.submissionPending).toBeUndefined();
});
