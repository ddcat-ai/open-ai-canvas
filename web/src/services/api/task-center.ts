import { generationErrorMessage } from "@/lib/generation-error";
import { http, apiBaseURL, type BackendEnvelope } from "@/services/api/request";
import { consumeTaskTextStream, createTaskTextStreamParser, type TaskTextStreamEvent } from "@/services/api/task-text-stream";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

export type { BackendEnvelope } from "@/services/api/request";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type TaskBillingStatus = "reserved" | "running" | "settled" | "refunded" | "uncertain";
export type ProviderCancelStatus = "requested" | "confirmed" | "uncertain";
export type GenerationTaskResultState = "NOT_AVAILABLE" | "PENDING_MATERIALIZATION" | "MATERIALIZING" | "READY" | "FAILED_RETRYABLE" | "FAILED_PERMANENT";
export type GenerationTaskOutput = {
    outputIndex: number;
    mediaType: "image" | "video" | "audio";
    providerArtifactRef?: string;
    materializedAssetId?: string;
    materializationErrorCode?: string;
};

export type GenerationTask = {
    id: string;
    clientOperationId?: string;
    retryOf?: string;
    attemptGroupId?: string;
    projectId?: string;
    type: string;
    status: TaskStatus;
    progress?: number;
    stage?: string;
    prompt: string;
    operation?: string;
    provider?: string;
    model?: string;
    providerRequestId?: string;
    providerCancelStatus?: ProviderCancelStatus;
    providerCancelError?: string;
    providerCancelAttempts?: number;
    providerCancelRequestedAt?: string;
    providerCancelledAt?: string;
    errorCode?: string;
    officialStatus?: "pending" | "processing" | "completed" | "failed" | "cancelled";
    receiptRecorded?: boolean;
    previewUrl?: string;
    previewKind?: "image" | "video";
    previewPosterUrl?: string;
    inputJson?: string;
    resultJson?: string;
    resultState?: GenerationTaskResultState;
    outputs?: GenerationTaskOutput[];
    textDraft?: string;
    error?: string;
    attempts: number;
    startedAt?: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
    billing?: {
        amountMicrocredits: number;
        status: TaskBillingStatus;
    };
    clientContext?: {
        conversationId?: string;
        messageId?: string;
        nodeId?: string;
        batchIndex?: number;
        batchCount?: number;
        domainProjectId?: string;
        chapterId?: string;
		chapterOperation?: "characters" | "storyboard";
		shotId?: string;
		workflowStepId?: string;
		artifactType?: string;
	};
    created_at?: string;
    updated_at?: string;
};

export type ProviderTaskQueryResult = {
    task: GenerationTask;
    providerStatus: string;
    recovered: boolean;
    billingSettled: boolean;
};

export type TaskTextDelta = {
    id: string;
    taskId: string;
    sequence: number;
    content: string;
    byteCount: number;
    createdAt: string;
    expiresAt: string;
};

export type TaskTextReplay = {
    deltas: TaskTextDelta[];
    textDraft?: string;
    finalText?: string;
    complete: boolean;
    status: TaskStatus;
    stage?: string;
    progress: number;
    error?: string;
};

export type TaskLog = {
    id: string;
    taskId: string;
    level: "info" | "warn" | "error";
    stage: string;
    errorCode?: string;
    provenance: "task_state" | "provider_observation" | "background_reconcile" | "manual_refresh" | "backend";
    observedAt?: string;
    createdAt: string;
};

export type CreateTaskInput = {
    projectId?: string;
    type?: string;
    operation?: string;
    prompt: string;
    provider?: string;
    model?: string;
	logicalModelId?: string;
    input?: Record<string, unknown>;
};
export function createGenerationTask(input: CreateTaskInput) {
    return http.post<GenerationTask>("/tasks", input).then((task) => {
        recordDiagnosticEvent({ level: "info", category: "task", message: "任务已创建", taskId: task.id, projectId: task.projectId });
        notifyCanvasTaskCreated(task);
        // 创建任务时积分已被预占，不能等任务结束后才刷新可用余额。
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        return task;
    });
}

export type GenerationTaskPageRequest = {
    limit: number;
    projectId?: string;
    activeOnly: boolean;
    cursor?: string;
};

type GenerationTaskPage<T> = { tasks: T[]; nextCursor?: string };
type GenerationTaskListOptions = { projectId?: string; activeOnly?: boolean };
type GenerationTaskListDependencies = {
    listBackend?(limit: number, options?: GenerationTaskListOptions, signal?: AbortSignal): Promise<GenerationTask[]>;
    listBackendPage?(request: GenerationTaskPageRequest, signal?: AbortSignal): Promise<GenerationTaskPage<GenerationTask>>;
};

const defaultGenerationTaskListDependencies: GenerationTaskListDependencies = {
    listBackendPage: async (page, signal) => ({
        tasks: await http.get<GenerationTask[]>("/tasks", {
                params: { pageSize: Math.min(page.limit, 100), projectId: page.projectId, activeOnly: page.activeOnly || undefined },
                signal,
            }),
    }),
};

export async function listGenerationTasks(limit = 30, options?: { projectId?: string; activeOnly?: boolean }, dependencies: GenerationTaskListDependencies = defaultGenerationTaskListDependencies, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10_000, Math.trunc(limit))) : 30;
    const baseRequest = {
        limit: Math.min(100, boundedLimit),
        ...(options?.projectId ? { projectId: options.projectId } : {}),
        activeOnly: options?.activeOnly === true,
    } satisfies GenerationTaskPageRequest;
    const backendPageReader =
        dependencies.listBackendPage ??
        (async (page: GenerationTaskPageRequest, pageSignal?: AbortSignal) => ({
            tasks:
                (await dependencies.listBackend?.(
                    page.limit,
                    {
                        ...(page.projectId ? { projectId: page.projectId } : {}),
                        activeOnly: page.activeOnly,
                    },
                    pageSignal,
                )) ?? [],
        }));
    const backendTasks = await collectGenerationTaskPages(backendPageReader, baseRequest, boundedLimit, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return backendTasks
        .filter((task) => !options?.projectId || task.projectId === options.projectId)
        .filter((task) => !options?.activeOnly || task.status === "queued" || task.status === "running")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
        .slice(0, boundedLimit);
}

async function collectGenerationTaskPages<T>(readPage: (request: GenerationTaskPageRequest, signal?: AbortSignal) => Promise<GenerationTaskPage<T>>, baseRequest: GenerationTaskPageRequest, limit: number, signal?: AbortSignal) {
    const items: T[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await readPage({ ...baseRequest, ...(cursor ? { cursor } : {}) }, signal);
        const page = Array.isArray(response) ? { tasks: response as T[] } : response;
        items.push(...page.tasks);
        if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
    } while (items.length < limit);
    return items.slice(0, limit);
}

export function queryGenerationTask(id: string, options?: { signal?: AbortSignal }) {
    return http.get<GenerationTask>(`/tasks/${encodeURIComponent(id)}`, { signal: options?.signal });
}

type GenerationTaskSubscriptionDependencies = {
    queryTask(id: string): Promise<GenerationTask>;
    waitTask(id: string, options?: { initialTask?: GenerationTask; onTaskUpdate?: (task: GenerationTask) => void }): Promise<GenerationTask>;
};

export function createGenerationTaskSubscriptionService(dependencies: GenerationTaskSubscriptionDependencies) {
    type Entry = {
        listeners: Set<(task: GenerationTask) => void>;
        latest?: GenerationTask;
        observation?: Promise<void>;
    };
    const entries = new Map<string, Entry>();
    const publish = (entry: Entry, task: GenerationTask) => {
        entry.latest = task;
        for (const listener of entry.listeners) listener(task);
    };
    const observe = (id: string, entry: Entry) => {
        if (entry.observation) return;
        entry.observation = (async () => {
            const initial = await dependencies.queryTask(id);
            publish(entry, initial);
            if (initial.status === "succeeded" || initial.status === "failed" || initial.status === "cancelled") return;
            const terminal = await dependencies.waitTask(id, {
                initialTask: initial,
                onTaskUpdate: (task) => publish(entry, task),
            });
            publish(entry, terminal);
        })().catch((error) => {
            // 观察失败不能永久占住 entry，否则页面重新订阅时也不会再查询任务。
            entry.observation = undefined;
            console.warn("生成任务观察中断，后续订阅将重新建立连接", { taskId: id, error });
        });
    };
    return {
        subscribe(ids: readonly string[], listener: (task: GenerationTask) => void) {
            const uniqueIds = [...new Set(ids)];
            for (const id of uniqueIds) {
                const entry = entries.get(id) ?? { listeners: new Set<(task: GenerationTask) => void>() };
                entries.set(id, entry);
                entry.listeners.add(listener);
                if (entry.latest) listener(entry.latest);
                observe(id, entry);
            }
            return () => {
                for (const id of uniqueIds) entries.get(id)?.listeners.delete(listener);
            };
        },
    };
}

const generationTaskSubscriptionService = createGenerationTaskSubscriptionService({
    queryTask: (id) => queryGenerationTask(id),
    waitTask: (id, options) => waitForGenerationTask(id, options),
});

export function subscribeGenerationTasks(ids: readonly string[], listener: (task: GenerationTask) => void) {
    return generationTaskSubscriptionService.subscribe(ids, listener);
}

export function appendTaskTextDelta(id: string, content: string) {
    return http.post<TaskTextDelta>(`/tasks/${encodeURIComponent(id)}/text-deltas`, { content });
}

export function completeTextReplayTask(id: string, text: string) {
    return http.post<GenerationTask>(`/tasks/${encodeURIComponent(id)}/text-replay-complete`, { text });
}

export function queryTaskTextReplay(id: string, after = 0) {
    return http.get<TaskTextReplay>(`/tasks/${encodeURIComponent(id)}/text-deltas`, { params: { after } });
}

export function retryGenerationTask(id: string) {
    return http.post<GenerationTask>(`/tasks/${encodeURIComponent(id)}/retry`);
}

export function cancelGenerationTask(id: string) {
    return http.post<GenerationTask>(`/tasks/${encodeURIComponent(id)}/cancel`).then((task) => {
        window.dispatchEvent(new CustomEvent("canvas:task-cancelled", { detail: { task } }));
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        return task;
    });
}

export function queryFailedVideoProviderTask(id: string) {
    return http.post<ProviderTaskQueryResult>(`/tasks/${encodeURIComponent(id)}/query-provider`);
}

export function refreshGenerationTaskStatus(id: string, options?: { signal?: AbortSignal }) {
    return http.get<GenerationTask>(`/tasks/${encodeURIComponent(id)}`, { signal: options?.signal });
}

export function deleteGenerationTask(id: string) {
    return http.delete<void>(`/tasks/${encodeURIComponent(id)}`);
}

export async function listTaskLogs(id: string) {
    const raw = await http.get<Array<{ level?: unknown; message?: unknown; payload?: unknown; createdAt?: unknown }>>(`/tasks/${encodeURIComponent(id)}/logs`);
    return raw.map((log, index) => projectBackendSafeTaskLog(id, log, index));
}

export function formatTaskLog(log: TaskLog) {
    return [`stage=${log.stage}`, ...(log.errorCode ? [`error=${log.errorCode}`] : []), `provenance=${log.provenance}`, ...(log.observedAt ? [`observedAt=${log.observedAt}`] : [])].join(" ");
}

export function projectBackendSafeTaskLog(taskId: string, raw: { level?: unknown; message?: unknown; payload?: unknown; createdAt?: unknown }, index: number): TaskLog {
    const text = [raw.message, raw.payload].filter((value): value is string => typeof value === "string").join(" ");
    const stage = safeTaskLogStage(text) || "backend_event";
    const errorCode = safeTaskLogErrorCode(text);
    const createdAt = typeof raw.createdAt === "string" && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : "1970-01-01T00:00:00.000Z";
    return {
        id: `safe:${taskId}:${index}`,
        taskId,
        level: raw.level === "error" ? "error" : raw.level === "warn" ? "warn" : "info",
        stage,
        ...(errorCode ? { errorCode } : {}),
        provenance: "backend",
        createdAt,
    };
}

function safeTaskLogStage(value: unknown) {
    if (typeof value !== "string") return undefined;
    const match = value.match(/(?:^|[^a-z0-9_])(queued|submitting|submitted|generating|submission_unknown|processing|completed|succeeded|failed|cancelled)(?:$|[^a-z0-9_])/i);
    return match?.[1]?.toLowerCase();
}

const SAFE_TASK_LOG_ERROR_CODES = new Set(["provider_query_failed", "provider_submission_unknown", "provider_reference_invalid"]);

function safeTaskLogErrorCode(value: unknown) {
    if (typeof value !== "string") return undefined;
    for (const match of value.matchAll(/(?:model|provider)_[a-z0-9_]{2,80}/gi)) {
        const errorCode = match[0].toLowerCase();
        if (SAFE_TASK_LOG_ERROR_CODES.has(errorCode)) return errorCode;
    }
    return undefined;
}

export type WaitForGenerationTaskOptions = {
	textEventsSource?: "task" | "agent";
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
    initialTask?: GenerationTask;
    onTaskUpdate?: (task: GenerationTask) => void;
    onTextDelta?: (text: string) => void;
    useTextEvents?: boolean;
};

export async function waitForGenerationTask(id: string, options?: WaitForGenerationTaskOptions) {
    if (options?.onTextDelta || options?.useTextEvents) return waitForGenerationTaskTextEvents(id, options);
    const startedAt = Date.now();
    const intervalMs = options?.intervalMs || 2000;
    let lastTask = options?.initialTask;
    let lastQueryError: unknown;
    let consecutiveFailures = 0;
    try {
        while (Date.now() - startedAt < (options?.timeoutMs || taskWaitTimeoutMs(lastTask))) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            let task: GenerationTask;
            try {
                task = await queryGenerationTask(id, { signal: options?.signal });
                lastTask = task;
                lastQueryError = undefined;
                consecutiveFailures = 0;
                options?.onTaskUpdate?.(task);
            } catch (error) {
                lastQueryError = error;
                consecutiveFailures += 1;
                // 连续失败说明查询通道已不可用，继续轮询只会空转到整体超时；
                // 保留少量容忍度（约 10 秒）以跳过瞬时抖动后直接报错，便于用户尽早处理。
                if (consecutiveFailures >= 5) {
                    throw error instanceof Error ? error : new Error(String(error));
                }
                await delay(intervalMs, options?.signal);
                continue;
            }
            if (task.status === "succeeded") {
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                return task;
            }
            if (task.status === "failed" || task.status === "cancelled") {
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                throw new Error(task.error ? generationErrorMessage(task.error) : `任务${task.status === "cancelled" ? "已取消" : "失败"}`);
            }
            await delay(intervalMs, options?.signal);
        }
    } catch (error) {
        if (options?.signal?.aborted) {
            // Abort 只停止当前页面的状态监听，不能把已发起的上游任务改成取消状态。
            throw new DOMException("Aborted", "AbortError");
        }
        throw error;
    }
    throw new Error(lastQueryError instanceof Error ? `任务状态同步失败：${lastQueryError.message}` : "任务执行超时，请稍后重试");
}

async function waitForGenerationTaskTextEvents(id: string, options: WaitForGenerationTaskOptions) {
    const startedAt = Date.now();
    const intervalMs = options.intervalMs || 1000;
    let lastTask = options.initialTask;
    let lastEventId = 0;
    // Agent subscriptions replay from cursor 0; an existing draft must not be
    // prepended to the same persisted deltas when reopening a conversation.
    let fullText = options.textEventsSource === "agent" ? "" : lastTask?.textDraft || "";
    let lastStreamError: unknown;
    if (!lastTask) {
        lastTask = await queryGenerationTask(id, { signal: options.signal });
        options.onTaskUpdate?.(lastTask);
    }
    const timeoutMs = options.timeoutMs || taskWaitTimeoutMs(lastTask);
    while (Date.now() - startedAt < timeoutMs) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let terminalReceived = false;
        try {
            const base = String(apiBaseURL).replace(/\/+$/, "");
            const cursor = lastEventId > 0 ? `?after=${encodeURIComponent(String(lastEventId))}` : "";
            const path = options.textEventsSource === "agent" ? `/agent/runs/${encodeURIComponent(id)}/events` : `/tasks/${encodeURIComponent(id)}/text-events`;
            const response = await fetch(`${base}${path}${cursor}`, {
                headers: { Accept: "text/event-stream" },
                credentials: "include",
                signal: options.signal,
            });
            if (!response.ok) throw new TaskTextStreamFatalError(await taskTextStreamHTTPError(response));
            if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream")) {
                throw new TaskTextStreamFatalError("任务文本流接口未返回事件流，请检查后端地址和反向代理配置");
            }
            if (!response.body) throw new Error("任务文本流不可用");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parser = createTaskTextStreamParser();
            const onEvent = (event: TaskTextStreamEvent) => {
                const payload = asTaskTextStreamRecord(event.data);
                if (event.event === "delta") {
                    const sequence = numberValue(payload.sequence) || event.id || 0;
                    if (sequence <= lastEventId) return;
                    const content = typeof payload.content === "string" ? payload.content : "";
                    lastEventId = sequence;
                    if (!content) return;
                    fullText += content;
                    options.onTextDelta?.(fullText);
                    if (lastTask) {
                        lastTask = { ...lastTask, textDraft: fullText };
                        options.onTaskUpdate?.(lastTask);
                    }
                    return;
                }
                if (event.event === "progress") {
                    if (!lastTask) return;
                    lastTask = {
                        ...lastTask,
                        ...(isTaskStatus(payload.status) ? { status: payload.status } : {}),
                        ...(typeof payload.stage === "string" ? { stage: payload.stage } : {}),
                        ...(numberValue(payload.progress) !== undefined ? { progress: numberValue(payload.progress) } : {}),
                    };
                    options.onTaskUpdate?.(lastTask);
                    return;
                }
                if (event.event === "terminal") {
                    terminalReceived = true;
                    if (typeof payload.finalText === "string" && payload.finalText !== fullText) {
                        fullText = payload.finalText;
                        options.onTextDelta?.(fullText);
                    }
                    return;
                }
                if (event.event === "error") throw new Error(typeof payload.message === "string" ? payload.message : "任务文本流不可用");
            };
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                consumeTaskTextStream(parser, decoder.decode(value, { stream: true }), onEvent);
            }
            consumeTaskTextStream(parser, decoder.decode(), onEvent, true);
            if (terminalReceived) {
                const completed = await queryGenerationTask(id, { signal: options.signal });
                options.onTaskUpdate?.(completed);
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                if (completed.status === "succeeded") return completed;
                if (completed.status === "failed" || completed.status === "cancelled") {
                    throw new TaskTextStreamFatalError(completed.error ? generationErrorMessage(completed.error) : `任务${completed.status === "cancelled" ? "已取消" : "失败"}`);
                }
            }
            lastStreamError = new Error("任务文本流连接提前结束");
        } catch (error) {
            if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            if (error instanceof TaskTextStreamFatalError) throw error;
            lastStreamError = error;
        }
        await delay(intervalMs, options.signal);
    }
    throw new Error(lastStreamError instanceof Error ? `任务文本流同步失败：${lastStreamError.message}` : "任务执行超时，请稍后重试");
}

function asTaskTextStreamRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isTaskStatus(value: unknown): value is TaskStatus {
    return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

class TaskTextStreamFatalError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TaskTextStreamFatalError";
    }
}

async function taskTextStreamHTTPError(response: Response) {
    try {
        const payload = await response.json() as { msg?: unknown };
        if (typeof payload.msg === "string" && payload.msg.trim()) return payload.msg;
    } catch {
        // SSE 错误响应可能是空正文或网关 HTML，只返回状态码，避免泄露正文。
    }
    return `任务文本流请求失败（HTTP ${response.status}）`;
}

function taskWaitTimeoutMs(task?: GenerationTask) {
    const type = task?.type || "";
    if (type.includes("storyboard")) return 13 * 60 * 1000;
    if (type.includes("video")) return 32 * 60 * 1000;
    if (type.includes("image")) return 10 * 60 * 1000;
    if (type.includes("text") || type.includes("audio")) return 12 * 60 * 1000;
    return 10 * 60 * 1000;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function notifyCanvasTaskCreated(task: GenerationTask) {
    if (typeof window === "undefined" || !task.projectId) return;
    window.dispatchEvent(new CustomEvent("canvas:task-created", { detail: { task } }));
}
