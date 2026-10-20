import { expect, test } from "bun:test";

import { createCreationSubmitGate, createCreationSubmitGateRelease } from "../src/pages/create/creation-submit-gate";
import { bindCreationSubmissionTask, completedCreationGenerationTask, newMessage, projectCreationTaskWaitFailure } from "../src/pages/create/creation-conversations";
import { createClientId } from "../src/lib/client-id";
import { ApiError } from "../src/services/api/request";
import { isGenerationSubmissionUnconfirmed } from "../src/services/generation-submission";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";
import { isGenerationTaskCancelled, parseBackendGenerationResult, runBackendGenerationTask, type GenerationTaskDependencies } from "../src/services/api/generation-task";
import type { CreateTaskInput, GenerationTask } from "../src/services/api/task-center";
import { beginGenerationConsumer } from "../src/services/generation-consumer-lifecycle";
import { applyGenerationConsumerEffect } from "../src/services/generation-consumer-dedupe";
import { projectGenerationTaskResult } from "../src/services/project-asset-sync";
import { runGenerationOperationOnce } from "../src/lib/canvas/canvas-project-generation";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";

// 与草稿隔离回归一致，执行页面实际 submit 闭包；网络和素材落盘留在测试边界。
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const start = source.indexOf("    const submit = async (");
const end = source.indexOf("\n    useEffect(() => {\n        if (!retrySequence)", start);
if (start < 0 || end < 0) throw new Error("submit function boundary missing");
const submitCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function videoSubmissionHarness() {
    const controls = Array.from({ length: 3 }, () => ({ requested: deferred<void>(), created: deferred<GenerationTask>(), waiting: deferred<void>(), finished: deferred<GenerationTask>() }));
    const requests: CreateTaskInput[] = [];
    const waiting = new Map<string, number>();
    const gate = createCreationSubmitGate();
    const abortRef = { current: null as AbortController | null };
    const activeTaskIds = new Set<string>();
    let busy = false;
    let submitting = new Set<string>();
    let conversation: CreationConversation = { id: "video-conversation", title: "视频", updatedAt: "2026-10-18T00:00:00Z", messages: [] };
    const channel = createModelChannel({ id: "video-test", name: "Video", interfaceType: "minimax-video", baseUrl: "https://video.example/v1", models: ["MiniMax-H3"] });
    const model = encodeChannelModel(channel.id, "MiniMax-H3");
    const config = { ...defaultConfig, channels: [channel], model, videoModel: model, videoSeconds: "6" };
    const dependencies: GenerationTaskDependencies = {
        createId: () => "unused-client-id",
        createTask: async (input) => {
            const index = requests.push(input) - 1;
            controls[index].requested.resolve();
            return controls[index].created.promise;
        },
        waitTask: async (id, options) => {
            const index = waiting.get(id)!;
            controls[index].waiting.resolve();
            const task = await controls[index].finished.promise;
            options?.onTaskUpdate?.(task);
            return task;
        },
    };
    const runtime = {
        skillRuntime: { prepare: async ({ prompt }: { prompt: string }) => ({ prompt, metadata: {} }) },
        runBackendGenerationTask: (options: Parameters<typeof runBackendGenerationTask>[0]) => runBackendGenerationTask(options, dependencies),
        runGenerationOperationOnce,
        beginGenerationConsumer,
        isGenerationTaskCancelled,
        applyGenerationConsumerEffect,
        projectGenerationTaskResult,
        isGenerationSubmissionUnconfirmed,
        hasPendingGenerationSubmission: async () => false,
        consumeGenerationTaskMessage: async (task: GenerationTask, messageId: string, apply: (result: { resultUrls: string[]; resultStorageKeys: string[]; effectKey: string }) => Promise<void>) => {
            const video = parseBackendGenerationResult(task).video!;
            await apply({ resultUrls: [video.dataUrl], resultStorageKeys: [video.storageKey!], effectKey: `attach-message:${task.id}:${messageId}:0` });
            return task;
        },
        generationTaskMaterializedUrls: (task: GenerationTask) => [parseBackendGenerationResult(task).video!.dataUrl],
    };
    const startSubmit = (prompt: string): Promise<void> => {
        const bindings = {
            mode: "video",
            smartCreationActive: false,
            smartCreationProvider: null,
            prompt,
            busy,
            activeConversation: conversation,
            conversationsRef: {
                get current() {
                    return [conversation];
                },
            },
            syncConversationHistory: async (current: CreationConversation) => current.agentSessionId || current.id,
            conversationRoute: { show: () => {} },
            submitGateRef: { current: gate },
            retryPreparingRef: { current: new Set() },
            createCreationSubmitGateRelease,
            selectedModel: model,
            config,
            generationConfig: config,
            attachments: [],
            mentionReferences: [],
            maxReferences: 6,
            imageResolution: "auto",
            imageParameters: "{}",
            count: "1",
            ratio: "16:9",
            quality: "auto",
            seconds: "6",
            videoQuality: "768P",
            videoProfile: {},
            videoReferenceLimits: undefined,
            videoDurationAllowed: () => true,
            reconcileCreationAttachmentLimit: (items: unknown) => ({ attachments: items }),
            selectedCreationReferences: () => [],
            splitCreationAttachments: () => ({ referenceImages: [], referenceVideos: [], referenceAudios: [] }),
            inferVideoOperation: () => "text_to_video",
            loadCreationRuntime: async () => runtime,
            expandCreationPrompt: (text: string) => text,
            getActiveUserScope: () => "user-video",
            followLatestMessageRef: { current: false },
            toast: { error: () => undefined, warning: () => undefined },
            createClientId,
            bindCreationSubmissionTask,
            newMessage,
            completedCreationGenerationTask,
            projectCreationTaskWaitFailure,
            updateActive: (updater: (value: CreationConversation) => CreationConversation) => {
                conversation = updater(conversation);
            },
            updateConversationMessage: (_conversationId: string, id: string, updater: (value: CreationMessage) => CreationMessage) => {
                conversation = { ...conversation, messages: conversation.messages.map((message) => (message.id === id ? updater(message) : message)) };
            },
            activeIdRef: { current: conversation.id },
            activeGenerationTaskIdsRef: { current: activeTaskIds },
            abortRef,
            unmountedRef: { current: false },
            setBusy: (value: boolean) => {
                busy = value;
            },
            setPrompt: () => undefined,
            setAttachments: () => undefined,
            setDraftReferences: () => undefined,
            setSubmittingMessageIds: (update: (ids: Set<string>) => Set<string>) => {
                submitting = update(submitting);
            },
        };
        return new Function(...Object.keys(bindings), `${submitCode}\nreturn submit;`)(...Object.values(bindings))();
    };
    const task = (index: number): GenerationTask => ({
        id: `video-${index}`,
        type: "canvas_video",
        status: "queued",
        prompt: requests[index].prompt || "",
        attempts: 0,
        createdAt: "2026-10-18T00:00:00Z",
        updatedAt: "2026-10-18T00:00:00Z",
    });
    return {
        start: startSubmit,
        requests,
        controls,
        activeTaskIds,
        gate,
        get busy() {
            return busy;
        },
        get submitting() {
            return submitting;
        },
        get messages() {
            return conversation.messages.filter((message) => message.role === "assistant");
        },
        accept: async (index: number) => {
            waiting.set(`video-${index}`, index);
            controls[index].created.resolve(task(index));
            await controls[index].waiting.promise;
        },
        finish: (index: number) => controls[index].finished.resolve({ ...task(index), status: "succeeded", resultJson: JSON.stringify({ video: { dataUrl: `https://video.example/result-${index}.mp4`, storageKey: `resource:result-${index}` } }) }),
    };
}

test("首页视频创建回执后即可提交第二条，交错完成的结果按任务和消息独立交付", async () => {
    const page = videoSubmissionHarness();
    const first = page.start("第一条视频");
    await page.controls[0].requested.promise;
    expect(page.busy).toBe(true);
    expect(page.submitting.has(page.messages[0].id)).toBe(true);
    await page.start("重复点击");
    expect(page.requests).toHaveLength(1);
    await page.accept(0);
    expect(page.busy).toBe(false);
    const second = page.start("第二条视频");
    await page.controls[1].requested.promise;
    await page.accept(1);
    expect(page.activeTaskIds).toEqual(new Set(["video-0", "video-1"]));
    expect(page.messages.map((message) => message.taskIds)).toEqual([["video-0"], ["video-1"]]);
    expect(page.requests.map((request) => request.prompt)).toEqual(["第一条视频", "第二条视频"]);
    page.finish(1);
    await second;
    expect(page.messages[0]).toMatchObject({ status: "pending", taskIds: ["video-0"] });
    expect(page.messages[1]).toMatchObject({ status: "done", taskIds: ["video-1"], resultUrls: ["https://video.example/result-1.mp4"] });
    page.finish(0);
    await first;
    expect(page.messages[0]).toMatchObject({ status: "done", taskIds: ["video-0"], resultUrls: ["https://video.example/result-0.mp4"] });
    expect(page.messages[1].resultUrls).toEqual(["https://video.example/result-1.mp4"]);
    expect(page.activeTaskIds.size).toBe(0);
});

test.each(["完成", "失败"])("旧视频%s后的 finally 不释放新视频尚在创建的提交闸门", async (outcome) => {
    const page = videoSubmissionHarness();
    const first = page.start("上一条视频");
    await page.controls[0].requested.promise;
    await page.accept(0);
    const second = page.start("正在提交的视频");
    await page.controls[1].requested.promise;
    if (outcome === "完成") page.finish(0);
    else page.controls[0].finished.reject(new Error("任务等待失败"));
    await first;
    expect(page.busy).toBe(true);
    expect(page.submitting.has(page.messages[0].id)).toBe(false);
    expect(page.submitting.has(page.messages[1].id)).toBe(true);
    expect(page.gate.tryAcquire()).toBeNull();
    await page.start("重复点击不能穿透");
    expect(page.requests).toHaveLength(2);
    await page.accept(1);
    expect(page.busy).toBe(false);
    page.finish(1);
    await second;
    expect(page.messages[1].status).toBe("done");
    expect(page.activeTaskIds.size).toBe(0);
});

test("首页视频提交失败释放闸门，下一条视频仍可正常创建和交付", async () => {
    const page = videoSubmissionHarness();
    const failed = page.start("提交失败的视频");
    await page.controls[0].requested.promise;
    page.controls[0].created.reject(new ApiError("创建请求被拒绝", { status: 400 }));
    await failed;
    expect(page.busy).toBe(false);
    expect(page.messages[0].status).toBe("error");
    const next = page.start("下一条视频");
    await page.controls[1].requested.promise;
    await page.accept(1);
    page.finish(1);
    await next;
    expect(page.messages[1]).toMatchObject({ status: "done", taskIds: ["video-1"] });
    expect(page.activeTaskIds.size).toBe(0);
});
