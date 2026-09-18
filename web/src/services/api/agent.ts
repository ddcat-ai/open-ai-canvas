import { http, apiBaseURL } from "@/services/api/request";
import { consumeTaskTextStream, createTaskTextStreamParser } from "@/services/api/task-text-stream";

export type AgentPermissionMode = "read_only" | "auto" | "request_approval";
export type AgentReasoningMode = "off" | "auto" | "deep";
export type AgentMediaSettings = {
    logicalModelId?: string;
    channelId?: string;
    channelModelKey?: string;
    size: string;
    quality: string;
};
export type AgentProfileScope = "user" | "project" | "canvas";

export type AgentProfileLayer = {
    scope: AgentProfileScope;
    projectId?: string;
    canvasId?: string;
    content: string;
    revision: number;
    hash: string;
};

export type AgentProfileView = {
    revision: string;
    hash: string;
    layers: AgentProfileLayer[];
};

export type AgentApprovalPreviewOperation = "add_node" | "update_node" | "connect_nodes" | "generate_media" | "create_storyboard" | "edit_storyboard" | "plan_step";

export type AgentApprovalPreviewItem = {
    operation: AgentApprovalPreviewOperation;
    nodeId?: string;
    nodeTitle?: string;
    resultTitle?: string;
    nodeType?: string;
    nodeTypeLabel?: string;
    targetNodeId?: string;
    targetNodeTitle?: string;
    targetNodeType?: string;
    fields?: string[];
    details?: string[];
    summary: string;
};

export type AgentApprovalPreview = {
    kind: string;
    title: string;
    description: string;
    items: AgentApprovalPreviewItem[];
};

export type AgentApproval = {
    modelName?: string;
    approvalId: string;
    call: { id: string; function: { name: string; arguments: string } };
    callHash?: string;
    preview?: AgentApprovalPreview;
    decision?: "approve" | "reject";
    reason?: string;
};

export type AgentRun = {
    id: string;
    canvasId: string;
    status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "rejected";
    permissionMode: AgentPermissionMode;
    revision?: number;
    cleanupPending?: boolean;
    failureMessage?: string;
    model?: string;
    createdAt: string;
    updatedAt: string;
    skills?: Array<{ id: string; name: string; version: string; hash: string }>;
    events?: AgentEvent[];
    spentCredits?: number;
    step?: number;
    activeMessage?: { messageId: string; text: string };
    approval?: AgentApproval;
};

export type AgentEvent = {
    eventId: string;
    runId: string;
    seq: number;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
    /** Local delivery order for synthetic snapshot events; never used as a resume cursor. */
    localSeq?: number;
};

/** 事件流本身不是 http 封装请求，单独保留状态码供 UI 区分旧后端/失效轮次。 */
export class AgentStreamError extends Error {
    readonly status: number;

    constructor(status: number) {
        super(`Agent 事件流不可用 (${status})`);
        this.name = "AgentStreamError";
        this.status = status;
    }
}

export type CreateAgentRunInput = {
    reasoningMode?: AgentReasoningMode;
    profileRevision?: string;
    canvasId: string;
    prompt: string;
    model?: string;
    logicalModelId?: string;
    channelId?: string;
    channelModelKey?: string;
    skillIds?: string[];
    permissionMode?: AgentPermissionMode;
    contextScope?: string[];
    budget?: { maxCredits?: number; maxGenerationTasks?: number; maxVideoSeconds?: number; maxSteps?: number };
    idempotencyKey: string;
};

// Only Agent admission endpoints have server-side fingerprint/idempotency protection.
// Never apply this policy to arbitrary provider generation POSTs.
async function submitAgentRequest(path: string, input: CreateAgentRunInput) {
    const body = JSON.parse(JSON.stringify(input)) as CreateAgentRunInput;
    for (let attempt = 0; ; attempt++) {
        try {
            return await http.post<{ run: AgentRun }>(path, body, { timeout: 15_000 });
        } catch (cause) {
            const error = cause as { retryable?: boolean; retryAfterMs?: number };
            if (!error.retryable || attempt >= 2) throw cause;
            const delay = Math.max(500 * 2 ** attempt * (0.75 + Math.random() * 0.5), error.retryAfterMs || 0);
            // Long rate-limit waits return control to the user with the original
            // pending request intact instead of keeping the composer hung.
            if (delay > 10_000) throw cause;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

export async function createAgentRun(input: CreateAgentRunInput) {
    return submitAgentRequest("/agent/runs", input);
}

export async function sendAgentMessage(runId: string, input: CreateAgentRunInput) {
    return submitAgentRequest(`/agent/runs/${encodeURIComponent(runId)}/messages`, input);
}

export function sendAgentInterjection(runId: string, input: { text: string; messageId: string }) {
    return http.post<{ accepted: boolean; pending: number }>(`/agent/runs/${encodeURIComponent(runId)}/interjections`, input, { timeout: 20_000 });
}

export function getAgentCapabilities() {
    return http.get<{ version: number; permissionModes: AgentPermissionMode[]; contextScopes: string[]; skills: boolean; writeTools: boolean; capabilitySetVersion?: string; capabilitySetHash?: string; nodeTypes?: string[] }>("/agent/capabilities", { timeout: 15_000 });
}

export function getAgentProfile(options: { projectId?: string; canvasId?: string; scope?: AgentProfileScope } = {}) {
    const params = new URLSearchParams();
    if (options.projectId) params.set("projectId", options.projectId);
    if (options.canvasId) params.set("canvasId", options.canvasId);
    if (options.scope) params.set("scope", options.scope);
    const query = params.toString();
    return http.get<AgentProfileView>(`/agent/profile${query ? `?${query}` : ""}`, { timeout: 15_000 });
}

export function updateAgentProfile(input: { scope: AgentProfileScope; projectId?: string; canvasId?: string; content: string; revision: number }) {
    return http.patch<AgentProfileView>("/agent/profile", input, { timeout: 15_000 });
}

export function getAgentRun(runId: string, signal?: AbortSignal) {
    return http.get<{ run: AgentRun }>(`/agent/runs/${encodeURIComponent(runId)}`, { signal });
}

export function cancelAgentRun(runId: string) {
    return http.post<{ accepted: boolean }>(`/agent/runs/${encodeURIComponent(runId)}/cancel`, undefined, { timeout: 15_000 });
}

export function undoAgentCanvasRun(runId: string, input: { stepId?: string; expectedSnapshotHash: string; reason?: string }, signal?: AbortSignal) {
    return http.post<{ accepted: boolean; snapshotHash: string }>(`/agent/runs/${encodeURIComponent(runId)}/undo`, input, { signal });
}

export async function decideAgentApproval(runId: string, approvalId: string, decision: "approve" | "reject", reason?: string, signal?: AbortSignal, mediaSettings?: AgentMediaSettings) {
    return http.post<{ accepted: boolean }>(`/agent/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decision`, { decision, reason: reason?.trim() || undefined, ...(mediaSettings ? { mediaSettings } : {}) }, { signal });
}

export function subscribeAgentEvents(runId: string, onEvent: (event: AgentEvent) => void, options: { after?: number; onError?: (error: unknown) => void; onConnectionChange?: (status: "connecting" | "connected" | "reconnecting" | "disconnected") => void; timeoutMs?: number } = {}) {
    const controller = new AbortController();
    let localSeq = 0;
    let cursor = Number.isSafeInteger(options.after) && (options.after as number) > 0 ? options.after as number : 0;
    let lastActiveMessageKey = "";
    let lastStatusKey = "";
    const emit = (type: string, payload: Record<string, unknown>) => {
        if (controller.signal.aborted) return;
        onEvent({ eventId: `${runId}:snapshot:${++localSeq}`, runId, seq: 0, type, payload, localSeq, createdAt: new Date().toISOString() });
    };
    void (async () => {
        let failures = 0;
        while (!controller.signal.aborted) {
            let terminal = false;
            let retryAfterMs = 0;
            const attempt = new AbortController();
            const abortAttempt = () => attempt.abort();
            controller.signal.addEventListener("abort", abortAttempt, { once: true });
            let watchdog: ReturnType<typeof setTimeout>;
            const touch = () => { clearTimeout(watchdog); watchdog = setTimeout(abortAttempt, options.timeoutMs ?? 45_000); };
            touch();
            options.onConnectionChange?.(failures ? "reconnecting" : "connecting");
            try {
                const response = await fetch(`${String(apiBaseURL).replace(/\/+$/, "")}/agent/runs/${encodeURIComponent(runId)}/events?after=${cursor}`, { credentials: "include", signal: attempt.signal, headers: { Accept: "text/event-stream", "Last-Event-ID": String(cursor) } });
                if (!response.ok) {
                    const error = new AgentStreamError(response.status);
                    const header = response.headers.get("retry-after");
                    if (header) retryAfterMs = Math.max(0, /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) || 0;
                    if (retryAfterMs > 300_000) {
                        await response.body?.cancel();
                        options.onConnectionChange?.("disconnected");
                        options.onError?.(error);
                        return;
                    }
                    await response.body?.cancel();
                    if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
                        options.onConnectionChange?.("disconnected");
                        options.onError?.(error);
                        return;
                    }
                    throw error;
                }
                if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new AgentStreamError(response.status);
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const parser = createTaskTextStreamParser();
                const connectedAt = Date.now();
                touch();
                const cancelReader = () => { void reader.cancel().catch(() => undefined); };
                attempt.signal.addEventListener("abort", cancelReader, { once: true });
                try {
                    while (!controller.signal.aborted && !attempt.signal.aborted) {
                        const { value, done } = await reader.read();
                        if (value?.length) touch();
                        consumeTaskTextStream(parser, decoder.decode(value, { stream: !done }), (item) => {
                            if (item.event === "agent_event") {
                                const event = item.data as AgentEvent;
                                if (event.runId !== runId || !Number.isSafeInteger(event.seq) || event.seq <= cursor) return;
                                cursor = event.seq;
                                failures = 0;
                                options.onConnectionChange?.("connected");
                                onEvent({ ...event, localSeq: ++localSeq });
                            } else if (item.event === "run_snapshot") {
                                const run = item.data as AgentRun;
                                if (run.id !== runId) return;
                                options.onConnectionChange?.("connected");
                                if (run.activeMessage) {
                                    const messageKey = `${run.activeMessage.messageId}\u0000${run.activeMessage.text}`;
                                    if (messageKey !== lastActiveMessageKey) {
                                        lastActiveMessageKey = messageKey;
                                        emit("assistant_message", run.activeMessage);
                                    }
                                }
                                const statusPayload = { status: run.status, revision: run.revision, cleanupPending: run.cleanupPending, failureMessage: run.failureMessage, skills: run.skills, spentCredits: run.spentCredits, step: run.step, approval: run.approval };
                                const statusKey = JSON.stringify(statusPayload);
                                if (statusKey !== lastStatusKey) {
                                    lastStatusKey = statusKey;
                                    emit("run_status", statusPayload);
                                }
                                terminal = !run.cleanupPending && ["completed", "failed", "cancelled", "rejected"].includes(run.status);
                            } else if (item.event === "error") throw new Error("Agent 状态读取失败");
                        }, done);
                        // A repeated initial snapshot is not a healthy connection.
                        // Sustained heartbeat traffic or advancing events reset the budget.
                        if (Date.now() - connectedAt >= 30_000 && value?.length) failures = 0;
                        if (done || terminal) break;
                    }
                } finally {
                    attempt.signal.removeEventListener("abort", cancelReader);
                    await reader.cancel().catch(() => undefined);
                    reader.releaseLock();
                }
                if (terminal) return;
                throw new Error("Agent 连接已中断，运行仍保留，可重新连接");
            } catch (error) {
                if (controller.signal.aborted) return;
                if (++failures >= 5) {
                    options.onConnectionChange?.("disconnected");
                    options.onError?.(error);
                    return;
                }
            } finally {
                clearTimeout(watchdog!);
                controller.signal.removeEventListener("abort", abortAttempt);
                attempt.abort();
            }
            options.onConnectionChange?.("reconnecting");
            await new Promise<void>((resolve) => {
                const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
                const backoff = Math.min(1000 * 2 ** failures, 15000) * (0.75 + Math.random() * 0.5);
                const timer = setTimeout(finish, Math.max(backoff, Math.min(retryAfterMs, 300_000)));
                controller.signal.addEventListener("abort", finish, { once: true });
                if (controller.signal.aborted) finish();
            });
        }
    })();
    return () => controller.abort();
}
