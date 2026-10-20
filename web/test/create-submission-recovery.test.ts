import { expect, test } from "bun:test";
import { ApiError } from "../src/services/api/request";
import { createGenerationSubmissionStore, isGenerationSubmissionUnconfirmed } from "../src/services/generation-submission";
import { createCreationSubmitGate, createCreationSubmitGateRelease } from "../src/pages/create/creation-submit-gate";
import {
    bindCreationSubmissionTask,
    newMessage,
    projectCreationTaskWaitFailure,
    refreshCreationMessageTasks,
    recoverCreationGenerationSubmission,
    consumeCreationImageResults,
    completedCreationGenerationTask,
    reconcileCreationTaskMessages,
} from "../src/pages/create/creation-conversations";
import { creationHasInput, type CreationConversation, type CreationMessage } from "../src/pages/create/creation-types";
import { runBackendGenerationTask, runBackendGenerationTaskBatch, isGenerationTaskCancelled, parseBackendGenerationResult, type GenerationTaskDependencies } from "../src/services/api/generation-task";
import type { CreateTaskInput, GenerationTask } from "../src/services/api/task-center";
import { beginGenerationConsumer } from "../src/services/generation-consumer-lifecycle";
import { applyGenerationConsumerEffect } from "../src/services/generation-consumer-dedupe";
import { projectGenerationTaskResult } from "../src/services/project-asset-sync";
import { runGenerationOperationOnce } from "../src/lib/canvas/canvas-project-generation";
import { createModelChannel, defaultConfig, encodeChannelModel, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { modelCapabilityConfigFor, normalizeImageValue } from "../src/lib/model-capabilities";
import { generationErrorMessage } from "../src/lib/generation-error";
import { createClientId } from "../src/lib/client-id";

// 执行首页实际 submit/retry 闭包与真实提交存储、生成 runtime；仅隔离 HTTP、浏览器存储和媒体落盘。
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
function compile(start: string, end: string) {
    const from = source.indexOf(start),
        to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error("closure boundary missing");
    return new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(from, to));
}
const submitCode = compile("    const submit = async (", "\n    useEffect(() => {\n        if (!retrySequence)");
const retryCode = compile("    const retryFailedMessage = async (", "\n    const createVariant = (");
const call = (code: string, name: string, scope: Record<string, unknown>, args: unknown[] = []) => new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope))(...args);

function harness(mode: "video" | "image", behavior: "lost" | "offline" | "rejected" | "partial" = "lost", taskCompletion?: Promise<void>) {
    const requests: CreateTaskInput[] = [],
        queries: string[] = [],
        notices: string[] = [],
        saved = new Map<string, string>();
    const accepted = new Map<string, GenerationTask>();
    let conversation: CreationConversation = { id: "conversation", title: "test", updatedAt: "2026-10-18T00:00:00Z", messages: [] };
    let persisted: CreationConversation | undefined,
        prompt = "同一个创作请求",
        busy = false,
        retrySequence = 0,
        queryError = false;
    let submitting = new Set<string>();
    const unconfirmed = Promise.withResolvers<void>();
    const gate = createCreationSubmitGate(),
        abortRef = { current: null },
        pendingRetryRef = { current: null },
        retryPreparingRef = { current: new Set<string>() };
    const storeDependencies = {
        getScope: () => "user",
        getStorage: () => ({
            getItem: async (key: string) => saved.get(key) || null,
            setItem: async (key: string, value: string) => {
                saved.set(key, value);
            },
            removeItem: async (key: string) => {
                saved.delete(key);
            },
        }),
        findTask: async (key: string) => {
            queries.push(key);
            if (queryError) throw new ApiError("query unavailable", { status: 503 });
            return accepted.get(key) || null;
        },
    };
    let store = createGenerationSubmissionStore(storeDependencies);
    const channel = createModelChannel({ id: "fixture", name: "Fixture", interfaceType: mode === "video" ? "minimax-video" : "openai", baseUrl: "https://fixture.invalid/v1", models: [mode === "video" ? "MiniMax-H3" : "gpt-image-1"] });
    const model = encodeChannelModel(channel.id, channel.models[0]);
    const config = { ...defaultConfig, channels: [channel], model, videoModel: model, imageModel: model, videoSeconds: "6" };
    const dependencies: GenerationTaskDependencies = {
        createId: createClientId,
        submissionStore: store,
        createTask: async (input) => {
            expect(persisted?.messages.at(-1)?.clientOperationId).toBeTruthy();
            expect(persisted?.messages.at(-1)?.submissionPending).toBe(true);
            if (!requests.length) expect(submitting.has(persisted!.messages.at(-1)!.id)).toBe(true);
            requests.push(input);
            if (behavior === "rejected") throw new ApiError("余额不足", { status: 400 });
            if (behavior === "offline" && requests.length === 1) throw new ApiError("offline", { retryable: true });
            const key = input.idempotencyKey!;
            const index = Number((input.input as any).metadata?.batchIndex || 0);
            const task: GenerationTask = accepted.get(key) || {
                id: `accepted-${accepted.size}`,
                type: `canvas_${mode}`,
                status: behavior === "partial" && index === 0 ? "succeeded" : "running",
                prompt: input.prompt || "",
                attempts: 1,
                createdAt: "2026-10-18T00:00:00Z",
                updatedAt: "2026-10-18T00:00:00Z",
                clientContext: { conversationId: conversation.id, messageId: conversation.messages.at(-1)!.id, batchIndex: index, batchCount: behavior === "partial" ? 2 : 1 },
                resultJson: JSON.stringify({ images: [{ dataUrl: "https://fixture.invalid/result.png", storageKey: "resource:image" }] }),
            };
            accepted.set(key, task);
            if (behavior === "offline" || (behavior === "partial" && index === 0)) return task;
            throw new ApiError("Bad Gateway", { status: 502 });
        },
        waitTask: async (id, options) => {
            await taskCompletion;
            const task = [...accepted.values()].find((task) => task.id === id)!;
            options?.onTaskUpdate?.(task);
            return task;
        },
    };
    const urls = (task: GenerationTask) => parseBackendGenerationResult(task).images?.map((image) => image.dataUrl) || [];
    const keys = (task: GenerationTask) => parseBackendGenerationResult(task).images?.map((image) => image.storageKey!) || [];
    const runtime = {
        skillRuntime: { prepare: async ({ prompt }: { prompt: string }) => ({ prompt, metadata: {} }) },
        runBackendGenerationTask: (options: Parameters<typeof runBackendGenerationTask>[0]) => runBackendGenerationTask(options, dependencies),
        runBackendGenerationTaskBatch: (options: Parameters<typeof runBackendGenerationTaskBatch>[0]) => runBackendGenerationTaskBatch(options, dependencies),
        runGenerationOperationOnce,
        beginGenerationConsumer,
        isGenerationTaskCancelled,
        isGenerationSubmissionUnconfirmed,
        hasPendingGenerationSubmission: (operation: string) => store.hasPending(operation),
        recoverGenerationSubmission: (operation: string, options: Parameters<typeof store.recover>[1]) => store.recover(operation, options),
        queryGenerationTask: async (id: string) => {
            queries.push(id);
            if (queryError) throw new ApiError("Service Unavailable", { status: 503 });
            return [...accepted.values()].find((task) => task.id === id)!;
        },
        recoverCreationTextTask: () => null,
        runGenerationConsumer: async (_signal: AbortSignal | undefined, operation: (signal: AbortSignal) => unknown) => operation(new AbortController().signal),
        materializeGenerationTaskAssets: async (task: GenerationTask) => task,
        generationTaskMaterializedUrls: urls,
        generationTaskMaterializedStorageKeys: keys,
        applyGenerationConsumerEffect,
        projectGenerationTaskResult,
        consumeGenerationTaskMessage: async (task: GenerationTask, _id: string, apply: (result: { resultUrls: string[]; resultStorageKeys: string[]; effectKey: string }) => Promise<unknown>) => {
            await apply({ resultUrls: urls(task), resultStorageKeys: keys(task), effectKey: `effect:${task.id}` });
            return task;
        },
        createGenerationRetryContext: async () => {
            throw new Error("running 或未知状态不应创建重试上下文");
        },
    };
    const scope = () => ({
        mode,
        smartCreationActive: false,
        smartCreationProvider: null,
        prompt,
        busy,
        activeConversation: conversation,
        creationHasInput,
        conversationsRef: {
            get current() {
                return [conversation];
            },
        },
        syncConversationHistory: async (current: CreationConversation) => {
            persisted = structuredClone(current);
            return current.agentSessionId || current.id;
        },
        conversationRoute: { show: () => {} },
        submitGateRef: { current: gate },
        retryPreparingRef,
        createCreationSubmitGateRelease,
        selectedModel: model,
        config,
        generationConfig: config,
        attachments: [],
        mentionReferences: [],
        maxReferences: 6,
        imageResolution: "auto",
        imageParameters: "{}",
        count: behavior === "partial" ? "2" : "1",
        ratio: "1:1",
        quality: "auto",
        seconds: "6",
        videoQuality: "768P",
        videoProfile: {},
        videoReferenceLimits: undefined,
        imageProfile: modelCapabilityConfigFor(config, model).image,
        normalizeImageValue,
        resolveModelRequestConfig,
        videoDurationAllowed: () => true,
        reconcileCreationAttachmentLimit: (items: unknown) => ({ attachments: items }),
        selectedCreationReferences: () => [],
        splitCreationAttachments: () => ({ referenceImages: [], referenceVideos: [], referenceAudios: [] }),
        inferVideoOperation: () => "text_to_video",
        loadCreationRuntime: async () => runtime,
        expandCreationPrompt: (value: string) => value,
        getActiveUserScope: () => "user",
        followLatestMessageRef: { current: false },
        toast: { error: (s: string) => notices.push(s), warning: (s: string) => notices.push(s), info: (s: string) => notices.push(s) },
        ApiError,
        createClientId,
        bindCreationSubmissionTask,
        newMessage,
        projectCreationTaskWaitFailure,
        refreshCreationMessageTasks,
        recoverCreationGenerationSubmission,
        consumeCreationImageResults,
        completedCreationGenerationTask,
        generationErrorMessage,
        updateActive: (updater: (value: CreationConversation) => CreationConversation) => {
            conversation = updater(conversation);
        },
        updateConversationMessage: async (_id: string, id: string, updater: (message: CreationMessage) => CreationMessage) => {
            conversation = { ...conversation, messages: conversation.messages.map((message) => (message.id === id ? updater(message) : message)) };
            persisted = structuredClone(conversation);
        },
        activeIdRef: { current: conversation.id },
        activeGenerationTaskIdsRef: { current: new Set() },
        abortRef,
        unmountedRef: { current: false },
        setBusy: (value: boolean) => {
            busy = value;
        },
        setPrompt: (value: string) => {
            prompt = value;
        },
        setAttachments: () => {},
        setDraftReferences: () => {},
        setSubmittingMessageIds: (update: (ids: Set<string>) => Set<string>) => {
            const wasSubmitting = submitting.size > 0;
            submitting = update(submitting);
            if (wasSubmitting && !submitting.size) unconfirmed.resolve();
        },
        restoreMessageDraft: (message: CreationMessage) => {
            prompt = message.content;
        },
        pendingRetryRef,
        setRetrySequence: (updater: (value: number) => number) => {
            retrySequence = updater(retrySequence);
        },
    });
    return {
        requests,
        accepted,
        queries,
        notices,
        runtime,
        unconfirmed: unconfirmed.promise,
        get messages() {
            return conversation.messages;
        },
        get busy() {
            return busy;
        },
        get retrySequence() {
            return retrySequence;
        },
        get submitting() {
            return submitting;
        },
        start: () => call(submitCode, "submit", scope()),
        retry: (item: CreationMessage) => call(retryCode, "retryFailedMessage", scope(), [item, conversation.messages.indexOf(item)]),
        reload: () => {
            conversation = structuredClone(persisted!);
            store = createGenerationSubmissionStore(storeDependencies);
            dependencies.submissionStore = store;
        },
        makeKnownFailure: () => {
            const item = conversation.messages.at(-1)!;
            item.taskIds = [[...accepted.values()][0].id];
            item.submissionPending = undefined;
            item.status = "error";
            return item;
        },
        setQueryError: (value: boolean) => {
            queryError = value;
        },
    };
}

test.each(["video", "image"] as const)("%s 创建回执丢失，刷新后实际恢复按钮只找回原任务，不删除消息或再次收费提交", async (mode) => {
    const page = harness(mode);
    await page.start();
    const original = page.messages.at(-1)!;
    expect(original).toMatchObject({ status: "pending", submissionPending: true });
    expect(original.clientOperationId).toBeTruthy();
    expect(original.taskIds).toBeUndefined();
    expect(original.error).toBeUndefined();
    expect(page.submitting.size).toBe(0);
    expect(page.requests[0].idempotencyKey).toContain(original.clientOperationId!);
    expect(page.busy).toBe(false);
    page.reload();
    await page.retry(page.messages.at(-1)!);
    expect(page.messages).toHaveLength(2);
    expect(page.messages.at(-1)).toMatchObject({ id: original.id, clientOperationId: original.clientOperationId, taskIds: ["accepted-0"], status: "pending" });
    expect(page.messages.at(-1)?.submissionPending).toBeUndefined();
    expect(page.requests).toHaveLength(1);
    expect(page.accepted.size).toBe(1);
    expect(page.queries).toEqual([page.requests[0].idempotencyKey!]);
});

test("未送达的请求恢复时沿用相同 key 和原始请求，重复点击不创建新操作", async () => {
    const page = harness("video", "offline");
    await page.start();
    const item = page.messages.at(-1)!;
    await Promise.all([page.retry(item), page.retry(item)]);
    expect(page.requests).toHaveLength(2);
    expect(page.requests[1]).toEqual(page.requests[0]);
    expect(page.accepted.size).toBe(1);
    expect(page.messages.at(-1)?.id).toBe(item.id);
});

test("恢复查询 503 仍保留原提交入口，网络恢复后找回同一任务", async () => {
    const page = harness("video");
    await page.start();
    page.reload();
    page.setQueryError(true);
    await page.retry(page.messages.at(-1)!);
    expect(page.messages.at(-1)).toMatchObject({ status: "pending", submissionPending: true });
    expect(page.requests).toHaveLength(1);
    page.setQueryError(false);
    await page.retry(page.messages.at(-1)!);
    expect(page.messages.at(-1)?.taskIds).toEqual(["accepted-0"]);
    expect(page.requests).toHaveLength(1);
});

test("图片批次部分回执丢失保留已有图片，不把已确认项重复提交", async () => {
    const page = harness("image", "partial");
    await page.start();
    const item = page.messages.at(-1)!;
    expect(item).toMatchObject({ status: "pending", submissionPending: true, resultUrls: ["https://fixture.invalid/result.png"] });
    expect(item.batchFailedCount || 0).toBe(0);
    await page.retry(item);
    expect(page.messages.at(-1)?.taskIds).toHaveLength(2);
    expect(page.messages.at(-1)?.submissionPending).toBeUndefined();
    expect(page.requests).toHaveLength(2);
    expect(page.accepted.size).toBe(2);
});

test("批次有一项回执未知时立即展示核对入口，不等待已受理任务生成结束", async () => {
    const completion = Promise.withResolvers<void>();
    const page = harness("image", "partial", completion.promise);
    let finished = false;
    const pending = page.start().then(() => {
        finished = true;
    });
    try {
        await page.unconfirmed;
        expect(finished).toBe(false);
        expect(page.messages.at(-1)?.submissionPending).toBe(true);
        expect(page.submitting.size).toBe(0);
        expect(page.requests).toHaveLength(2);
    } finally {
        completion.resolve();
        await pending;
    }
});

test("旧缓存丢失批次待确认标记时，按原张数找回缺失回执而非重试已知项", async () => {
    const page = harness("image", "partial");
    await page.start();
    const item = page.messages.at(-1)!;
    item.submissionPending = undefined;
    item.status = "error";
    await page.retry(item);
    expect(page.messages.at(-1)?.taskIds).toHaveLength(2);
    expect(page.messages.at(-1)?.submissionPending).toBeUndefined();
    expect(page.requests).toHaveLength(2);
    expect(page.accepted.size).toBe(2);
    expect(page.retrySequence).toBe(0);
});

test.each([false, true])("已知 ID 的恢复保护保持不变，查询异常=%s 不新建", async (queryError) => {
    const page = harness("video");
    await page.start();
    const item = page.makeKnownFailure();
    page.setQueryError(queryError);
    await page.retry(item);
    expect(page.queries).toEqual(["accepted-0"]);
    expect(page.requests).toHaveLength(1);
    expect(page.retrySequence).toBe(0);
});

test("明确拒绝仍按真实错误显示，不能伪装成待确认", async () => {
    const page = harness("video", "rejected");
    await page.start();
    expect(page.messages.at(-1)).toMatchObject({ status: "error", content: "生成失败", error: "余额不足" });
    expect(page.messages.at(-1)?.submissionPending).toBeUndefined();
    expect(page.accepted.size).toBe(0);
});

test("部分已确认图片的订阅不能覆盖整批提交待确认状态", () => {
    const at = "2026-10-18T00:00:00Z";
    const item: CreationMessage = { id: "batch", role: "assistant", mode: "image", status: "pending", content: "", createdAt: at, taskIds: ["done"], clientOperationId: "operation", submissionPending: true };
    const conversation: CreationConversation = { id: "conversation", title: "", updatedAt: at, messages: [item] };
    const result = reconcileCreationTaskMessages(
        { recoverCreationTextTask: () => null } as any,
        [conversation],
        [{ id: "done", type: "canvas_image", status: "succeeded", prompt: "", attempts: 1, createdAt: at, updatedAt: at, creationResultStorageKeys: ["resource:done"] }],
    );
    expect(result[0].messages[0]).toMatchObject({ status: "pending", submissionPending: true, resultStorageKeys: ["resource:done"] });
});
