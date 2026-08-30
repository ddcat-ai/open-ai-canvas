import { expect, test } from "bun:test";

import { defaultConfig } from "../src/stores/use-config-store";
import { runBackendGenerationTask, runBackendGenerationTaskBatch } from "../src/services/api/generation-task";
import { deleteGenerationTask, formatTaskLog, listGenerationTasks, projectBackendSafeTaskLog, splitGenerationTaskObservationIds, type GenerationTask } from "../src/services/api/task-center";
import { isLocalDreaminaBackgroundTask, localDreaminaCancellationCopy, localDreaminaDetachOutcome, projectLocalDreaminaTask } from "../src/services/local-dreamina-task-projection";
import { LocalDreaminaGenerationClientError, runLocalDreaminaGenerationTask, type LocalDreaminaGenerationInput } from "../src/services/local-dreamina-generation";
import { createGenerationBatchRetryContexts, createGenerationRetryContext, generationTaskMetadata, runBackendCanvasGenerationTask, runCanvasGenerationTaskToConsumer } from "../src/lib/canvas/canvas-project-generation";
import { runCanvasAgentGenerationOps } from "../src/pages/canvas/use-canvas-agent-operations";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { onlineToolToOps } from "../src/components/canvas/canvas-assistant-panel";
import { generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "../src/lib/generation-task-display";
import { generationErrorMessage } from "../src/lib/generation-error";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

function sourceSection(source: string, startMarker: string, endMarker: string) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return compactSource(source.slice(start, end));
}

test("Dreamina submit failure categories have bounded user-facing messages", () => {
    const cases = [
        ["dreamina_submit_spawn_failed", "无法启动官方即梦 CLI，任务尚未提交。"],
        ["dreamina_submit_exit_nonzero", "官方即梦 CLI 未接受本次提交，任务没有自动重试。"],
        ["dreamina_submit_timeout", "等待官方即梦 CLI 确认提交超时，为避免重复扣费，任务没有自动重试。"],
        ["dreamina_submit_receipt_missing", "官方即梦 CLI 未返回任务凭证，为避免重复扣费，任务没有自动重试。"],
    ] as const;
    for (const [code, message] of cases) {
        expect(generationErrorMessage(new LocalDreaminaGenerationClientError(code, "本机即梦生成请求失败", 502))).toBe(message);
    }
});

test("resource storage 403 is not reported as generation channel authentication", () => {
    const raw = "参考图片上传失败：OSS 上传失败：403 Forbidden <Code>UserDisable</Code><Message>UserDisable</Message>";
    expect(generationErrorMessage(raw)).toBe("对象存储账号已停用，请检查或更换对象存储配置。");
});

test("durable Dreamina submit failures keep their stable user-facing category in task center", () => {
    const task = projectLocalDreaminaTask({
        id: "dreamina-submit-timeout-task-0001",
        provider: "dreamina-cli",
        mode: "video",
        operation: "image2video",
        model: "seedance2.0mini",
        status: "failed",
        stage: "submission_unknown",
        receiptRecorded: false,
        errorCode: "dreamina_submit_timeout",
        createdAt: "2026-08-12T08:03:53.118Z",
        updatedAt: "2026-08-12T08:04:44.191Z",
    });

    expect(task.errorCode).toBe("dreamina_submit_timeout");
    expect(task.error).toBe("等待官方即梦 CLI 确认提交超时，为避免重复扣费，任务没有自动重试。");
});

test("local Dreamina projection preserves stable outputs independently from provider success", () => {
    const task = projectLocalDreaminaTask({
        id: "dreamina-output-projection-task-0001",
        provider: "dreamina-cli",
        mode: "image",
        operation: "text2image",
        model: "image-3.0",
        status: "succeeded",
        stage: "succeeded",
        receiptRecorded: true,
        officialStatus: "completed",
        lifecycle: "TERMINAL",
        terminalOutcome: "SUCCEEDED",
        resultState: "PENDING_MATERIALIZATION",
        outputs: [
            {
                outputIndex: 0,
                mediaType: "image",
                providerArtifactRef: "provider-artifact-opaque",
            },
        ],
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:01:00.000Z",
    });

    expect(task.status).toBe("succeeded");
    expect(task.resultState).toBe("PENDING_MATERIALIZATION");
    expect(task.outputs).toEqual([
        {
            outputIndex: 0,
            mediaType: "image",
            providerArtifactRef: "provider-artifact-opaque",
        },
    ]);
});

test("task display does not claim a submitted Dreamina receipt is actively generating", () => {
    const submitting = {
        provider: "dreamina-cli",
        status: "running",
        stage: "submitting",
        receiptRecorded: false,
    } as GenerationTask;
    const submitted = {
        provider: "dreamina-cli",
        status: "running",
        stage: "submitted",
    } as GenerationTask;
    const generating = { ...submitted, stage: "generating" } as GenerationTask;
    const officialPending = { ...submitted, officialStatus: "pending" } as GenerationTask;
    const officialProcessing = { ...submitted, officialStatus: "processing" } as GenerationTask;
    const officialCompleted = { ...submitted, officialStatus: "completed" } as GenerationTask;
    const remoteRunning = { provider: "openai-compatible", status: "running", stage: "submitted" } as GenerationTask;

    expect(generationTaskStatusLabel(submitting)).toBe("正在提交");
    expect(generationTaskStageLabel(submitting)).toBe("正在提交，等待官方确认");
    expect(generationTaskShowsProgress(submitting)).toBe(false);
    expect(generationTaskStatusLabel(submitted)).toBe("状态待更新");
    expect(generationTaskStageLabel(submitted)).toBe("已提交，等待状态更新");
    expect(generationTaskShowsProgress(submitted)).toBe(false);
    expect(generationTaskStatusLabel(officialPending)).toBe("官方排队中");
    expect(generationTaskStageLabel(officialPending)).toBe("官方返回状态：pending");
    expect(generationTaskStatusLabel(officialProcessing)).toBe("生成中");
    expect(generationTaskStageLabel(officialProcessing)).toBe("官方返回状态：processing");
    expect(generationTaskStatusLabel(officialCompleted)).toBe("官方已完成");
    expect(generationTaskStageLabel(officialCompleted)).toBe("官方返回状态：completed");
    expect(generationTaskStatusLabel(generating)).toBe("生成中");
    expect(generationTaskShowsProgress(generating)).toBe(true);

    for (const stage of ["等待队列调度", "后端接管任务", "正在连接上游", "调用生成模型"]) {
        expect(generationTaskShowsProgress({ ...generating, provider: "managed", stage })).toBe(false);
    }
    expect(generationTaskShowsProgress({ ...generating, provider: "managed", stage: "上游生成中" })).toBe(true);
    expect(generationTaskStatusLabel(remoteRunning)).toBe("生成中");
});

test("Dreamina submission uncertainty is not an accepted background task", () => {
    const uncertain = { id: "dreamina:submit-uncertain-0001", provider: "dreamina-cli", status: "failed", stage: "submission_unknown", receiptRecorded: false, errorCode: "dreamina_submission_unknown" } as GenerationTask;
    const projected = projectLocalDreaminaTask({
        id: "submit-uncertain-0001",
        provider: "dreamina-cli",
        mode: "video",
        operation: "text2video",
        model: "seedance2.0",
        status: "failed",
        stage: "submission_unknown",
        receiptRecorded: false,
        lifecycle: "SUBMISSION_UNCERTAIN",
        errorCode: "dreamina_submission_unknown",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:10.000Z",
    });
    expect(projected.status).toBe("failed");
    expect(projected.error).toBe("提交结果待确认，为避免重复扣费未自动重试。");
    expect(generationTaskStatusLabel(uncertain)).toBe("提交结果待确认");
    expect(generationTaskStageLabel(uncertain)).toBe("为避免重复扣费，未自动重试");
    expect(generationTaskShowsProgress(uncertain)).toBe(false);
    expect(isLocalDreaminaBackgroundTask(uncertain)).toBe(false);
    expect(localDreaminaCancellationCopy(uncertain)).toBeUndefined();
});

test("Canvas task surfaces route Dreamina uncertainty through shared display semantics without cancellation", async () => {
    const [nodeSource, detailSource, scriptSource, taskCenterSource, createSource] = await Promise.all([
        Bun.file(new URL("../src/components/canvas/canvas-node-content.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/canvas/canvas-project-status-dialogs.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/canvas/canvas-script-node.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/tasks/index.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text(),
    ]);
    expect(nodeSource).toContain("generationTaskStageLabel(displayTask)");
    expect(nodeSource).toContain("generationTaskShowsProgress(displayTask)");
    expect(nodeSource).not.toContain("onCancelTask");
    expect(nodeSource).not.toContain("取消生成");
    expect(nodeSource).not.toContain('node.metadata?.taskStage || (taskId ? "任务处理中" : "正在创建任务")');
    expect(detailSource).toContain("generationTaskStageLabel(task)");
    expect(detailSource).toContain("generationTaskShowsProgress(task) ? <TaskDetailItem");
    expect(detailSource).not.toContain("task.stage || taskStatusText(task.status)");
    expect(scriptSource).toContain("generationTaskStageLabel(displayTask)");
    expect(scriptSource).toContain("generationTaskShowsProgress(displayTask)");
    expect(scriptSource).not.toContain('node.metadata.taskStage || "正在创建任务"');
    expect(nodeSource).toContain("isGenerationTaskSubmissionUncertain(errorDisplayTask)");
    expect(taskCenterSource).toContain("if (currentTask && isGenerationTaskSubmissionUncertain(currentTask))");
    expect(taskCenterSource).toContain("不能自动重试；请先核对官方状态，避免重复生成");
    expect(taskCenterSource).toContain("onRetry={() => void runAction(task.id)}");
    expect(taskCenterSource).toContain("<TaskListRow");
    expect(taskCenterSource).toContain("<TaskGridCard");
    expect(createSource).not.toContain('item.generationStage === "submission_unknown"');
    expect(createSource).not.toContain('generationStage === "submission_unknown" ? "cancelled"');
});

test("Canvas fullscreen video restores large controls instead of keeping the compact node layout", async () => {
    const playerCSS = await Bun.file(new URL("../src/components/video-player.css", import.meta.url)).text();
    expect(playerCSS).toContain('.canvas-video-player[data-player-variant="compact"]:not([data-fullscreen])');
    expect(playerCSS).toContain("--media-fullscreen-button-size: 60px");
    expect(playerCSS).toContain("--media-slider-track-height: 8px");
    expect(playerCSS).toContain("min-height: 64px");
});

test("task center deletion accepts only local Dreamina records", async () => {
    await expect(deleteGenerationTask("backend-task-0001")).rejects.toThrow("当前任务不支持删除");
    const source = await Bun.file(new URL("../src/pages/tasks/index.tsx", import.meta.url)).text();
    const compactedSource = compactSource(source);
    const deleteActionSource = sourceSection(source, "const deleteLocalTask =", "const refreshLocalTaskStatus =");

    expect(compactedSource).toMatch(/\{detailTask\.provider === "dreamina-cli" \? \( <Button .*?aria-label="删除本机记录".*?onClick=\{\(\) => deleteLocalTask\(detailTask\)\}> 删除本机记录 <\/Button> \) : null\}/);
    expect(compactedSource).toContain("官方状态采用最终一致轮询；转入后台后仍会继续等待并同步官方状态。");
    expect(deleteActionSource).toContain("await deleteGenerationTask(task.id);");
});

test("submitted Dreamina records expose a manual one-shot status refresh action", async () => {
    const source = await Bun.file(new URL("../src/pages/tasks/index.tsx", import.meta.url)).text();
    const compactedSource = compactSource(source);
    const refreshActionSource = sourceSection(source, "const refreshLocalTaskStatus =", "const queryProviderTask =");

    expect(compactedSource).toMatch(
        /\{detailTask\.provider === "dreamina-cli" && detailTask\.receiptRecorded && detailTask\.status === "running" \? \( <Button .*?aria-label="更新官方状态".*?onClick=\{\(\) => void refreshLocalTaskStatus\(detailTask\)\}> 更新官方状态 <\/Button> \) : null\}/,
    );
    expect(refreshActionSource).toContain("const next = await refreshGenerationTaskStatus(task.id);");
    expect(refreshActionSource.match(/refreshGenerationTaskStatus\(task\.id\)/g)).toHaveLength(1);
    expect(compactedSource).not.toMatch(/setInterval\(\(\) => (?:void |await )?refreshGenerationTaskStatus\(/);
});

test("a selected Dreamina local model never creates a Backend task", async () => {
    let backendCalls = 0;
    let localInput: LocalDreaminaGenerationInput | undefined;
    const result = await runBackendGenerationTask(
        {
            mode: "video",
            prompt: "A short test clip",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4" },
        },
        {
            createTask: async () => {
                backendCalls += 1;
                throw new Error("must not post /tasks");
            },
            waitTask: async () => {
                throw new Error("must not wait Backend task");
            },
            runLocal: async (input) => {
                localInput = input;
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
            createId: () => "dreamina-task-route-0001",
            now: () => "2026-08-11T00:00:00.000Z",
        },
    );

    expect(result).toEqual({ mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } });
    expect(localInput?.settings).toEqual({ aspect: "1:1", resolution: "720", duration: 4 });
    expect((localInput as unknown as { clientOperationId?: string }).clientOperationId).toBe("dreamina-task-route-0001");
    expect((localInput as unknown as { context?: unknown }).context).toEqual({ scope: "scoped" });
    expect(backendCalls).toBe(0);
});

test("the shared local generation entry projects pre-receipt work as submitting without fake progress", async () => {
    const updates: GenerationTask[] = [];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = runBackendGenerationTask(
        {
            mode: "video",
            prompt: "fixture",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", size: "16:9", vquality: "720", videoSeconds: "4" },
            onTaskUpdate: (task) => updates.push(task),
        },
        {
            createTask: async () => {
                throw new Error("backend task must not be created");
            },
            waitTask: async () => {
                throw new Error("backend task must not be awaited");
            },
            runLocal: async () => {
                await waiting;
                throw new LocalDreaminaGenerationClientError("dreamina_submit_timeout", "bounded", 504);
            },
            createId: () => "dreamina-pre-receipt-entry-0001",
            now: () => "2026-08-12T10:00:00.000Z",
        },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates[0]).toMatchObject({ status: "running", stage: "submitting" });
    expect(updates[0]?.progress).toBeUndefined();
    release();
    await expect(pending).rejects.toMatchObject({ code: "dreamina_submit_timeout" });
});

test("shared Create and Canvas task projection exposes queued, submitted, generating, and terminal Runtime states", async () => {
    const updates: Array<{ id: string; status: string; stage?: string; resultJson?: string }> = [];
    const timestamp = "2026-08-12T00:00:00.000Z";
    await runBackendGenerationTask(
        {
            mode: "video",
            prompt: "A queued clip",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
            onTaskUpdate: (task) => updates.push(task),
        },
        {
            createTask: async () => {
                throw new Error("must not post /tasks");
            },
            waitTask: async () => {
                throw new Error("must not wait Backend task");
            },
            runLocal: async (input, _signal, onTaskUpdate) => {
                const base = { id: input.idempotencyKey!, provider: "dreamina-cli" as const, mode: "video" as const, operation: "text2video", model: "seedance2.0mini", receiptRecorded: false, createdAt: timestamp, updatedAt: timestamp };
                onTaskUpdate?.({ ...base, status: "queued", stage: "queued", progress: 0 });
                onTaskUpdate?.({ ...base, status: "running", stage: "submitted", progress: 10, receiptRecorded: true });
                onTaskUpdate?.({ ...base, status: "running", stage: "generating", progress: 20, receiptRecorded: true });
                onTaskUpdate?.({ ...base, status: "succeeded", stage: "succeeded", progress: 100, receiptRecorded: true, result: { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } } });
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
            createId: () => "dreamina-shared-async-0001",
            now: () => timestamp,
        },
    );

    const distinctUpdates = updates.filter((task, index) => index === 0 || task.status !== updates[index - 1]?.status || task.stage !== updates[index - 1]?.stage);
    expect(distinctUpdates.slice(0, 5).map((task) => [task.id, task.status, task.stage])).toEqual([
        ["dreamina:dreamina-shared-async-0001", "running", "submitting"],
        ["dreamina:dreamina-shared-async-0001", "queued", "queued"],
        ["dreamina:dreamina-shared-async-0001", "running", "submitted"],
        ["dreamina:dreamina-shared-async-0001", "running", "generating"],
        ["dreamina:dreamina-shared-async-0001", "succeeded", "succeeded"],
    ]);
    expect(distinctUpdates[4]?.resultJson).toContain('"mode":"video"');
});

test("the first local Dreamina submission waits for catalog readiness before invoking the paid Runtime path", async () => {
    const order: string[] = [];
    let release!: () => void;
    const readyGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = runBackendGenerationTask(
        {
            mode: "video",
            prompt: "first visit",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
        },
        {
            createTask: async () => {
                throw new Error("must not create backend task");
            },
            waitTask: async () => {
                throw new Error("must not wait backend task");
            },
            ensureLocalDreaminaReady: async () => {
                order.push("catalog-start");
                await readyGate;
                order.push("catalog-ready");
            },
            runLocal: async () => {
                order.push("paid-runtime");
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
            createId: () => "dreamina-first-ready-0001",
            now: () => "2026-08-18T00:00:00.000Z",
        },
    );

    await Promise.resolve();
    expect(order).toEqual(["catalog-start"]);
    release();
    await pending;
    expect(order).toEqual(["catalog-start", "catalog-ready", "paid-runtime"]);
});

test("the first local Dreamina batch shares one catalog readiness gate before any paid Runtime call", async () => {
    const order: string[] = [];
    let release!: () => void;
    const readyGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = runBackendGenerationTaskBatch(
        {
            mode: "image",
            prompt: "first batch",
            config: { ...defaultConfig, model: "local:dreamina-cli:5.0Pro", count: "1" },
            count: 3,
        },
        {
            createTask: async () => {
                throw new Error("must not create backend task");
            },
            waitTask: async () => {
                throw new Error("must not wait backend task");
            },
            ensureLocalDreaminaReady: async () => {
                order.push("catalog-start");
                await readyGate;
                order.push("catalog-ready");
            },
            runLocal: async () => {
                order.push("paid-runtime");
                return { mode: "image", images: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }] };
            },
            createId: () => `dreamina-first-batch-${order.length}`,
            now: () => "2026-08-18T00:00:00.000Z",
        },
    );

    await Promise.resolve();
    expect(order).toEqual(["catalog-start"]);
    release();
    const settled = await pending;
    expect(settled.every((entry) => entry.status === "fulfilled")).toBe(true);
    expect(order).toEqual(["catalog-start", "catalog-ready", "paid-runtime", "paid-runtime", "paid-runtime"]);
});

test("local Dreamina terminal projection keeps the latest receipt, observation, and durable outputs", async () => {
    const updates: GenerationTask[] = [];
    const timestamp = "2026-08-18T00:00:00.000Z";
    await runBackendGenerationTask(
        {
            mode: "video",
            prompt: "late result",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
            onTaskUpdate: (task) => updates.push(task),
        },
        {
            createTask: async () => {
                throw new Error("must not create backend task");
            },
            waitTask: async () => {
                throw new Error("must not wait backend task");
            },
            runLocal: async (input, _signal, onTaskUpdate) => {
                onTaskUpdate?.({
                    id: input.idempotencyKey!,
                    provider: "dreamina-cli",
                    mode: "video",
                    operation: "text2video",
                    model: "seedance2.0mini",
                    status: "succeeded",
                    stage: "succeeded",
                    progress: 100,
                    receiptRecorded: true,
                    officialStatus: "completed",
                    providerObservation: { source: "query_result", status: "completed", observedAt: timestamp },
                    outputs: [{ outputIndex: 0, mediaType: "video", materializedAssetId: "asset-late-0001" }],
                    result: { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } },
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
            createId: () => "dreamina-latest-context-0001",
            now: () => timestamp,
        },
    );

    expect(updates.at(-1)).toMatchObject({
        status: "succeeded",
        stage: "local_cli_succeeded",
        receiptRecorded: true,
        officialStatus: "completed",
        outputs: [{ outputIndex: 0, mediaType: "video", materializedAssetId: "asset-late-0001" }],
    });
    expect(updates.at(-1)?.resultJson).toContain('"mode":"video"');
});

test("an explicitly cancelled Dreamina task stays cancelled instead of being projected as failed", async () => {
    const updates: Array<{ status: string; stage?: string }> = [];
    const timestamp = "2026-08-12T00:00:00.000Z";

    await expect(
        runBackendGenerationTask(
            {
                mode: "video",
                prompt: "A clip cancelled after submission",
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
                onTaskUpdate: (task) => updates.push(task),
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async (input, _signal, onTaskUpdate) => {
                    const task = {
                        id: input.idempotencyKey!,
                        provider: "dreamina-cli" as const,
                        mode: "video" as const,
                        operation: "text2video",
                        model: "seedance2.0mini",
                        status: "cancelled" as const,
                        stage: "cancelled" as const,
                        progress: 0,
                        receiptRecorded: true,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    };
                    onTaskUpdate?.(task);
                    throw new DOMException("Aborted", "AbortError");
                },
                createId: () => "dreamina-explicit-cancel-0001",
                now: () => timestamp,
            },
        ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(updates.at(-1)).toMatchObject({ status: "cancelled", stage: "local_cli_cancelled" });
    expect(updates.some((task) => task.status === "failed")).toBe(false);
});

test("an accepted Dreamina wait abort preserves the last public task instead of projecting cancellation", async () => {
    const controller = new AbortController();
    const updates: GenerationTask[] = [];
    const requests: string[] = [];
    let waitStartedResolve!: () => void;
    const waitStarted = new Promise<void>((resolve) => {
        waitStartedResolve = resolve;
    });
    const runtimeTaskId = "dreamina-accepted-wait-abort-0001";
    const client = {
        async connect() {
            return {
                state: "connected" as const,
                runtimeVersion: 2,
                session: {
                    sessionId: "session-accepted-wait-abort-0001",
                    keyId: "browser-key-accepted-wait-abort",
                    scopes: ["dreamina:generate"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
            };
        },
        async request(path: string, init?: RequestInit) {
            requests.push(path);
            if (path === "/dreamina/generate") {
                return new Response(
                    JSON.stringify({
                        ok: true,
                        result: {
                            id: runtimeTaskId,
                            provider: "dreamina-cli",
                            mode: "video",
                            operation: "text2video",
                            model: "seedance2.0",
                            status: "running",
                            stage: "submitted",
                            receiptRecorded: true,
                            lifecycle: "ACCEPTED",
                            syncState: "SYNC_OK",
                            resultState: "NOT_AVAILABLE",
                            outputs: [],
                            context: { scope: "scoped" },
                            createdAt: "2026-08-14T00:00:00.000Z",
                            updatedAt: "2026-08-14T00:00:01.000Z",
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }
            if (path === "/dreamina/generate/wait") {
                waitStartedResolve();
                return await new Promise<Response>((_resolve, reject) => {
                    const signal = init?.signal;
                    if (!signal) return reject(new Error("wait request must carry the generation AbortSignal"));
                    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
                    signal.addEventListener("abort", onAbort, { once: true });
                    if (signal.aborted) onAbort();
                });
            }
            throw new Error(`unexpected Dreamina route: ${path}`);
        },
    };

    const pending = runBackendGenerationTask(
        {
            mode: "video",
            prompt: "accepted wait abort fixture",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0", videoSeconds: "4", vquality: "720" },
            signal: controller.signal,
            onTaskUpdate: (task) => updates.push(task),
        },
        {
            createTask: async () => {
                throw new Error("must not post Backend /tasks");
            },
            waitTask: async () => {
                throw new Error("must not wait a Backend task");
            },
            runLocal: (input, signal, onTaskUpdate) => runLocalDreaminaGenerationTask(input, { client: client as never, onTaskUpdate }, signal),
            createId: () => runtimeTaskId,
            now: () => "2026-08-14T00:00:02.000Z",
        },
    );

    await waitStarted;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    expect(requests).toEqual(["/dreamina/generate", "/dreamina/generate/wait"]);
    expect(updates.at(-1)).toMatchObject({
        id: `dreamina:${runtimeTaskId}`,
        status: "running",
        stage: "submitted",
        receiptRecorded: true,
    });
    expect(updates.some((task) => task.status === "cancelled")).toBe(false);
});

test("an accepted Dreamina detach stays running across Tasks, Create, Canvas, and batches", () => {
    const task = projectLocalDreaminaTask({
        id: "dreamina-local-stop-only-0001",
        provider: "dreamina-cli",
        mode: "video",
        operation: "text2video",
        model: "seedance2.0",
        status: "cancelled",
        stage: "cancelled",
        receiptRecorded: true,
        lifecycle: "ACCEPTED",
        errorCode: "dreamina_local_wait_stopped",
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:01:00.000Z",
    });

    expect(task.status).toBe("running");
    expect(task.error).toBeUndefined();
    expect(task.providerCancelStatus).toBeUndefined();
    expect(task.providerCancelError).toBeUndefined();
    expect(localDreaminaCancellationCopy(task)).toEqual({
        kind: "background",
        action: "转入后台",
        confirmation: "任务已由官方接受；转入后台后仍会继续同步官方状态。",
    });
    expect(localDreaminaDetachOutcome(task)).toEqual({
        kind: "background",
        message: "任务已转入后台，官方状态会继续同步。",
        taskStatus: "running",
        creationStatus: "pending",
        canvasNodeStatus: "loading",
        batchItemStatus: "running",
    });

    const queued = { ...task, status: "queued" as const, stage: "queued", receiptRecorded: false };
    expect(localDreaminaCancellationCopy(queued)).toEqual({
        kind: "cancel",
        action: "取消任务",
        confirmation: "任务尚未提交官方，可以安全取消本机任务。",
    });
    expect(localDreaminaCancellationCopy({ ...task, id: "backend-task-0001" })).toBeUndefined();
});

test("bare official failed status stays neutral because it can represent remote cancellation", () => {
    const task = projectLocalDreaminaTask({
        id: "dreamina-official-incomplete-0001",
        provider: "dreamina-cli",
        mode: "video",
        operation: "text2video",
        model: "seedance2.0",
        status: "failed",
        stage: "failed",
        receiptRecorded: true,
        errorCode: "dreamina_official_incomplete",
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:01:00.000Z",
    });

    expect(task).toMatchObject({
        status: "failed",
        errorCode: "dreamina_official_incomplete",
        error: "官方任务未完成；可能已在官方取消或生成失败。",
    });
    expect(task.error).not.toContain("确定失败");
});

test("the shared generation entry keeps an accepted background update running", async () => {
    const updates: Array<{ status: string; error?: string; errorCode?: string; receiptRecorded?: boolean }> = [];
    const timestamp = "2026-08-12T00:00:00.000Z";

    await expect(
        runBackendGenerationTask(
            {
                mode: "video",
                prompt: "A clip still running officially",
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0", videoSeconds: "4", vquality: "720" },
                onTaskUpdate: (task) => updates.push(task),
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async (input, _signal, onTaskUpdate) => {
                    onTaskUpdate?.({
                        id: input.idempotencyKey!,
                        provider: "dreamina-cli",
                        mode: "video",
                        operation: "text2video",
                        model: "seedance2.0",
                        status: "cancelled",
                        stage: "cancelled",
                        receiptRecorded: true,
                        lifecycle: "ACCEPTED",
                        errorCode: "dreamina_local_wait_stopped",
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    });
                    return {
                        mode: "video" as const,
                        video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 },
                    };
                },
                createId: () => "dreamina-shared-local-stop-0001",
                now: () => timestamp,
            },
        ),
    ).resolves.toMatchObject({ mode: "video" });

    const accepted = updates.find((task) => task.receiptRecorded);
    expect(accepted).toMatchObject({ status: "running", receiptRecorded: true });
    expect(accepted?.error).toBeUndefined();
    expect(updates.some((task) => task.status === "cancelled" || task.status === "failed")).toBe(false);
});

test("the shared generation entry projects a paid POST abort as submission unknown, never cancelled", async () => {
    const updates: Array<{ status: string; stage?: string; errorCode?: string }> = [];
    const controller = new AbortController();

    await expect(
        runBackendGenerationTask(
            {
                mode: "video",
                prompt: "A paid request with an unknown receipt",
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0", videoSeconds: "4", vquality: "720" },
                signal: controller.signal,
                onTaskUpdate: (task) => updates.push(task),
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async () => {
                    controller.abort();
                    throw new LocalDreaminaGenerationClientError("dreamina_submission_unknown", "提交结果未知", 502);
                },
                createId: () => "dreamina-shared-submit-unknown-0001",
                now: () => "2026-08-12T00:00:00.000Z",
            },
        ),
    ).rejects.toMatchObject({ code: "dreamina_submission_unknown" });

    expect(updates.at(-1)).toMatchObject({
        status: "failed",
        stage: "local_cli_failed",
        errorCode: "dreamina_submission_unknown",
    });
    expect(updates.some((task) => task.status === "cancelled")).toBe(false);
});

test("the shared local boundary emits correlation before reference preparation fails", async () => {
    const updates: GenerationTask[] = [];
    let localCalls = 0;

    await expect(
        runBackendGenerationTask(
            {
                mode: "video",
                prompt: "fixture",
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0", videoSeconds: "4", vquality: "720" },
                referenceImages: [{ id: "bad-reference", name: "bad.txt", url: "data:text/plain;base64,QQ==", mimeType: "text/plain", size: 1 }],
                metadata: { videoEditOperation: "image_to_video" },
                onTaskUpdate: (task) => updates.push(task),
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async () => {
                    localCalls += 1;
                    throw new Error("must not reach Runtime");
                },
                createId: () => "dreamina-reference-boundary-0001",
                now: () => "2026-08-12T00:00:00.000Z",
            },
        ),
    ).rejects.toMatchObject({ code: "dreamina_reference_invalid" });

    expect(localCalls).toBe(0);
    expect(updates[0]).toMatchObject({
        id: "dreamina:dreamina-reference-boundary-0001",
        status: "running",
        stage: "submitting",
        operation: "image_to_video",
        createdAt: "2026-08-12T00:00:00.000Z",
    });
    expect(updates.at(-1)).toMatchObject({
        id: "dreamina:dreamina-reference-boundary-0001",
        status: "failed",
        errorCode: "dreamina_reference_invalid",
    });
});

test("the shared local boundary preserves correlation and stable session preflight errors", async () => {
    const updates: GenerationTask[] = [];

    await expect(
        runBackendGenerationTask(
            {
                mode: "video",
                prompt: "fixture",
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0", videoSeconds: "4", vquality: "720" },
                onTaskUpdate: (task) => updates.push(task),
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async () => {
                    throw new LocalDreaminaGenerationClientError("origin_not_trusted", "本机连接需要重新建立", 403);
                },
                createId: () => "dreamina-session-boundary-0001",
                now: () => "2026-08-12T00:00:00.000Z",
            },
        ),
    ).rejects.toMatchObject({ code: "origin_not_trusted" });

    expect(updates.map((task) => task.id)).toEqual(["dreamina:dreamina-session-boundary-0001", "dreamina:dreamina-session-boundary-0001"]);
    expect(updates[0]).toMatchObject({ status: "running", stage: "submitting", operation: "text_to_video" });
    expect(updates.at(-1)).toMatchObject({ status: "failed", errorCode: "origin_not_trusted" });
});

test("four identical Dreamina user operations receive four independent task ids", async () => {
    const ids = ["dreamina-identical-click-0001", "dreamina-identical-click-0002", "dreamina-identical-click-0003", "dreamina-identical-click-0004"];
    const submitted: string[] = [];
    let index = 0;
    const dependencies = {
        createTask: async () => {
            throw new Error("must not post /tasks");
        },
        waitTask: async () => {
            throw new Error("must not wait Backend task");
        },
        runLocal: async (input: LocalDreaminaGenerationInput) => {
            submitted.push(input.idempotencyKey!);
            return { mode: "video" as const, video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
        },
        createId: () => ids[index++]!,
        now: () => "2026-08-12T00:00:00.000Z",
    };

    await Promise.all(
        Array.from({ length: 4 }, () =>
            runBackendGenerationTask(
                {
                    mode: "video",
                    prompt: "same prompt",
                    config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0", videoSeconds: "4", vquality: "720" },
                },
                dependencies,
            ),
        ),
    );

    expect(submitted).toEqual(ids);
});

test("Create observes local Dreamina tasks by wait while remote providers keep polling", () => {
    expect(splitGenerationTaskObservationIds(["remote-task-0001", "dreamina:dreamina-local-task-0001", "remote-task-0002"])).toEqual({
        localWaitIds: ["dreamina:dreamina-local-task-0001"],
        remotePollIds: ["remote-task-0001", "remote-task-0002"],
    });
});

test("task center cursor-merges more than 100 Backend/local tasks and preserves project filtering for local history", async () => {
    const makeBackendTask = (id: string, projectId: string, updatedAt: string): GenerationTask => ({
        id,
        projectId,
        type: "canvas_video",
        status: "succeeded",
        prompt: id,
        attempts: 1,
        createdAt: updatedAt,
        updatedAt,
    });
    const makeLocalTask = (id: string, projectId: string, updatedAt: string) => ({
        id,
        provider: "dreamina-cli" as const,
        mode: "video" as const,
        operation: "text2video",
        model: "seedance2.5",
        status: "succeeded" as const,
        stage: "completed" as const,
        receiptRecorded: true,
        context: { scope: "scoped" as const, projectId },
        createdAt: updatedAt,
        updatedAt,
    });
    const backendPages = new Map<string | undefined, { tasks: GenerationTask[]; nextCursor?: string }>([
        [undefined, { tasks: Array.from({ length: 70 }, (_, index) => makeBackendTask(`backend-page-1-${index.toString().padStart(3, "0")}`, "project-0001", `2026-08-13T10:${String(index % 60).padStart(2, "0")}:00.000Z`)), nextCursor: "backend:2" }],
        ["backend:2", { tasks: Array.from({ length: 60 }, (_, index) => makeBackendTask(`backend-page-2-${index.toString().padStart(3, "0")}`, "project-0001", `2026-08-13T09:${String(index % 60).padStart(2, "0")}:00.000Z`)) }],
    ]);
    const localPages = new Map<string | undefined, { tasks: ReturnType<typeof makeLocalTask>[]; nextCursor?: string }>([
        [
            undefined,
            {
                tasks: [
                    ...Array.from({ length: 40 }, (_, index) => makeLocalTask(`local-page-1-${index.toString().padStart(3, "0")}`, "project-0001", `2026-08-13T11:${String(index % 60).padStart(2, "0")}:00.000Z`)),
                    makeLocalTask("local-other-project-0001", "project-0002", "2026-08-13T11:59:59.000Z"),
                ],
                nextCursor: "local:2",
            },
        ],
        ["local:2", { tasks: Array.from({ length: 35 }, (_, index) => makeLocalTask(`local-page-2-${index.toString().padStart(3, "0")}`, "project-0001", `2026-08-13T08:${String(index % 60).padStart(2, "0")}:00.000Z`)) }],
    ]);
    const backendRequests: unknown[] = [];
    const localRequests: unknown[] = [];

    const tasks = await listGenerationTasks(205, { projectId: "project-0001" }, {
        async listBackendPage(request: unknown) {
            backendRequests.push(request);
            const cursor = typeof request === "object" && request && "cursor" in request ? String((request as { cursor?: string }).cursor || "") || undefined : undefined;
            return backendPages.get(cursor) as never;
        },
        async listLocalPage(request: unknown) {
            localRequests.push(request);
            const cursor = typeof request === "object" && request && "cursor" in request ? String((request as { cursor?: string }).cursor || "") || undefined : undefined;
            return localPages.get(cursor) as never;
        },
    } as never);

    expect(backendRequests).toEqual([
        { limit: 100, projectId: "project-0001", activeOnly: false },
        { limit: 100, projectId: "project-0001", activeOnly: false, cursor: "backend:2" },
    ]);
    expect(localRequests).toEqual([
        { limit: 100, projectId: "project-0001", activeOnly: false },
        { limit: 100, projectId: "project-0001", activeOnly: false, cursor: "local:2" },
    ]);
    expect(tasks).toHaveLength(205);
    expect(tasks.some((task) => task.id === "dreamina:local-other-project-0001")).toBe(false);
    expect(tasks.filter((task) => task.provider === "dreamina-cli")).toHaveLength(75);
});

test("task center merges durable local Dreamina summaries without creating Backend tasks", async () => {
    const calls: string[] = [];
    const backendTask: GenerationTask = {
        id: "backend-task-0001",
        type: "canvas_video",
        status: "running",
        prompt: "backend prompt",
        attempts: 1,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:01:00.000Z",
    };
    const tasks = await listGenerationTasks(30, undefined, {
        async listBackend(limit) {
            calls.push(`backend:${limit}`);
            return [backendTask];
        },
        async listLocal() {
            calls.push("local:list");
            return [
                {
                    id: "dreamina-task-center-0001",
                    provider: "dreamina-cli" as const,
                    mode: "video" as const,
                    operation: "text2video",
                    model: "seedance2.0",
                    status: "running" as const,
                    stage: "submitted" as const,
                    receiptRecorded: true,
                    createdAt: "2026-08-12T00:02:00.000Z",
                    updatedAt: "2026-08-12T00:03:00.000Z",
                },
            ];
        },
    });

    expect(calls).toEqual(["backend:30", "local:list"]);
    expect(tasks.map((task) => task.id)).toEqual(["dreamina:dreamina-task-center-0001", "backend-task-0001"]);
    expect(tasks[0]).toMatchObject({ provider: "dreamina-cli", prompt: "", status: "running" });
});

test("project task lists include only durably scoped local Dreamina summaries", async () => {
    let localReads = 0;
    const tasks = await listGenerationTasks(
        30,
        { projectId: "project-0001" },
        {
            async listBackend() {
                return [];
            },
            async listLocal() {
                localReads += 1;
                const base = {
                    provider: "dreamina-cli" as const,
                    mode: "video" as const,
                    operation: "text2video",
                    model: "seedance2.0",
                    status: "running" as const,
                    stage: "submitted" as const,
                    receiptRecorded: true,
                    createdAt: "2026-08-12T00:00:00.000Z",
                    updatedAt: "2026-08-12T00:01:00.000Z",
                };
                return [
                    { ...base, id: "dreamina-project-scoped-0001", context: { scope: "scoped" as const, projectId: "project-0001", nodeId: "node-scoped-0001" } },
                    { ...base, id: "dreamina-project-other-0001", context: { scope: "scoped" as const, projectId: "project-0002", nodeId: "node-other-0001" } },
                    { ...base, id: "dreamina-project-legacy-0001", context: { scope: "legacy_unscoped" as const } },
                ];
            },
        },
    );

    expect(localReads).toBe(1);
    expect(tasks.map((task) => task.id)).toEqual(["dreamina:dreamina-project-scoped-0001"]);
    expect(tasks[0]).toMatchObject({
        projectId: "project-0001",
        clientContext: { nodeId: "node-scoped-0001" },
    });
});

test("task log projection drops raw token, path, prompt, and stderr while keeping safe structured fields", () => {
    const log = projectBackendSafeTaskLog(
        "backend-task-safe-log-0001",
        {
            level: "error",
            message: "submitting token=secret prompt=private C:\\Users\\private\\clip.mp4 dreamina_query_failed",
            payload: "stderr=private-cookie provider_access_denied",
            createdAt: "2026-08-13T12:00:00.000Z",
        },
        0,
    );
    expect(log).toEqual({
        id: "safe:backend-task-safe-log-0001:0",
        taskId: "backend-task-safe-log-0001",
        level: "error",
        stage: "submitting",
        errorCode: "dreamina_query_failed",
        provenance: "backend",
        createdAt: "2026-08-13T12:00:00.000Z",
    });
    const serialized = JSON.stringify(log);
    expect(serialized).not.toMatch(/secret|private|cookie|stderr|prompt|Users|clip\.mp4/i);
    expect(formatTaskLog(log)).toBe("stage=submitting error=dreamina_query_failed provenance=backend");
});

test("task log projection allowlists stable public error codes and drops shaped secret-like codes", () => {
    for (const [index, unsafeCode] of ["provider_token_secretvalue", "provider_cookie_private", "dreamina_receipt_secret"].entries()) {
        const log = projectBackendSafeTaskLog(
            `backend-task-unsafe-log-${index}`,
            {
                level: "error",
                message: unsafeCode,
                createdAt: "2026-08-13T12:00:00.000Z",
            },
            index,
        );
        expect(log).not.toHaveProperty("errorCode");
        expect(JSON.stringify(log)).not.toContain(unsafeCode);
        expect(formatTaskLog(log)).toBe("stage=backend_event provenance=backend");
    }

    const safeLog = projectBackendSafeTaskLog(
        "backend-task-public-log-0001",
        {
            level: "error",
            message: "dreamina_query_failed",
            createdAt: "2026-08-13T12:00:00.000Z",
        },
        0,
    );
    expect(safeLog.errorCode).toBe("dreamina_query_failed");
    expect(formatTaskLog(safeLog)).toBe("stage=backend_event error=dreamina_query_failed provenance=backend");
});

test("Dreamina local video forwards product resolution values to the final CLI adapter", async () => {
    const cases = ["480", "720", "1080", "2160"] as const;

    for (const createValue of cases) {
        let localInput: LocalDreaminaGenerationInput | undefined;
        await runBackendGenerationTask(
            {
                mode: "video",
                prompt: "A short test clip",
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0_vip", videoSeconds: "4", vquality: createValue },
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async (input) => {
                    localInput = input;
                    return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
                },
                createId: () => `dreamina-video-resolution-${createValue}`,
                now: () => "2026-08-11T00:00:00.000Z",
            },
        );
        expect(localInput?.settings.resolution).toBe(createValue);
    }
});

test("Dreamina local image forwards Create auto and explicit tiers to the final CLI adapter", async () => {
    const cases = [
        ["auto", "auto"],
        ["1k", "1k"],
        ["2k", "2k"],
        ["4k", "4k"],
    ] as const;

    for (const [createValue, runtimeValue] of cases) {
        let localInput: LocalDreaminaGenerationInput | undefined;
        await runBackendGenerationTask(
            {
                mode: "image",
                prompt: "A small test image",
                config: { ...defaultConfig, model: "local:dreamina-cli:5.0Pro", quality: createValue },
            },
            {
                createTask: async () => {
                    throw new Error("must not post /tasks");
                },
                waitTask: async () => {
                    throw new Error("must not wait Backend task");
                },
                runLocal: async (input) => {
                    localInput = input;
                    return { mode: "image", images: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }] };
                },
                createId: () => `dreamina-image-resolution-${createValue}`,
                now: () => "2026-08-11T00:00:00.000Z",
            },
        );
        expect(localInput?.settings.resolution).toBe(runtimeValue);
    }
});

test("Canvas shared generation entry uses the same Dreamina resolution boundary for video and image", async () => {
    const localInputs: LocalDreaminaGenerationInput[] = [];
    const dependencies = {
        createTask: async () => {
            throw new Error("must not post /tasks");
        },
        waitTask: async () => {
            throw new Error("must not wait Backend task");
        },
        runLocal: async (input: LocalDreaminaGenerationInput) => {
            localInputs.push(input);
            return input.mode === "video"
                ? { mode: "video" as const, video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } }
                : { mode: "image" as const, images: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }] };
        },
        createId: () => `dreamina-canvas-route-${localInputs.length + 1}`,
        now: () => "2026-08-11T00:00:00.000Z",
    };

    await runBackendCanvasGenerationTask(
        {
            projectId: "canvas-project",
            nodeId: "video-node",
            mode: "video",
            prompt: "A short test clip",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
        },
        dependencies,
    );
    await runBackendCanvasGenerationTask(
        {
            projectId: "canvas-project",
            nodeId: "image-node",
            mode: "image",
            prompt: "A small test image",
            config: { ...defaultConfig, model: "local:dreamina-cli:5.0Pro", quality: "auto" },
        },
        dependencies,
    );

    expect(localInputs[0]?.settings.resolution).toBe("720");
    expect(localInputs[1]?.settings.resolution).toBe("auto");
    expect((localInputs[0] as unknown as { context?: unknown }).context).toEqual({
        scope: "scoped",
        projectId: "canvas-project",
        nodeId: "video-node",
    });
    expect((localInputs[1] as unknown as { context?: unknown }).context).toEqual({
        scope: "scoped",
        projectId: "canvas-project",
        nodeId: "image-node",
    });
});

test("shared local Dreamina boundary preserves image video and audio references as typed bytes", async () => {
    let localInput: LocalDreaminaGenerationInput | undefined;
    await runBackendGenerationTask(
        {
            projectId: "project-multimodal-0001",
            mode: "video",
            prompt: "Multimodal fixture",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.5", videoSeconds: "4", vquality: "720" },
            referenceImages: [
                {
                    id: "image-reference-0001",
                    name: "image.png",
                    type: "image/png",
                    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
                },
            ],
            referenceVideos: [
                {
                    id: "video-reference-0001",
                    name: "video.mp4",
                    type: "video/mp4",
                    url: "data:video/mp4;base64,AAAA",
                },
            ],
            referenceAudios: [
                {
                    id: "audio-reference-0001",
                    name: "audio.mp3",
                    type: "audio/mpeg",
                    url: "data:audio/mpeg;base64,SUQz",
                },
            ],
            metadata: { nodeId: "node-multimodal-0001", conversationId: "conversation-multimodal-0001", messageId: "message-multimodal-0001" },
        },
        {
            createTask: async () => {
                throw new Error("must not post /tasks");
            },
            waitTask: async () => {
                throw new Error("must not wait Backend task");
            },
            runLocal: async (input) => {
                localInput = input;
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
            createId: () => "dreamina-multimodal-shared-0001",
            now: () => "2026-08-13T00:00:00.000Z",
        },
    );

    expect((localInput as unknown as { references: Array<{ kind: string; mimeType: string; bytes: Uint8Array }>; context?: unknown }).references.map((reference) => [reference.kind, reference.mimeType, reference.bytes.byteLength])).toEqual([
        ["image", "image/png", 8],
        ["video", "video/mp4", 3],
        ["audio", "audio/mpeg", 3],
    ]);
    expect((localInput as unknown as { context?: unknown }).context).toEqual({
        scope: "scoped",
        projectId: "project-multimodal-0001",
        nodeId: "node-multimodal-0001",
        conversationId: "conversation-multimodal-0001",
        messageId: "message-multimodal-0001",
    });
});

test("remote provider keeps Create resolution semantics and still creates one Backend task", async () => {
    let backendInput: Parameters<Parameters<typeof runBackendGenerationTask>[1]["createTask"]>[0] | undefined;
    let localCalls = 0;
    const task = {
        id: "remote-task-0001",
        type: "canvas_video",
        status: "running" as const,
        progress: 10,
        attempts: 1,
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
    };
    await runBackendGenerationTask(
        {
            mode: "video",
            prompt: "A remote test clip",
            config: { ...defaultConfig, model: "default::grok-imagine-video", vquality: "720", quality: "auto" },
        },
        {
            createTask: async (input) => {
                backendInput = input;
                return task;
            },
            waitTask: async () => ({ ...task, status: "succeeded", resultJson: JSON.stringify({ mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } }) }),
            runLocal: async () => {
                localCalls += 1;
                throw new Error("must not use Local Runtime");
            },
            createId: () => "unused-local-id-0001",
            now: () => "2026-08-11T00:00:00.000Z",
        },
    );

    expect(backendInput?.input.config).toMatchObject({ vquality: "720", quality: "auto" });
    expect(localCalls).toBe(0);
});

test("remote image video and audio references keep Backend parity without Dreamina CLI fields", async () => {
    const backendInputs: Array<Record<string, unknown>> = [];
    let localCalls = 0;
    const baseTask = {
        type: "canvas_media",
        status: "running" as const,
        prompt: "fixture",
        attempts: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const cases = [
        {
            mode: "image" as const,
            references: { referenceImages: [{ id: "remote-image-0001", name: "image.png", type: "image/png", dataUrl: "", storageKey: "resource:remote-image-0001" }] },
            result: { mode: "image", images: [{ dataUrl: "opaque://image", storageKey: "resource:remote-image-output" }] },
            operation: "image",
        },
        {
            mode: "video" as const,
            references: { referenceVideos: [{ id: "remote-video-0001", name: "video.mp4", type: "video/mp4", url: "", storageKey: "resource:remote-video-0001" }] },
            result: { mode: "video", video: { dataUrl: "opaque://video", storageKey: "resource:remote-video-output" } },
            operation: "reference_to_video",
        },
        {
            mode: "video" as const,
            references: {
                referenceImages: [{ id: "remote-image-audio-image-0001", name: "reference.png", type: "image/png", dataUrl: "", storageKey: "resource:remote-image-audio-image-0001" }],
                referenceAudios: [{ id: "remote-image-audio-audio-0001", name: "reference.mp3", type: "audio/mpeg", url: "", storageKey: "resource:remote-image-audio-audio-0001" }],
            },
            result: { mode: "video", video: { dataUrl: "opaque://video", storageKey: "resource:remote-image-audio-output" } },
            operation: "image_to_video",
        },
        {
            mode: "audio" as const,
            references: { referenceAudios: [{ id: "remote-audio-0001", name: "audio.mp3", type: "audio/mpeg", url: "", storageKey: "resource:remote-audio-0001" }] },
            result: { mode: "audio", audio: { dataUrl: "opaque://audio", storageKey: "resource:remote-audio-output" } },
            operation: "audio",
        },
    ];

    for (const [index, item] of cases.entries()) {
        const task = { ...baseTask, id: `remote-parity-${index}-0001`, operation: item.operation };
        await runBackendGenerationTask(
            {
                mode: item.mode,
                prompt: "Remote parity fixture",
                config: { ...defaultConfig, model: "default::provider-neutral-model" },
                ...item.references,
            },
            {
                createTask: async (input) => {
                    backendInputs.push(input as unknown as Record<string, unknown>);
                    return task;
                },
                waitTask: async () => ({ ...task, status: "succeeded", resultJson: JSON.stringify(item.result) }),
                runLocal: async () => {
                    localCalls += 1;
                    throw new Error("must not use Local Runtime");
                },
                createId: () => "unused-remote-parity-id",
                now: () => "2026-08-13T00:00:00.000Z",
            },
        );
    }

    expect(localCalls).toBe(0);
    expect(backendInputs.map((input) => input.operation)).toEqual(cases.map((item) => item.operation));
    for (const input of backendInputs) {
        const serialized = JSON.stringify(input);
        expect(serialized).not.toMatch(/dreamina|frames2video|multimodal2video|clientOperationId|idempotencyKey|contentBase64/);
    }
});

test("shared task subscription reconnects Create and agents to one durable task observation", async () => {
    const module = await import("../src/services/api/task-center");
    const createService = (module as { createGenerationTaskSubscriptionService?: Function }).createGenerationTaskSubscriptionService;
    expect(typeof createService).toBe("function");
    if (!createService) return;

    let queryCalls = 0;
    let waitCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const context = { conversationId: "conversation-subscription-0001", messageId: "message-subscription-0001" };
    const running: GenerationTask = {
        id: "dreamina:shared-subscription-0001",
        projectId: "project-subscription-0001",
        type: "canvas_video",
        status: "running",
        prompt: "fixture",
        attempts: 1,
        clientContext: context,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const service = createService({
        queryTask: async () => {
            queryCalls += 1;
            return running;
        },
        waitTask: async () => {
            waitCalls += 1;
            await gate;
            return { ...running, status: "succeeded", updatedAt: "2026-08-13T00:01:00.000Z" };
        },
    }) as { subscribe(ids: string[], listener: (task: GenerationTask) => void): () => void };
    const first: GenerationTask[] = [];
    const second: GenerationTask[] = [];
    const disconnect = service.subscribe([running.id], (task) => first.push(task));
    await Promise.resolve();
    disconnect();
    const disconnectAfterRefresh = service.subscribe([running.id], (task) => second.push(task));
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    disconnectAfterRefresh();

    expect(queryCalls).toBe(1);
    expect(waitCalls).toBe(1);
    expect(second.at(-1)).toMatchObject({ id: running.id, projectId: running.projectId, clientContext: context, status: "succeeded" });
});

test("online and local agent run_generation persists conversation and message context through shared task creation", async () => {
    const node: CanvasNodeData = {
        id: "video-node",
        type: CanvasNodeType.Video,
        title: "Video",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { generationMode: "video", composerContent: "A shared agent prompt", vquality: "720" },
    };
    const localInputs: LocalDreaminaGenerationInput[] = [];
    const createdTasks: GenerationTask[] = [];
    const subscriptions = new Map<string, (task: GenerationTask) => void>();
    const dependencies = {
        createTask: async () => {
            throw new Error("must not post /tasks");
        },
        waitTask: async () => {
            throw new Error("must not wait Backend task");
        },
        runLocal: async (input: LocalDreaminaGenerationInput) => {
            localInputs.push(input);
            return { mode: "video" as const, video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
        },
        createId: () => `agent-task-${localInputs.length + 1}`,
        now: () => "2026-08-13T00:00:00.000Z",
    };
    const generate = async (
        nodeId: string,
        generationMode: Parameters<typeof runBackendCanvasGenerationTask>[0]["mode"],
        generationPrompt: string,
        options?: { context?: { conversationId?: string; messageId?: string }; onTaskUpdate?: (task: GenerationTask) => void },
    ) => {
        await runBackendCanvasGenerationTask(
            {
                projectId: "agent-project-0001",
                nodeId,
                mode: generationMode,
                prompt: generationPrompt,
                config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
                metadata: options?.context,
                onTaskCreated: (task) => {
                    createdTasks.push(task);
                    options?.onTaskUpdate?.(task);
                    subscriptions.get(task.id)?.(task);
                },
            },
            dependencies,
        );
    };
    const subscribeTasks = (ids: readonly string[], listener: (task: GenerationTask) => void) => {
        ids.forEach((id) => subscriptions.set(id, listener));
        return () => ids.forEach((id) => subscriptions.delete(id));
    };

    for (const source of ["online", "local"] as const) {
        await runCanvasAgentGenerationOps({
            generationOps: [{ type: "run_generation", nodeId: node.id }],
            nodes: [node],
            generate,
            subscribeTasks,
            consumeTask: async (task, continuationId, consumer) => {
                await consumer({ task, effectKey: `agent-resume:${task.id}:${continuationId}` });
                return task;
            },
            context: { source, conversationId: `${source}-conversation-0001`, messageId: `${source}-message-0001` },
        });
    }

    expect(localInputs.map((input) => input.context)).toEqual([
        { scope: "scoped", projectId: "agent-project-0001", nodeId: node.id, conversationId: "online-conversation-0001", messageId: "online-message-0001" },
        { scope: "scoped", projectId: "agent-project-0001", nodeId: node.id, conversationId: "local-conversation-0001", messageId: "local-message-0001" },
    ]);
    expect(
        createdTasks
            .filter((task) => task.status === "running")
            .map((task) => ({
                projectId: task.projectId,
                clientContext: task.clientContext,
            })),
    ).toEqual([
        { projectId: "agent-project-0001", clientContext: { nodeId: node.id, conversationId: "online-conversation-0001", messageId: "online-message-0001" } },
        { projectId: "agent-project-0001", clientContext: { nodeId: node.id, conversationId: "local-conversation-0001", messageId: "local-message-0001" } },
    ]);
});

test("online agent generation tools preserve product values and emit the same generic run operation", () => {
    const snapshot = { projectId: "canvas-project", title: "Canvas", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const generated = onlineToolToOps("canvas_generate_video", { prompt: "A short test clip", seconds: "4", vquality: "720" }, snapshot, defaultConfig);
    const target = generated.find((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Video);
    const run = generated.find((op) => op.type === "run_generation");
    expect(target?.metadata?.vquality).toBe("720");
    expect(run && { type: run.type, nodeId: run.nodeId, mode: run.mode }).toEqual({ type: "run_generation", nodeId: target?.id, mode: "video" });

    expect(onlineToolToOps("canvas_run_generation", { nodeId: "video-node", mode: "video", prompt: "Retry video" }, snapshot, defaultConfig)).toEqual([{ type: "run_generation", nodeId: "video-node", mode: "video", prompt: "Retry video" }]);
    expect(onlineToolToOps("canvas_run_generation", { nodeId: "video-node", mode: "video", prompt: "Retry video", retry: true }, snapshot, defaultConfig)).toEqual([
        { type: "run_generation", nodeId: "video-node", mode: "video", prompt: "Retry video", retry: true },
    ]);
});

test("Canvas image video audio executors hand one terminal task to the unified consumer", async () => {
    const consumed: Array<{ mode: string; taskId: string; outputType?: string }> = [];
    for (const mode of ["image", "video", "audio"] as const) {
        const task: GenerationTask = {
            id: `terminal-${mode}-task-0001`,
            projectId: "canvas-consumer-project",
            type: `canvas_${mode}`,
            status: "succeeded",
            prompt: "fixture",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: mode, materializedAssetId: `asset-${mode}-0001` }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:01:00.000Z",
        };
        const result = await runCanvasGenerationTaskToConsumer(
            {
                projectId: "canvas-consumer-project",
                nodeId: `node-${mode}-0001`,
                mode,
                prompt: "fixture",
                config: defaultConfig,
            },
            {
                runTask: async (options) => {
                    options.onTaskCreated?.({ ...task, status: "running" });
                    options.onTaskCreated?.(task);
                    return mode === "image" ? { mode, images: [{ dataUrl: "opaque://image" }] } : mode === "video" ? { mode, video: { dataUrl: "opaque://video" } } : { mode, audio: { dataUrl: "opaque://audio" } };
                },
                bindTask: () => undefined,
                consumeTask: async (completed) => {
                    consumed.push({ mode, taskId: completed.id, outputType: completed.outputs?.[0]?.mediaType });
                },
            },
        );
        expect(result.mode).toBe(mode);
    }

    expect(consumed).toEqual([
        { mode: "image", taskId: "terminal-image-task-0001", outputType: "image" },
        { mode: "video", taskId: "terminal-video-task-0001", outputType: "video" },
        { mode: "audio", taskId: "terminal-audio-task-0001", outputType: "audio" },
    ]);
});

test("Create audio upload converts, previews, removes, and submits through the shared generation task contract", async () => {
    const creationAssets = (await import("../src/pages/create/creation-assets")) as unknown as {
        creationUploadAccept?: (mode: "text" | "image" | "video") => string;
        creationFileAccepted?: (mode: "text" | "image" | "video", file: File) => boolean;
        creationAttachmentFromAudio?: (
            file: File,
            uploaded: { url: string; storageKey: string; bytes: number; mimeType: string; durationMs?: number },
        ) => {
            id: string;
            name: string;
            type: string;
            url: string;
            storageKey: string;
            previewUrl: string;
        };
        creationAttachmentFromAudioAsset?: (asset: { id: string; kind: "audio"; title: string; coverUrl: string; data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number } }) => {
            id: string;
            type: string;
            url: string;
            storageKey?: string;
            previewUrl: string;
        };
        splitCreationAttachments?: (attachments: unknown[]) => {
            referenceImages: unknown[];
            referenceVideos: unknown[];
            referenceAudios: unknown[];
        };
        creationAttachmentPreview?: (attachment: unknown) => { kind: "image" | "video" | "audio"; url: string };
        removeCreationAttachment?: <T extends { id: string }>(attachments: T[], id: string) => T[];
    };
    expect(typeof creationAssets.creationUploadAccept).toBe("function");
    expect(typeof creationAssets.creationFileAccepted).toBe("function");
    expect(typeof creationAssets.creationAttachmentFromAudio).toBe("function");
    expect(typeof creationAssets.creationAttachmentFromAudioAsset).toBe("function");
    expect(typeof creationAssets.splitCreationAttachments).toBe("function");
    expect(typeof creationAssets.creationAttachmentPreview).toBe("function");
    expect(typeof creationAssets.removeCreationAttachment).toBe("function");
    if (
        !creationAssets.creationUploadAccept ||
        !creationAssets.creationFileAccepted ||
        !creationAssets.creationAttachmentFromAudio ||
        !creationAssets.creationAttachmentFromAudioAsset ||
        !creationAssets.splitCreationAttachments ||
        !creationAssets.creationAttachmentPreview ||
        !creationAssets.removeCreationAttachment
    )
        return;

    const audioFile = new File([new Uint8Array([0x49, 0x44, 0x33, 4])], "reference.mp3", { type: "audio/mpeg" });
    expect(creationAssets.creationUploadAccept("video")).toBe("image/*,video/*,audio/*");
    expect(creationAssets.creationFileAccepted("video", audioFile)).toBe(true);
    expect(creationAssets.creationFileAccepted("image", audioFile)).toBe(false);

    const attachment = creationAssets.creationAttachmentFromAudio(audioFile, {
        url: "blob:reference-audio",
        storageKey: "resource:create-audio-0001",
        bytes: 4,
        mimeType: "audio/mpeg",
        durationMs: 1_000,
    });
    const libraryAttachment = creationAssets.creationAttachmentFromAudioAsset({
        id: "audio-asset-0001",
        kind: "audio",
        title: "Library audio",
        coverUrl: "",
        data: {
            url: "blob:library-audio",
            storageKey: "resource:create-audio-0002",
            bytes: 4,
            mimeType: "audio/mpeg",
            durationMs: 1_000,
        },
    });
    expect(creationAssets.creationAttachmentPreview(attachment)).toEqual({ kind: "audio", url: "blob:reference-audio" });
    expect(creationAssets.removeCreationAttachment([attachment, libraryAttachment], attachment.id)).toEqual([libraryAttachment]);

    const references = creationAssets.splitCreationAttachments([attachment]);
    expect(references.referenceImages).toEqual([]);
    expect(references.referenceVideos).toEqual([]);
    expect(references.referenceAudios).toEqual([attachment]);

    let createdInput: unknown;
    const running: GenerationTask = {
        id: "create-audio-task-0001",
        projectId: "create-audio-project-0001",
        type: "canvas_video",
        status: "running",
        prompt: "Animate with audio",
        attempts: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await runBackendGenerationTask(
        {
            projectId: running.projectId,
            mode: "video",
            prompt: running.prompt,
            config: { ...defaultConfig, model: "remote-video-audio-fixture", videoModel: "remote-video-audio-fixture" },
            ...references,
        } as Parameters<typeof runBackendGenerationTask>[0],
        {
            createTask: async (input) => {
                createdInput = input;
                return running;
            },
            waitTask: async () => ({
                ...running,
                status: "succeeded",
                resultJson: JSON.stringify({ mode: "video", video: { dataUrl: "opaque://video" } }),
                updatedAt: "2026-08-13T00:01:00.000Z",
            }),
            runLocal: async () => {
                throw new Error("must not use local Runtime");
            },
            createId: () => "unused-create-audio-id",
            now: () => "2026-08-13T00:00:00.000Z",
        },
    );

    const submitted = createdInput as {
        operation?: string;
        input?: { referenceAudios?: Array<Record<string, unknown>> };
    };
    expect(submitted.operation).toBe("audio_to_video");
    expect(submitted.input?.referenceAudios).toEqual([
        {
            id: attachment.id,
            name: "reference.mp3",
            type: "audio/mpeg",
            url: "",
            storageKey: "resource:create-audio-0001",
            bytes: 4,
            durationMs: 1_000,
        },
    ]);
    expect(submitted.input?.referenceAudios?.[0]).not.toHaveProperty("previewUrl");
});

test("node retry creates one new product operation identity and forwards durable retry context", async () => {
    const module = await import("../src/lib/canvas/canvas-project-generation");
    const createRetryContext = (
        module as {
            createGenerationRetryContext?: (
                retryOf: string,
                attemptGroupId?: string,
            ) => Promise<{
                retryOf: string;
                attemptGroupId: string;
                clientOperationId: string;
            }>;
        }
    ).createGenerationRetryContext;
    expect(typeof createRetryContext).toBe("function");
    if (!createRetryContext) return;

    const priorTaskId = "dreamina:dreamina-prior-attempt-0001";
    const first = await createRetryContext(priorTaskId);
    const competing = await createRetryContext(priorTaskId);
    expect(first).toEqual(competing);
    expect(first.retryOf).toBe(priorTaskId);
    expect(first.attemptGroupId).toBe(priorTaskId);
    expect(first.clientOperationId).not.toBe(priorTaskId);
    expect(first.clientOperationId).toMatch(/^retry:[a-f0-9]{64}$/);

    let localInput: LocalDreaminaGenerationInput | undefined;
    await runBackendCanvasGenerationTask(
        {
            projectId: "project-retry-0001",
            nodeId: "node-retry-0001",
            mode: "video",
            prompt: "Retry fixture",
            config: { ...defaultConfig, model: "local:dreamina-cli:seedance2.0mini", videoSeconds: "4", vquality: "720" },
            ...first,
        } as Parameters<typeof runBackendCanvasGenerationTask>[0],
        {
            createTask: async () => {
                throw new Error("must not post /tasks");
            },
            waitTask: async () => {
                throw new Error("must not wait Backend task");
            },
            runLocal: async (input) => {
                localInput = input;
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
            createId: () => "must-not-create-another-retry-id",
            now: () => "2026-08-13T00:00:00.000Z",
        },
    );

    expect((localInput as unknown as { clientOperationId?: string }).clientOperationId).toBe(first.clientOperationId);
    expect(localInput?.idempotencyKey).toBe(first.clientOperationId);
    expect((localInput as unknown as { context?: unknown }).context).toEqual({
        scope: "scoped",
        projectId: "project-retry-0001",
        nodeId: "node-retry-0001",
        retryOf: priorTaskId,
        attemptGroupId: priorTaskId,
    });

    let competingRuns = 0;
    let competingConsumes = 0;
    const terminal: GenerationTask = {
        id: "dreamina:new-retry-task-0001",
        clientOperationId: first.clientOperationId,
        retryOf: first.retryOf,
        attemptGroupId: first.attemptGroupId,
        projectId: "project-retry-0001",
        type: "canvas_video",
        status: "succeeded",
        prompt: "Retry fixture",
        attempts: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:01.000Z",
    };
    const compete = () =>
        runCanvasGenerationTaskToConsumer(
            {
                projectId: "project-retry-0001",
                nodeId: "node-retry-0001",
                mode: "video",
                prompt: "Retry fixture",
                config: defaultConfig,
                ...first,
            },
            {
                runTask: async (options) => {
                    competingRuns += 1;
                    await Promise.resolve();
                    options.onTaskCreated?.(terminal);
                    return { mode: "video" as const, video: { dataUrl: "opaque://video" } };
                },
                bindTask: () => undefined,
                consumeTask: async () => {
                    competingConsumes += 1;
                },
            },
        );
    const [pageRetry, nodeOrAgentRetry] = await Promise.all([compete(), compete()]);
    expect(pageRetry).toEqual(nodeOrAgentRetry);
    expect(competingRuns).toBe(1);
    expect(competingConsumes).toBe(1);
});

test("real node generation binding persists the first task before an Agent retry derives lineage", async () => {
    let nodes: CanvasNodeData[] = [
        {
            id: "agent-sequence-node-0001",
            type: CanvasNodeType.Video,
            title: "Sequence retry",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: {
                generationMode: "video",
                composerContent: "Sequence fixture",
            },
        },
    ];
    const generatedOptions: Array<{ retryContext?: { retryOf: string; attemptGroupId: string; clientOperationId: string } }> = [];
    let sequence = 0;
    let terminalTask: GenerationTask | undefined;

    const run = async (retry: boolean) => {
        sequence += 1;
        await runCanvasAgentGenerationOps({
            generationOps: [
                {
                    type: "run_generation",
                    nodeId: nodes[0]!.id,
                    mode: "video",
                    ...(retry ? { retry: true } : {}),
                },
            ],
            nodes,
            context: {
                source: "online",
                conversationId: "agent-sequence-conversation-0001",
                messageId: `agent-sequence-message-000${sequence}`,
            },
            generate: async (nodeId, mode, prompt, options) => {
                generatedOptions.push(options);
                const running: GenerationTask = {
                    id: `dreamina:agent-sequence-running-000${sequence}`,
                    projectId: "agent-sequence-project-0001",
                    type: "canvas_video",
                    status: "running",
                    prompt,
                    attempts: sequence,
                    clientOperationId: options.retryContext?.clientOperationId,
                    retryOf: options.retryContext?.retryOf,
                    attemptGroupId: options.retryContext?.attemptGroupId,
                    clientContext: {
                        nodeId,
                        conversationId: "agent-sequence-conversation-0001",
                        messageId: `agent-sequence-message-000${sequence}`,
                    },
                    createdAt: "2026-08-13T00:00:00.000Z",
                    updatedAt: "2026-08-13T00:00:00.000Z",
                };
                terminalTask = { ...running, status: "succeeded", updatedAt: "2026-08-13T00:01:00.000Z" };
                await runCanvasGenerationTaskToConsumer(
                    {
                        projectId: running.projectId,
                        nodeId,
                        mode,
                        prompt,
                        config: defaultConfig,
                        ...(options.retryContext || {}),
                    },
                    {
                        runTask: async (taskOptions) => {
                            taskOptions.onTaskCreated?.(running);
                            options.onTaskUpdate?.(running);
                            taskOptions.onTaskCreated?.(terminalTask!);
                            return { mode: "video", video: { dataUrl: "opaque://video" } };
                        },
                        bindTask: (task) => {
                            nodes = nodes.map((node) =>
                                node.id === nodeId
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, ...generationTaskMetadata(task) },
                                      }
                                    : node,
                            );
                        },
                        consumeTask: async () => undefined,
                    },
                );
            },
            subscribeTasks: (_ids, listener) => {
                queueMicrotask(() => {
                    if (terminalTask) listener(terminalTask);
                });
                return () => undefined;
            },
            consumeTask: async (task, _continuationId, resume) => {
                await resume({ task, effectKey: `agent-sequence-effect:${task.id}` });
                return task;
            },
        });
    };

    await run(false);
    const priorTaskId = nodes[0]?.metadata?.taskId;
    expect(priorTaskId).toBe("dreamina:agent-sequence-running-0001");
    expect(generatedOptions[0]?.retryContext).toBeUndefined();

    await run(true);

    expect(generatedOptions[1]?.retryContext).toMatchObject({
        retryOf: priorTaskId,
        attemptGroupId: priorTaskId,
    });
    expect(generatedOptions[1]?.retryContext?.clientOperationId).toMatch(/^retry:[a-f0-9]{64}$/);
    expect(nodes[0]?.metadata).toMatchObject({
        taskId: "dreamina:agent-sequence-running-0002",
        retryOf: priorTaskId,
        attemptGroupId: priorTaskId,
    });
});

test("real canvas agent generation entry persists continuation, observes terminal state, and resumes refresh idempotently", async () => {
    const module = await import("../src/pages/canvas/use-canvas-agent-operations");
    const runAgentGenerationOps = (
        module as {
            runCanvasAgentGenerationOps?: (input: {
                generationOps: Array<{ type: "run_generation"; nodeId: string; mode?: "video"; prompt?: string; retry?: boolean }>;
                nodes: CanvasNodeData[];
                context?: { conversationId?: string; messageId?: string; source?: "online" | "local" };
                generate: (
                    nodeId: string,
                    mode: "video",
                    prompt: string,
                    options: {
                        context?: { conversationId?: string; messageId?: string };
                        retryContext?: { retryOf: string; attemptGroupId: string; clientOperationId: string };
                        onTaskUpdate(task: GenerationTask): void;
                    },
                ) => Promise<void>;
                subscribeTasks: (ids: readonly string[], listener: (task: GenerationTask) => void) => () => void;
                consumeTask: (task: GenerationTask, continuationId: string, resume: () => Promise<void>) => Promise<unknown>;
                resumeAgent: (task: GenerationTask) => Promise<void>;
                onContinuation?: (nodeId: string, continuation: NonNullable<NonNullable<CanvasNodeData["metadata"]>["agentGenerationContinuation"]>) => void;
            }) => Promise<void>;
        }
    ).runCanvasAgentGenerationOps;
    expect(typeof runAgentGenerationOps).toBe("function");
    if (!runAgentGenerationOps) return;

    const priorTaskId = "dreamina:agent-prior-task-0001";
    const node: CanvasNodeData = {
        id: "agent-video-node",
        type: CanvasNodeType.Video,
        title: "Video",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {
            generationMode: "video",
            composerContent: "Retry this clip",
            taskId: priorTaskId,
            attemptGroupId: "agent-attempt-group-0001",
        },
    };
    const running: GenerationTask = {
        id: "dreamina:agent-retry-task-0002",
        projectId: "agent-project-0001",
        type: "canvas_video",
        status: "running",
        prompt: "Retry this clip",
        attempts: 2,
        clientContext: {
            nodeId: node.id,
            conversationId: "conversation-agent-entry-0001",
            messageId: "message-agent-entry-0001",
        },
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const terminal = { ...running, status: "succeeded" as const, updatedAt: "2026-08-13T00:01:00.000Z" };
    const generatedOptions: Array<{ retryContext?: { retryOf: string; attemptGroupId: string; clientOperationId: string } }> = [];
    const subscriptions: string[][] = [];
    const consumed: string[] = [];
    let continuations = 0;
    let pendingContinuation: NonNullable<NonNullable<CanvasNodeData["metadata"]>["agentGenerationContinuation"]> | undefined;

    await runAgentGenerationOps({
        generationOps: [{ type: "run_generation", nodeId: node.id, mode: "video", retry: true }],
        nodes: [node],
        context: { source: "online", conversationId: "conversation-agent-entry-0001", messageId: "message-agent-entry-0001" },
        generate: async (_nodeId, _mode, _prompt, options) => {
            generatedOptions.push(options);
            options.onTaskUpdate(running);
        },
        subscribeTasks: (ids, listener) => {
            subscriptions.push([...ids]);
            queueMicrotask(() => listener(terminal));
            return () => undefined;
        },
        consumeTask: async (task, continuationId, resume) => {
            consumed.push(`${task.id}:${continuationId}`);
            await resume();
        },
        resumeAgent: async () => {
            continuations += 1;
        },
        onContinuation: (_nodeId, continuation) => {
            if (continuation.status === "pending") pendingContinuation = continuation;
        },
    });

    const retryContext = await createGenerationRetryContext(priorTaskId, "agent-attempt-group-0001");
    expect(generatedOptions[0]?.retryContext).toEqual(retryContext);
    expect(subscriptions).toEqual([[running.id]]);
    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toMatch(new RegExp(`^${terminal.id}:agent:[a-f0-9]{64}$`));
    expect(continuations).toBe(1);
    expect(pendingContinuation).toMatchObject({
        taskId: running.id,
        source: "online",
        status: "pending",
    });

    subscriptions.length = 0;
    await runAgentGenerationOps({
        generationOps: [],
        nodes: [{ ...node, metadata: { ...node.metadata, taskId: running.id, agentGenerationContinuation: pendingContinuation } }],
        context: { source: "online", conversationId: "conversation-agent-entry-0001", messageId: "message-agent-entry-0001" },
        generate: async () => {
            throw new Error("refresh must not submit again");
        },
        subscribeTasks: (ids, listener) => {
            subscriptions.push([...ids]);
            queueMicrotask(() => listener(terminal));
            return () => undefined;
        },
        consumeTask: async (_task, _continuationId, resume) => resume(),
        resumeAgent: async () => {
            continuations += 1;
        },
    });
    expect(subscriptions).toEqual([[running.id]]);
});

test("canvas refresh recovery consumes shared task subscriptions instead of querying and waiting per page", async () => {
    const module = await import("../src/pages/canvas/use-canvas-generation");
    const subscribeRecovery = (
        module as {
            subscribeCanvasGenerationRecoveryTasks?: (ids: readonly string[], listener: (task: GenerationTask) => void, subscribe: (ids: readonly string[], listener: (task: GenerationTask) => void) => () => void) => () => void;
        }
    ).subscribeCanvasGenerationRecoveryTasks;
    expect(typeof subscribeRecovery).toBe("function");
    if (!subscribeRecovery) return;

    const observed: GenerationTask[] = [];
    let subscribedIds: readonly string[] = [];
    const task: GenerationTask = {
        id: "dreamina:canvas-refresh-task-0001",
        projectId: "canvas-refresh-project-0001",
        type: "canvas_image",
        status: "succeeded",
        prompt: "fixture",
        attempts: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:01:00.000Z",
    };
    const unsubscribe = subscribeRecovery(
        [task.id, task.id],
        (next) => observed.push(next),
        (ids, listener) => {
            subscribedIds = ids;
            listener(task);
            return () => undefined;
        },
    );
    unsubscribe();

    expect(subscribedIds).toEqual([task.id]);
    expect(observed).toEqual([task]);
});

test("canvas project switch aborts and drains stale recovery before applying the next project's same node id", async () => {
    const module = await import("../src/pages/canvas/use-canvas-generation");
    type RecoveryContext = {
        projectId: string;
        signal: AbortSignal;
        isCurrentProject: () => boolean;
    };
    type RecoveryCoordinator = {
        switchProject: (projectId: string, operation: (context: RecoveryContext) => Promise<void>) => Promise<void>;
        abortAndDrain: () => Promise<void>;
    };
    const createCoordinator = (
        module as {
            createCanvasGenerationRecoveryCoordinator?: () => RecoveryCoordinator;
        }
    ).createCanvasGenerationRecoveryCoordinator;
    const recoverNode = module.recoverCanvasGenerationTaskNode;
    expect(typeof createCoordinator).toBe("function");
    expect(typeof recoverNode).toBe("function");
    if (!createCoordinator) return;

    const coordinator = createCoordinator();
    const sharedNodeId = "shared-recovery-node";
    const node = (projectId: string): CanvasNodeData => ({
        id: sharedNodeId,
        type: CanvasNodeType.Image,
        title: `${projectId} durable`,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { taskId: `task-${projectId}`, status: "loading" },
    });
    const completed = (projectId: string): GenerationTask => ({
        id: `task-${projectId}`,
        projectId,
        type: "canvas_image",
        status: "succeeded",
        prompt: "fixture",
        attempts: 1,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:01:00.000Z",
    });

    let visibleProjectId = "canvas-A";
    let visibleNodes = [node(visibleProjectId)];
    let staleApplyCalls = 0;
    let nextApplyCalls = 0;
    let subscriptionAborts = 0;
    let subscriptionUnsubscribes = 0;
    let nextRecoveryStarted = false;
    let nextRecoveryBookkeeping: string[] = [];
    const recoveringTaskIds = new Set(["task-canvas-A"]);
    let releaseDelayedTerminal!: () => void;
    const delayedTerminal = new Promise<void>((resolve) => {
        releaseDelayedTerminal = resolve;
    });
    let markOldRecoveryStarted!: () => void;
    const oldRecoveryStarted = new Promise<void>((resolve) => {
        markOldRecoveryStarted = resolve;
    });

    const setVisibleNodes = (value: CanvasNodeData[] | ((current: CanvasNodeData[]) => CanvasNodeData[])) => {
        visibleNodes = typeof value === "function" ? value(visibleNodes) : value;
    };

    const oldRecovery = coordinator.switchProject("canvas-A", async (context) => {
        const unsubscribe = () => {
            subscriptionUnsubscribes += 1;
        };
        const onAbort = () => {
            subscriptionAborts += 1;
            unsubscribe();
        };
        context.signal.addEventListener("abort", onAbort, { once: true });
        markOldRecoveryStarted();
        await delayedTerminal;
        context.signal.removeEventListener("abort", onAbort);
        await recoverNode({
            projectId: context.projectId,
            node: node("canvas-A"),
            completed: completed("canvas-A"),
            continuationOnly: false,
            nodesRef: {
                get current() {
                    return visibleNodes;
                },
                set current(value) {
                    visibleNodes = value;
                },
            },
            setNodes: setVisibleNodes,
            applyGenerationTaskResult: async () => {
                staleApplyCalls += 1;
                visibleNodes = [{ ...node("canvas-A"), title: "canvas-A late terminal" }];
            },
            signal: context.signal,
            isCurrentProject: context.isCurrentProject,
        });
    });

    await oldRecoveryStarted;
    visibleProjectId = "canvas-B";
    visibleNodes = [node(visibleProjectId)];
    const nextRecovery = coordinator.switchProject("canvas-B", async (context) => {
        nextRecoveryStarted = true;
        recoveringTaskIds.clear();
        nextRecoveryBookkeeping = [...recoveringTaskIds];
        await recoverNode({
            projectId: context.projectId,
            node: node("canvas-B"),
            completed: completed("canvas-B"),
            continuationOnly: false,
            nodesRef: {
                get current() {
                    return visibleNodes;
                },
                set current(value) {
                    visibleNodes = value;
                },
            },
            setNodes: setVisibleNodes,
            applyGenerationTaskResult: async () => {
                nextApplyCalls += 1;
                visibleNodes = [{ ...node("canvas-B"), title: "canvas-B recovered" }];
            },
            signal: context.signal,
            isCurrentProject: context.isCurrentProject,
        });
    });

    try {
        await Promise.resolve();
        expect(subscriptionAborts).toBe(1);
        expect(subscriptionUnsubscribes).toBe(1);
        expect(nextRecoveryStarted).toBe(false);
        expect(visibleNodes[0]?.title).toBe("canvas-B durable");

        releaseDelayedTerminal();
        await Promise.all([oldRecovery, nextRecovery]);

        expect(staleApplyCalls).toBe(0);
        expect(nextApplyCalls).toBe(1);
        expect(nextRecoveryStarted).toBe(true);
        expect(nextRecoveryBookkeeping).toEqual([]);
        expect(visibleProjectId).toBe("canvas-B");
        expect(visibleNodes[0]?.id).toBe(sharedNodeId);
        expect(visibleNodes[0]?.title).toBe("canvas-B recovered");
    } finally {
        releaseDelayedTerminal();
        await coordinator.abortAndDrain();
    }
});

test("cinematic continuation failure boundary keeps retryable errors pending and marks provider failures", async () => {
    const panelModule = await import("../src/components/canvas/canvas-assistant-panel");
    const consumerModule = await import("../src/services/canvas-generation-consumer");
    const handleFailure = (
        panelModule as {
            handleCinematicContinuationFailure?: (error: unknown, failProvider: (error: unknown) => void) => "abort" | "durable-ack" | "provider-failed";
        }
    ).handleCinematicContinuationFailure;
    expect(typeof handleFailure).toBe("function");
    if (!handleFailure) return;

    const cases = [
        { name: "online-tool abort", error: new DOMException("The operation was aborted", "AbortError"), expected: "pending", disposition: "abort" },
        { name: "durable ack", error: new consumerModule.CanvasGenerationDurableAckError(new Error("local durable write failed")), expected: "pending", disposition: "durable-ack" },
        { name: "provider failure", error: new Error("provider failed"), expected: "failed", disposition: "provider-failed" },
    ] as const;
    for (const scenario of cases) {
        let status: "pending" | "failed" = "pending";
        const disposition = handleFailure(scenario.error, () => {
            status = "failed";
        });
        expect(disposition, scenario.name).toBe(scenario.disposition);
        expect(status, scenario.name).toBe(scenario.expected);
    }
});

test("all cinematic production entry adapters are the shared continuation boundary", async () => {
    const panelModule = await import("../src/components/canvas/canvas-assistant-panel");
    const sharedBoundary = (
        panelModule as {
            runCanvasCinematicContinuationBoundary?: (...args: never[]) => Promise<unknown>;
        }
    ).runCanvasCinematicContinuationBoundary;
    const entryAdapters = (
        panelModule as {
            canvasCinematicContinuationEntryAdapters?: Record<"online-tool" | "submit-cinematic" | "resume-cinematic", (...args: never[]) => Promise<unknown>>;
        }
    ).canvasCinematicContinuationEntryAdapters;

    expect(typeof sharedBoundary).toBe("function");
    expect(entryAdapters).toBeDefined();
    if (!sharedBoundary || !entryAdapters) return;
    for (const entry of ["online-tool", "submit-cinematic", "resume-cinematic"] as const) expect(entryAdapters[entry], entry).toBe(sharedBoundary);
});

test("agent run_generation waits for the shared task, persists one continuation, and shares retry identity with node retry", async () => {
    const priorTaskId = "dreamina:agent-prior-task-0001";
    const attemptGroupId = "dreamina:agent-attempt-group-0001";
    const node: CanvasNodeData = {
        id: "agent-retry-node-0001",
        type: CanvasNodeType.Video,
        title: "Agent retry",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {
            generationMode: "video",
            composerContent: "Retry from agent",
            taskId: priorTaskId,
            attemptGroupId,
        },
    };
    const expectedRetry = await createGenerationRetryContext(priorTaskId, attemptGroupId);
    const terminal: GenerationTask = {
        id: "dreamina:agent-retry-terminal-0001",
        clientOperationId: expectedRetry.clientOperationId,
        retryOf: priorTaskId,
        attemptGroupId,
        projectId: "agent-project-retry-0001",
        type: "canvas_video",
        status: "succeeded",
        prompt: "Retry from agent",
        attempts: 1,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:01:00.000Z",
    };
    let releaseGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => {
        releaseGeneration = resolve;
    });
    let generationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        generationStarted = resolve;
    });
    const order: string[] = [];
    let generateOptions: Record<string, unknown> | undefined;
    const continuations: Array<{ nodeId: string; continuation: Record<string, unknown> }> = [];
    let continuationCompletionStartedResolve!: () => void;
    const continuationCompletionStarted = new Promise<void>((resolve) => {
        continuationCompletionStartedResolve = resolve;
    });
    let releaseContinuationCompletion!: () => void;
    const continuationCompletionGate = new Promise<void>((resolve) => {
        releaseContinuationCompletion = resolve;
    });
    let taskListener: ((task: GenerationTask) => void) | undefined;
    const pending = runCanvasAgentGenerationOps({
        generationOps: [{ type: "run_generation", nodeId: node.id, mode: "video", retry: true }],
        nodes: [node],
        context: { source: "online", conversationId: "online-agent-conversation-0001", messageId: "online-agent-message-0001" },
        subscribeTasks: (_ids, listener) => {
            taskListener = listener;
            return () => {
                taskListener = undefined;
            };
        },
        generate: async (_nodeId, _mode, _prompt, options) => {
            generateOptions = options as unknown as Record<string, unknown>;
            generationStarted();
            await generationGate;
            options.onTaskUpdate?.({ ...terminal, status: "running" });
            taskListener?.(terminal);
        },
        onContinuation: async (nodeId, continuation) => {
            continuations.push({ nodeId, continuation: continuation as unknown as Record<string, unknown> });
            if (continuation.status === "completed") {
                continuationCompletionStartedResolve();
                await continuationCompletionGate;
            }
        },
        consumeTask: async (task, continuationId, consumer) => {
            expect(task.id).toBe(terminal.id);
            await consumer({ task, effectKey: `agent-resume:${task.id}:${continuationId}` });
            return task;
        },
    }).then(() => {
        order.push("dispatch-resolved");
    });

    await started;
    order.push("before-release");
    releaseGeneration();
    await continuationCompletionStarted;
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(order).toEqual(["before-release"]);
    } finally {
        releaseContinuationCompletion();
    }
    await pending;

    expect(order).toEqual(["before-release", "dispatch-resolved"]);
    expect(generateOptions?.retryContext).toEqual(expectedRetry);
    expect(continuations.map(({ nodeId, continuation }) => ({ nodeId, status: continuation.status, taskId: continuation.taskId }))).toEqual([
        { nodeId: node.id, status: "pending", taskId: terminal.id },
        { nodeId: node.id, status: "completed", taskId: terminal.id },
    ]);
    expect(String(continuations[0]?.continuation.id)).toMatch(/^agent:[a-f0-9]{64}$/);
    expect(continuations[1]?.continuation.effectKey).toBe(`agent-resume:${terminal.id}:${continuations[0]?.continuation.id}`);
});

test("Create image batch retry keeps one attempt group while each new task points to its matching prior batch task", async () => {
    const priorTaskIds = ["dreamina:create-prior-batch-0001", "dreamina:create-prior-batch-0002", "dreamina:create-prior-batch-0003"];
    const retryContexts = await createGenerationBatchRetryContexts(priorTaskIds, "dreamina:create-batch-attempt-group-0001");
    const inputs: LocalDreaminaGenerationInput[] = [];
    const result = await runBackendGenerationTaskBatch(
        {
            mode: "image",
            prompt: "Retry three images",
            config: { ...defaultConfig, model: "local:dreamina-cli:5.0Pro", quality: "2k", count: "1" },
            count: 3,
            clientOperationId: "retry:create-batch-operation-0001",
            retryOf: priorTaskIds[0],
            attemptGroupId: "dreamina:create-batch-attempt-group-0001",
            retryContextsByBatchIndex: retryContexts,
        },
        {
            createTask: async () => {
                throw new Error("must not create backend task");
            },
            waitTask: async () => {
                throw new Error("must not wait backend task");
            },
            runLocal: async (input) => {
                inputs.push(input);
                return { mode: "image", images: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }] };
            },
            createId: () => "unused-create-batch-id",
            now: () => "2026-08-13T00:00:00.000Z",
        },
    );

    expect(result.every((entry) => entry.status === "fulfilled")).toBe(true);
    expect(inputs.map((input) => input.context?.retryOf)).toEqual(priorTaskIds);
    expect(inputs.map((input) => input.context?.attemptGroupId)).toEqual(["dreamina:create-batch-attempt-group-0001", "dreamina:create-batch-attempt-group-0001", "dreamina:create-batch-attempt-group-0001"]);
    expect(inputs.map((input) => input.clientOperationId)).toEqual(retryContexts.map((context) => context.clientOperationId));
});

test("Canvas refresh recovery delegates task observation to the shared subscription and resumes pending agent continuations", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-generation.ts", import.meta.url)).text();
    expect(source).toContain("subscribeGenerationTasks");
    expect(source).toContain("consumeCanvasAgentGenerationContinuation");
    expect(source).not.toContain("taskIds.map((id) => queryGenerationTask(id");
    expect(source).not.toContain("await waitForGenerationTask(task.id");
});

test("local Dreamina diagnostics project only safe structured stage/error/provenance fields", async () => {
    const module = await import("../src/services/local-dreamina-task-projection");
    const projectLog = (
        module as {
            projectLocalDreaminaDiagnosticLog?: (input: Record<string, unknown>) => Record<string, unknown>;
        }
    ).projectLocalDreaminaDiagnosticLog;
    expect(typeof projectLog).toBe("function");
    if (!projectLog) return;

    const projected = projectLog({
        level: "warn",
        stage: "submitted",
        errorCode: "dreamina_query_failed",
        provenance: "background_reconcile",
        observedAt: "2026-08-13T12:34:56.000Z",
        prompt: "SECRET_PROMPT_DO_NOT_PERSIST",
        path: "C:\\Users\\fixture\\private.mp4",
        media: "data:video/mp4;base64,AAAA",
        receipt: "provider-receipt-secret",
        token: "token-secret-value",
        rawOutput: "raw provider stdout/stderr SECRET",
    });

    expect(projected).toEqual({
        level: "warn",
        stage: "submitted",
        errorCode: "dreamina_query_failed",
        provenance: "background_reconcile",
        observedAt: "2026-08-13T12:34:56.000Z",
    });
    const serialized = JSON.stringify(projected);
    for (const forbidden of ["SECRET_PROMPT", "C:\\\\Users", "data:video", "receipt", "token-secret", "raw provider", "stdout", "stderr"]) {
        expect(serialized).not.toContain(forbidden);
    }
});

test("local Dreamina product copy states eventual polling, background waiting, unsupported official cancel, and unknown entitlement honestly", async () => {
    const projection = await import("../src/services/local-dreamina-task-projection");
    const settings = await import("../src/pages/settings/local-cli-settings");
    const taskSource = await Bun.file(new URL("../src/pages/tasks/index.tsx", import.meta.url)).text();

    const accepted = projection.localDreaminaCancellationCopy({
        id: "dreamina:truth-copy-task-0001",
        provider: "dreamina-cli",
        status: "running",
        stage: "submitted",
        receiptRecorded: true,
    });
    expect(accepted).toMatchObject({ action: "转入后台" });
    expect(accepted?.confirmation).toContain("仍会继续同步官方状态");
    expect(taskSource).toContain("官方状态采用最终一致轮询");
    expect(taskSource).toContain("官方即梦 CLI 当前不支持可靠的官方取消");
    expect(settings.LOCAL_CLI_SETTINGS_COPY.dreaminaMembership).toContain("账号生成权限：未知");
    expect(settings.LOCAL_CLI_SETTINGS_COPY.dreaminaMembership).not.toContain("仅高级会员可用于生成");
});

test("Task 7 fake browser presentation stays isolated from real CLI, OAuth, paid generation, and sensitive browser state", async () => {
    const projection = await import("../src/services/local-dreamina-task-projection");
    const settings = await import("../src/pages/settings/local-cli-settings");
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const browserCalls: string[] = [];
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            open: () => {
                browserCalls.push("open");
                return null;
            },
            dispatchEvent: () => {
                browserCalls.push("dispatch");
                return true;
            },
        },
    });

    try {
        const accepted = projection.localDreaminaCancellationCopy({
            id: "dreamina:fake-browser-task-0001",
            provider: "dreamina-cli",
            status: "running",
            stage: "submitted",
            receiptRecorded: true,
        });
        const presentation = settings.localCliSettingsPresentation({
            connection: "connected",
            moduleAvailable: true,
            dreamina: {
                provider: "dreamina-cli",
                state: "authenticated",
                installed: true,
                authenticated: true,
                message: "Dreamina CLI 已登录",
                totalCredit: 120,
                creditObservedAt: "2026-08-13T12:34:56.000Z",
                accountBinding: "fake-browser-account-binding",
                sessionEpoch: 3,
            },
        });

        expect(accepted).toMatchObject({ action: "转入后台" });
        expect(presentation.dreamina.creditLabel).toBe("即梦积分 120");
        expect(presentation.dreamina.creditObservedAtLabel).toContain("上次刷新积分");
        expect(settings.LOCAL_CLI_SETTINGS_COPY.dreaminaMembership).toContain("账号生成权限：未知");
        expect(browserCalls).toEqual([]);
        const serialized = JSON.stringify({ accepted, presentation });
        for (const forbidden of ["deviceCode", "userCode", "verificationUri", "receipt", "token", "Cookie", "Profile", "paid", "generate"]) {
            expect(serialized).not.toContain(forbidden);
        }
    } finally {
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    }
});
