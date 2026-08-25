import { DREAMINA_SUBMIT_ERROR_MESSAGES, generationErrorMessage } from "@/lib/generation-error";
import { apiClient, request, type BackendEnvelope } from "@/services/api/request";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";
import {
    deleteLocalDreaminaGenerationTask,
    listLocalDreaminaGenerationTaskPage,
    queryLocalDreaminaGenerationTask,
    refreshLocalDreaminaGenerationTask,
    waitForLocalDreaminaGenerationTask,
    type LocalDreaminaGenerationTask,
} from "@/services/local-dreamina-generation";
import { isLocalDreaminaTaskId, projectLocalDreaminaDiagnosticLog, projectLocalDreaminaTask, stripLocalDreaminaTaskPrefix } from "@/services/local-dreamina-task-projection";

export type { BackendEnvelope } from "@/services/api/request";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type TaskBillingStatus = "reserved" | "running" | "settled" | "refunded" | "uncertain";
export type ProviderCancelStatus = "requested" | "confirmed" | "uncertain";
export type AgentSessionStatus = "active" | "completed" | "failed";
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
    sessionId?: string;
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
};

export type AgentSession = {
    id: string;
    projectId?: string;
    status: AgentSessionStatus;
    prompt: string;
    canvasSnapshotJson?: string;
    canvasOpsJson?: string;
    createdAt: string;
    updatedAt: string;
};

export type AgentMessage = {
    id: string;
    sessionId: string;
    role: "user" | "assistant" | "system" | "tool" | string;
    content: string;
    payload?: string;
    createdAt: string;
};

export type TaskResult = {
    id: string;
    taskId: string;
    sessionId?: string;
    kind: string;
    url?: string;
    payload?: string;
    createdAt: string;
};

export type SessionFile = {
    id: string;
    sessionId: string;
    fileName: string;
    mimeType: string;
    size: number;
    createdAt: string;
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

export type AgentSessionDetail = {
    session: AgentSession;
    messages: AgentMessage[];
    tasks: GenerationTask[];
    results: TaskResult[];
};

export type CreateSessionInput = {
    projectId?: string;
    prompt: string;
    canvasSnapshot?: Record<string, unknown>;
    references?: string[];
    projectStyle?: { presetId: string; title: string; prompt: string };
    characters?: Array<{ assetId: string; versionId: string; name: string; definition: Record<string, unknown> }>;
    config?: Record<string, unknown>;
	logicalModelId?: string;
};

export type CreateTaskInput = {
    sessionId?: string;
    projectId?: string;
    type?: string;
    operation?: string;
    prompt: string;
    provider?: string;
    model?: string;
	logicalModelId?: string;
    input?: Record<string, unknown>;
};

const api = apiClient;

export function createAgentSession(input: CreateSessionInput) {
    return request<AgentSessionDetail>(api.post("/sessions", input)).then((detail) => {
        detail.tasks.forEach((task) => notifyCanvasTaskCreated(task));
        return detail;
    });
}

export function queryAgentSession(id: string) {
    return request<AgentSessionDetail>(api.get(`/sessions/${encodeURIComponent(id)}`));
}

export function agentSessionFailureMessage(detail: AgentSessionDetail, fallback = "后端影视 Agent 会话失败") {
    for (let index = detail.tasks.length - 1; index >= 0; index -= 1) {
        const task = detail.tasks[index];
        if ((task.status === "failed" || task.status === "cancelled") && task.error?.trim()) return generationErrorMessage(task.error.trim());
    }
    for (let index = detail.messages.length - 1; index >= 0; index -= 1) {
        const message = detail.messages[index];
        if (message.role === "assistant" && message.content.trim()) return generationErrorMessage(message.content.trim());
    }
    return fallback;
}

export function downloadSessionResults(id: string) {
    return request<TaskResult[]>(api.get(`/sessions/${encodeURIComponent(id)}/results`));
}

export function uploadAgentFile(sessionId: string, file: File) {
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("file", file);
    return request<SessionFile>(api.post("/files", formData));
}

export function createGenerationTask(input: CreateTaskInput) {
    return request<GenerationTask>(api.post("/tasks", input)).then((task) => {
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
    listLocal?(options?: GenerationTaskListOptions, signal?: AbortSignal): Promise<LocalDreaminaGenerationTask[]>;
    listBackendPage?(request: GenerationTaskPageRequest, signal?: AbortSignal): Promise<GenerationTaskPage<GenerationTask>>;
    listLocalPage?(request: GenerationTaskPageRequest, signal?: AbortSignal): Promise<GenerationTaskPage<LocalDreaminaGenerationTask>>;
};

const defaultGenerationTaskListDependencies: GenerationTaskListDependencies = {
    listBackendPage: async (page, signal) => ({
        tasks: await request<GenerationTask[]>(
            api.get("/tasks", {
                params: { limit: Math.min(page.limit, 100), projectId: page.projectId, activeOnly: page.activeOnly || undefined },
                signal,
            }),
        ),
    }),
    listLocalPage: (page, signal) => listLocalDreaminaGenerationTaskPage(page, {}, signal),
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
    const localPageReader =
        dependencies.listLocalPage ??
        (async (page: GenerationTaskPageRequest, pageSignal?: AbortSignal) => ({
            tasks:
                (await dependencies.listLocal?.(
                    {
                        ...(page.projectId ? { projectId: page.projectId } : {}),
                        activeOnly: page.activeOnly,
                    },
                    pageSignal,
                )) ?? [],
        }));
    const [backendTasks, localTasks] = await Promise.all([collectGenerationTaskPages(backendPageReader, baseRequest, boundedLimit, signal), collectGenerationTaskPages(localPageReader, baseRequest, boundedLimit, signal).catch(() => [])]);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return [...backendTasks, ...localTasks.map((task) => projectLocalDreaminaTask(task))]
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
    if (isLocalDreaminaTaskId(id)) {
        return queryLocalDreaminaGenerationTask(stripLocalDreaminaTaskPrefix(id), undefined, {}, options?.signal).then((task) => projectLocalDreaminaTask(task));
    }
    return request<GenerationTask>(api.get(`/tasks/${encodeURIComponent(id)}`, { signal: options?.signal }));
}

export function waitForLocalGenerationTask(id: string, options?: { signal?: AbortSignal }) {
    if (!isLocalDreaminaTaskId(id)) return Promise.reject(new Error("当前任务不是本机即梦任务"));
    return waitForLocalDreaminaGenerationTask(stripLocalDreaminaTaskPrefix(id), undefined, {}, options?.signal).then((task) => projectLocalDreaminaTask(task));
}

export function splitGenerationTaskObservationIds(ids: readonly string[]) {
    return {
        localWaitIds: ids.filter(isLocalDreaminaTaskId),
        remotePollIds: ids.filter((id) => !isLocalDreaminaTaskId(id)),
    };
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
        })().catch(() => undefined);
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
    return request<TaskTextDelta>(api.post(`/tasks/${encodeURIComponent(id)}/text-deltas`, { content }));
}

export function completeTextReplayTask(id: string, text: string) {
    return request<GenerationTask>(api.post(`/tasks/${encodeURIComponent(id)}/text-replay-complete`, { text }));
}

export function queryTaskTextReplay(id: string, after = 0) {
    return request<TaskTextReplay>(api.get(`/tasks/${encodeURIComponent(id)}/text-deltas`, { params: { after } }));
}

export function retryGenerationTask(id: string) {
    return request<GenerationTask>(api.post(`/tasks/${encodeURIComponent(id)}/retry`));
}

export function queryFailedVideoProviderTask(id: string) {
    return request<ProviderTaskQueryResult>(api.post(`/tasks/${encodeURIComponent(id)}/query-provider`));
}

export function refreshGenerationTaskStatus(id: string, options?: { signal?: AbortSignal }) {
    if (!isLocalDreaminaTaskId(id)) return Promise.reject(new Error("当前任务不支持手动更新官方状态"));
    return refreshLocalDreaminaGenerationTask(stripLocalDreaminaTaskPrefix(id), {}, options?.signal).then((task) => projectLocalDreaminaTask(task));
}

export function deleteGenerationTask(id: string) {
    if (!isLocalDreaminaTaskId(id)) return Promise.reject(new Error("当前任务不支持删除"));
    return deleteLocalDreaminaGenerationTask(stripLocalDreaminaTaskPrefix(id));
}

export async function listTaskLogs(id: string) {
    if (isLocalDreaminaTaskId(id)) {
        const task = await queryGenerationTask(id);
        return [projectGenerationTaskSafeLog(task)];
    }
    const raw = await request<Array<{ level?: unknown; message?: unknown; payload?: unknown; createdAt?: unknown }>>(api.get(`/tasks/${encodeURIComponent(id)}/logs`));
    return raw.map((log, index) => projectBackendSafeTaskLog(id, log, index));
}

export function formatTaskLog(log: TaskLog) {
    return [`stage=${log.stage}`, ...(log.errorCode ? [`error=${log.errorCode}`] : []), `provenance=${log.provenance}`, ...(log.observedAt ? [`observedAt=${log.observedAt}`] : [])].join(" ");
}

function projectGenerationTaskSafeLog(task: GenerationTask): TaskLog {
    const diagnostic = projectLocalDreaminaDiagnosticLog({
        level: task.errorCode || task.status === "failed" || task.status === "cancelled" ? "error" : "info",
        stage: task.stage || task.status,
        errorCode: task.errorCode,
        provenance: task.officialStatus ? "provider_observation" : "task_state",
        observedAt: task.updatedAt,
    });
    return {
        id: `safe:${task.id}:${task.updatedAt}`,
        taskId: task.id,
        ...diagnostic,
        createdAt: diagnostic.observedAt,
    };
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

const SAFE_TASK_LOG_ERROR_CODES = new Set([...Object.keys(DREAMINA_SUBMIT_ERROR_MESSAGES), "dreamina_query_failed", "dreamina_submission_unknown", "dreamina_reference_invalid"]);

function safeTaskLogErrorCode(value: unknown) {
    if (typeof value !== "string") return undefined;
    for (const match of value.matchAll(/(?:dreamina|local_generation|model|provider)_[a-z0-9_]{2,80}/gi)) {
        const errorCode = match[0].toLowerCase();
        if (SAFE_TASK_LOG_ERROR_CODES.has(errorCode)) return errorCode;
    }
    return undefined;
}

export async function waitForGenerationTask(id: string, options?: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number; initialTask?: GenerationTask; onTaskUpdate?: (task: GenerationTask) => void }) {
    if (isLocalDreaminaTaskId(id)) {
        try {
            const task = await waitForLocalGenerationTask(id, { signal: options?.signal });
            options?.onTaskUpdate?.(task);
            if (task.status === "succeeded") return task;
            if (task.status === "failed" || task.status === "cancelled") {
                throw new Error(task.error ? generationErrorMessage(task.error) : `任务${task.status === "cancelled" ? "已取消" : "失败"}`);
            }
            throw new Error("本机即梦任务等待提前结束");
        } catch (error) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            throw error;
        }
    }
    const startedAt = Date.now();
    const intervalMs = options?.intervalMs || 2000;
    let lastTask = options?.initialTask;
    let lastQueryError: unknown;
    try {
        while (Date.now() - startedAt < (options?.timeoutMs || taskWaitTimeoutMs(lastTask))) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            let task: GenerationTask;
            try {
                task = await queryGenerationTask(id, { signal: options?.signal });
                lastTask = task;
                lastQueryError = undefined;
                options?.onTaskUpdate?.(task);
            } catch (error) {
                lastQueryError = error;
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
