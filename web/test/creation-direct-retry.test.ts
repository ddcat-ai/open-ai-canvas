import { expect, test } from "bun:test";
import { generationErrorMessage } from "../src/lib/generation-error";
import { createGenerationBatchRetryContexts, createGenerationRetryContext } from "../src/lib/canvas/canvas-project-generation";
import { refreshCreationMessageTasks } from "../src/pages/create/creation-conversations";
import { creationHasInput, type CreationConversation, type CreationMessage, type CreationRetryContext } from "../src/pages/create/creation-types";
import type { GenerationTask } from "../src/services/api/task-center";
import * as agentConversation from "../src/pages/create/creation-agent-conversation";
import type { AgentRun } from "../src/services/api/agent";
import { ApiError } from "../src/services/api/request";

// Execute the page's actual retry, draft restoration and variant handlers with HTTP isolated.
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const start = source.indexOf("    const restoreMessageDraft = (");
const end = source.indexOf("\n    useCreationHomeNavigation(", start);
if (start < 0 || end < 0) throw new Error("creation retry handlers missing");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
const timestamp = "2026-10-19T10:05:00Z";

function harness(
    mode: "image" | "video",
    tasks: GenerationTask[] = [],
    agentRunId?: string,
    options: { missingRunId?: boolean; missingTaskIds?: boolean; runStatus?: AgentRun["status"]; noRunMatch?: boolean; agentReply?: boolean; agentAdmission?: "rejected" | "unknown"; attachmentOnly?: boolean; pendingSubmission?: boolean } = {},
) {
    const settings = { ratio: "9:16", seconds: "15", quality: "high", videoQuality: "768", count: String(tasks.length || 1), imageResolution: "2k", imageParameters: '{"seed":7}', transparentBackground: "true" };
    const user: CreationMessage = {
        id: "user",
        role: "user",
        mode,
        content: "原提示词 @参考图",
        createdAt: timestamp,
        model: `${mode}-original`,
        settings,
        attachments: [{ id: "reference", name: "参考图", dataUrl: "https://fixture.invalid/reference.png", previewUrl: "https://fixture.invalid/reference.png", type: "image/png", storageKey: "resource:reference" }],
    };
    if (options.attachmentOnly) {
        user.mode = "agent";
        user.content = "";
    }
    const item: CreationMessage = {
        id: options.missingRunId ? `task-${tasks[0]?.id}` : "result",
        role: "assistant",
        mode,
        status: "error",
        content: "生成失败",
        error: "网络异常",
        createdAt: timestamp,
        clientOperationId: "original-operation",
        ...(tasks.length ? { taskIds: tasks.map((task) => task.id) } : {}),
        ...(agentRunId && !options.missingRunId ? { agentRunId } : {}),
    };
    if (options.missingTaskIds) delete item.taskIds;
    if (options.agentReply) {
        item.id = `${agentRunId}:assistant`;
        item.mode = "agent";
        item.agentIdempotencyKey = "accepted-key";
        delete item.agentRunId;
        delete item.taskIds;
    }
    // A persisted mixed-mode conversation can have a server session without this message being an Agent run.
    let conversation: CreationConversation = JSON.parse(JSON.stringify({ id: "conversation", agentSessionId: "server-session", title: "原创作", updatedAt: timestamp, messages: [user, item] }));
    if (options.agentAdmission) {
        conversation = agentConversation.beginCreationAgentSubmission({ ...conversation, messages: [] }, { id: "agent-submission-conversation", prompt: user.content, createdAt: timestamp, attachments: user.attachments, model: "text-original" });
        conversation = agentConversation.bindCreationAgentSubmission(conversation, "agent-submission-conversation", "server-session", "request-key");
        conversation = JSON.parse(JSON.stringify(agentConversation.failCreationAgentSubmission(conversation, "agent-submission-conversation", "请求失败", options.agentAdmission === "rejected" ? "request-key" : undefined)));
    }
    const notices: string[] = [],
        queries: string[] = [],
        agentCalls: unknown[][] = [];
    let sessionReads = 0;
    const draft: Record<string, unknown> = {};
    let retrySequence = 0;
    const pendingRetryRef: { current: { context?: CreationRetryContext; lockKey: string } | null } = { current: null };
    const runtime = {
        queryGenerationTask: async (id: string) => {
            queries.push(id);
            return tasks.find((task) => task.id === id)!;
        },
        runGenerationConsumer: async (_signal: AbortSignal | undefined, run: (signal: AbortSignal) => unknown) => run(new AbortController().signal),
        materializeGenerationTaskAssets: async (task: GenerationTask) => task,
        generationTaskMaterializedUrls: () => ["https://fixture.invalid/done.png"],
        generationTaskMaterializedStorageKeys: () => ["resource:done"],
        createGenerationRetryContext,
        createGenerationBatchRetryContexts,
    };
    const scope = {
        creationHasInput,
        activeConversation: conversation,
        busy: false,
        activeIdRef: { current: conversation.id },
        retryPreparingRef: { current: new Set<string>() },
        pendingRetryRef,
        followLatestMessageRef: { current: false },
        attachmentsRef: { current: [] },
        loadCreationRuntime: async () => runtime,
        getActiveUserScope: () => "owner",
        refreshCreationMessageTasks,
        generationErrorMessage,
        ApiError,
        recoverCreationGenerationSubmission: async () => {
            queries.push("operation:original-operation");
            throw new ApiError("原请求已明确拒绝", { reason: "generation_submission_rejected", status: 400 });
        },
        loadPendingCreationAgentSubmission: async () => (options.pendingSubmission ? { key: "request-key" } : null),
        creationAgentRecoveryClient: {},
        creationAgentRetryRun: agentConversation.creationAgentRetryRun,
        restoreCreationAgentConversation: async (sessionId: string) => {
            expect(sessionId).toBe("server-session");
            sessionReads += 1;
            const run: AgentRun = {
                id: agentRunId || "unrelated-newest",
                sessionId,
                surface: "creation",
                canvasId: "",
                permissionMode: "auto",
                status: options.runStatus || "failed",
                createdAt: timestamp,
                updatedAt: timestamp,
                events: options.noRunMatch ? [] : tasks.map((task, index) => ({ runId: agentRunId || "unrelated-newest", seq: index + 1, type: "generation_task_created", payload: { taskId: task.id }, createdAt: timestamp })),
            };
            return { ...conversation, agentRuns: [run], agentRunId: run.id };
        },
        toast: { error: (text: string) => notices.push(text), info: (text: string) => notices.push(text) },
        updateActive: (update: (current: CreationConversation) => CreationConversation) => {
            conversation = update(conversation);
        },
        updateConversationMessage: async (_id: string, id: string, update: (message: CreationMessage) => CreationMessage) => {
            conversation = { ...conversation, messages: conversation.messages.map((message) => (message.id === id ? update(message) : message)) };
        },
        updateConversation: (_id: string, update: (current: CreationConversation) => CreationConversation) => {
            conversation = update(conversation);
        },
        mergeCreationAgentConversation: (_current: CreationConversation, incoming: CreationConversation) => incoming,
        submitCreationAgent: async (...args: unknown[]) => {
            agentCalls.push(args);
        },
        setRetrySequence: (update: (value: number) => number) => {
            retrySequence = update(retrySequence);
        },
        selectMode: (value: string) => {
            draft.mode = value;
        },
        setPrompt: (value: string) => {
            draft.prompt = value;
        },
        setAttachments: (value: unknown) => {
            draft.attachments = value;
        },
        setDraftReferences: (value: unknown) => {
            draft.references = value;
        },
        updateConfig: (_key: string, value: string) => {
            draft.model = value;
        },
        setRatio: (value: string) => {
            draft.ratio = value;
        },
        setSeconds: (value: string) => {
            draft.seconds = value;
        },
        setQuality: (value: string) => {
            draft.quality = value;
        },
        setVideoQuality: (value: string) => {
            draft.videoQuality = value;
        },
        setCount: (value: string) => {
            draft.count = value;
        },
        setImageResolution: (value: string) => {
            draft.imageResolution = value;
        },
        setImageParameters: (value: string) => {
            draft.imageParameters = value;
        },
        rememberImageSettings: (value: unknown) => {
            draft.imagePreferences = value;
        },
        rememberVideoSettings: (value: unknown) => {
            draft.videoPreferences = value;
        },
        window: { requestAnimationFrame: (callback: () => void) => callback() },
        composerFocusRef: { current: null },
    };
    const handlers = new Function(...Object.keys(scope), `${code}\nreturn { retryFailedMessage, createVariant };`)(...Object.values(scope));
    return {
        item: conversation.messages[1],
        user,
        draft,
        notices,
        queries,
        agentCalls,
        pendingRetryRef,
        get conversation() {
            return conversation;
        },
        get retrySequence() {
            return retrySequence;
        },
        get sessionReads() {
            return sessionReads;
        },
        retry: () => handlers.retryFailedMessage(conversation.messages[1] || item, 1),
        variant: () => handlers.createVariant(item, 1),
    };
}

const task = (id: string, status: GenerationTask["status"], extra: Partial<GenerationTask> = {}): GenerationTask => ({ id, type: "canvas_image", status, prompt: "原提示词", attempts: 1, createdAt: timestamp, updatedAt: timestamp, ...extra });

test.each(["image", "video"] as const)("服务端同步过的普通 %s 失败，刷新后沿原任务直接重试并恢复原模型和规格", async (mode) => {
    const page = harness(mode, [task("failed", "failed")]);
    await page.retry();
    expect(page.notices).toEqual([]);
    expect(page.agentCalls).toEqual([]);
    expect(page.queries).toEqual(["failed"]);
    expect(page.retrySequence).toBe(1);
    expect(page.pendingRetryRef.current?.context).toMatchObject({ retryOf: "failed", attemptGroupId: "failed", clientOperationId: expect.stringContaining("retry:") });
    expect(page.draft).toMatchObject({ mode, prompt: page.user.content, model: `${mode}-original`, ratio: "9:16", seconds: "15", quality: "high", videoQuality: "768" });
    expect(page.draft.attachments).toEqual(page.user.attachments);
});

test.each(["image", "video"] as const)("普通 %s 创建已明确拒绝且没有任务 ID，重新生成按钮直接重新提交，不要求再点发送", async (mode) => {
    const page = harness(mode);
    await page.retry();
    expect(page.notices).toEqual([]);
    expect(page.agentCalls).toEqual([]);
    expect(page.retrySequence).toBe(1);
    expect(page.pendingRetryRef.current?.context).toBeUndefined();
    expect(page.pendingRetryRef.current?.lockKey).toBe("message:result");
    expect(page.draft.mode).toBe(mode);
});

test.each(["succeeded", "running"] as const)("普通失败卡片对应的原任务实际 %s 时只同步原任务，不创建重试", async (status) => {
    const page = harness("image", [task("original", status)]);
    await page.retry();
    expect(page.queries).toEqual(["original"]);
    expect(page.agentCalls).toEqual([]);
    expect(page.retrySequence).toBe(0);
    expect(page.pendingRetryRef.current).toBeNull();
    expect(page.conversation.messages).toHaveLength(2);
    expect(page.conversation.messages[1].status).toBe(status === "succeeded" ? "done" : "pending");
});

test("普通批量只重试安全失败项并保留原批次成功和运行中内容", async () => {
    const page = harness("image", [task("failed", "failed"), task("running", "running"), task("done", "succeeded")]);
    await page.retry();
    expect(page.queries).toEqual(["failed", "running", "done"]);
    expect(page.retrySequence).toBe(1);
    expect(page.pendingRetryRef.current?.context?.retryOf).toBe("failed");
    expect(page.draft.count).toBe("1");
    expect(page.conversation.messages).toHaveLength(2);
    expect(page.conversation.messages[1].resultStorageKeys).toEqual(["resource:done"]);
});

test("Agent 交付消息丢失 runId 时查询原 session，用 taskId 找回原轮次", async () => {
    const page = harness("image", [task("failed", "failed")], "original-run", { missingRunId: true });
    await page.retry();
    expect(page.sessionReads).toBe(1);
    expect(page.agentCalls[0]?.[3]).toEqual({ retry: { runId: "original-run", taskId: "failed" } });
    expect(page.retrySequence).toBe(0);
});

test("task 消息只剩稳定 ID 时仍只重试该任务，不扩大为同轮其他失败交付", async () => {
    const page = harness("image", [task("first", "failed"), task("sibling", "failed")], "original-run", { missingRunId: true, missingTaskIds: true });
    await page.retry();
    expect(page.sessionReads).toBe(1);
    expect(page.queries).toEqual(["first"]);
    expect(page.agentCalls[0]?.[3]).toEqual({ retry: { runId: "original-run", taskId: "first" } });
});

test("Agent 明确拒绝且无 run 时恢复原输入与文本模型，让用户核对当前预算后重新发送", async () => {
    const page = harness("image", [], undefined, { agentAdmission: "rejected" });
    await page.retry();
    expect(page.draft).toMatchObject({ mode: "agent", prompt: page.user.content, model: "text-original" });
    expect(page.draft.attachments).toEqual(page.user.attachments);
    expect(page.agentCalls).toEqual([]);
    expect(page.notices.join(" ")).toContain("确认");
    expect(page.notices.join(" ")).not.toContain("未找到");
});

test("纯附件 Agent 明确拒绝后能恢复原附件草稿，未知回执则核对原请求", async () => {
    const rejected = harness("image", [], undefined, { agentAdmission: "rejected", attachmentOnly: true });
    await rejected.retry();
    expect(rejected.draft).toMatchObject({ mode: "agent", prompt: "", attachments: rejected.user.attachments });
    const pending = harness("image", [], undefined, { agentAdmission: "unknown", attachmentOnly: true, pendingSubmission: true });
    await pending.retry();
    expect(pending.agentCalls[0]?.[0]).toBe("");
    expect(pending.agentCalls[0]?.[3]).toEqual({ recoverPending: true });
    expect(pending.draft).toEqual({});
});

test("Agent 未知提交即便本机索引丢失且服务端暂查不到，也不恢复成可直接重发的请求", async () => {
    const page = harness("image", [], undefined, { agentAdmission: "unknown", noRunMatch: true });
    await page.retry();
    expect(page.sessionReads).toBe(1);
    expect(page.draft).toEqual({});
    expect(page.agentCalls).toEqual([]);
    expect(page.retrySequence).toBe(0);
});

test.each(["running", "waiting_approval", "queued"] as const)("原 Agent 轮次实际 %s，刷新状态后等待，不创建新轮次", async (runStatus) => {
    const page = harness("image", [task("failed", "failed")], "original-run", { runStatus });
    await page.retry();
    expect(page.sessionReads).toBe(1);
    expect(page.agentCalls).toEqual([]);
    expect(page.retrySequence).toBe(0);
});

test("缺失 runId 且任务没有匹配轮次时不猜测最新 run", async () => {
    const page = harness("image", [task("failed", "failed")], undefined, { missingRunId: true, noRunMatch: true });
    await page.retry();
    expect(page.sessionReads).toBe(1);
    expect(page.agentCalls).toEqual([]);
    expect(page.retrySequence).toBe(0);
});

test("Agent 回复丢失 runId 且浏览器无待确认索引，仍按稳定消息 ID 查回服务端已完成轮次", async () => {
    const page = harness("image", [], "original-run", { agentReply: true, runStatus: "completed" });
    await page.retry();
    expect(page.sessionReads).toBe(1);
    expect(page.agentCalls).toEqual([]);
    expect(page.retrySequence).toBe(0);
});

test("Agent 媒体交付项仍沿原 runId 重试，不切成普通生成", async () => {
    const page = harness("image", [task("failed", "failed")], "original-run");
    await page.retry();
    expect(page.retrySequence).toBe(0);
    expect(page.agentCalls).toHaveLength(1);
    expect(page.agentCalls[0][3]).toEqual({ retry: { runId: "original-run", taskId: "failed" } });
});

test.each(["image", "video"] as const)("普通 %s 生成同款沿用原模式，不因会话绑定 session 切到 Agent", (mode) => {
    const page = harness(mode);
    page.variant();
    expect(page.draft).toMatchObject({ mode, prompt: page.user.content, model: `${mode}-original` });
    expect(page.agentCalls).toEqual([]);
});

test("双击普通失败项只建立一份原任务重试身份", async () => {
    const page = harness("image", [task("failed", "failed")]);
    await Promise.all([page.retry(), page.retry()]);
    expect(page.queries).toEqual(["failed"]);
    expect(page.retrySequence).toBe(1);
    expect(page.pendingRetryRef.current?.context?.retryOf).toBe("failed");
});

test("普通失败批次的逐项重试身份不重用其他图片的任务 ID", async () => {
    const page = harness("image", [task("first", "failed"), task("second", "failed")]);
    await page.retry();
    expect(page.draft.count).toBe("2");
    const contexts = page.pendingRetryRef.current?.context?.retryContextsByBatchIndex || [];
    expect(contexts.map((context) => context.retryOf)).toEqual(["first", "second"]);
    expect(new Set(contexts.map((context) => context.clientOperationId)).size).toBe(2);
});

test("按消息或 taskId 找轮次时只接受唯一匹配，不使用最新轮次兜底", () => {
    const first = { id: "first", events: [{ runId: "first", type: "generation_task_created", payload: { taskId: "original" } }] } as AgentRun;
    const latest = { id: "latest", events: [] } as unknown as AgentRun;
    const conversation = { agentRunId: "latest", agentRuns: [first, latest] } as CreationConversation;
    const message = { id: "task-original", role: "assistant", mode: "image", content: "相同提示词", taskIds: ["original"] } as CreationMessage;
    expect(agentConversation.creationAgentRetryRun(conversation, message)?.id).toBe("first");
    expect(agentConversation.creationAgentRetryRun(conversation, { ...message, id: "unknown", taskIds: [] })).toBeUndefined();
    latest.events = [{ runId: "latest", type: "generation_task_created", payload: { taskId: "original" } }] as AgentRun["events"];
    expect(agentConversation.creationAgentRetryRun(conversation, message)).toBeUndefined();
});
