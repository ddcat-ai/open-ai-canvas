import axios from "axios";

import { generationErrorMessage } from "@/lib/generation-error";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type TaskBillingStatus = "reserved" | "running" | "settled" | "refunded" | "uncertain";
export type AgentSessionStatus = "active" | "completed" | "failed";

export type BackendEnvelope<T> = {
    code: number;
    data: T;
    msg: string;
};

export type GenerationTask = {
    id: string;
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
    errorCode?: string;
    inputJson?: string;
    resultJson?: string;
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
    created_at?: string;
    updated_at?: string;
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
    level: "info" | "warn" | "error" | string;
    message: string;
    payload?: string;
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
    config?: Record<string, unknown>;
};

export type CreateTaskInput = {
    sessionId?: string;
    projectId?: string;
    type?: string;
    operation?: string;
    prompt: string;
    provider?: string;
    model?: string;
    input?: Record<string, unknown>;
};

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    try {
        const response = await promise;
        if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
        return response.data.data;
    } catch (error) {
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) {
            throw new Error(error.response?.data?.msg || error.message || "请求失败");
        }
        throw error;
    }
}

export function createAgentSession(input: CreateSessionInput) {
    return request<AgentSessionDetail>(api.post("/create_session", input)).then((detail) => {
        detail.tasks.forEach((task) => notifyCanvasTaskCreated(task));
        return detail;
    });
}

export function queryAgentSession(id: string) {
    return request<AgentSessionDetail>(api.get(`/query_session/${encodeURIComponent(id)}`));
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
    return request<TaskResult[]>(api.get(`/download_results/${encodeURIComponent(id)}`));
}

export function uploadAgentFile(sessionId: string, file: File) {
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("file", file);
    return request<SessionFile>(api.post("/upload_file", formData));
}

export function createGenerationTask(input: CreateTaskInput) {
    return request<GenerationTask>(api.post("/tasks", input)).then((task) => {
        notifyCanvasTaskCreated(task);
        return task;
    });
}

export function listGenerationTasks(limit = 30, options?: { projectId?: string; activeOnly?: boolean }) {
    return request<GenerationTask[]>(api.get("/tasks", { params: { limit, projectId: options?.projectId, activeOnly: options?.activeOnly || undefined } }));
}

export function queryGenerationTask(id: string) {
    return request<GenerationTask>(api.get(`/tasks/${encodeURIComponent(id)}`));
}

export function retryGenerationTask(id: string) {
    return request<GenerationTask>(api.post(`/tasks/${encodeURIComponent(id)}/retry`));
}

export function cancelGenerationTask(id: string) {
    return request<GenerationTask>(api.post(`/tasks/${encodeURIComponent(id)}/cancel`));
}

export function listTaskLogs(id: string) {
    return request<TaskLog[]>(api.get(`/tasks/${encodeURIComponent(id)}/logs`));
}

export async function waitForGenerationTask(id: string, options?: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number; initialTask?: GenerationTask; onTaskUpdate?: (task: GenerationTask) => void }) {
    const startedAt = Date.now();
    const intervalMs = options?.intervalMs || 2000;
    let lastTask = options?.initialTask;
    let lastQueryError: unknown;
    while (Date.now() - startedAt < (options?.timeoutMs || taskWaitTimeoutMs(lastTask))) {
        if (options?.signal?.aborted) {
            await cancelGenerationTask(id).catch(() => undefined);
            throw new DOMException("Aborted", "AbortError");
        }
        let task: GenerationTask;
        try {
            task = await queryGenerationTask(id);
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
