export type BridgeInfo = { baseUrl: string; adminToken: string };
export type BridgeStatus = { phase: "preparing" | "ready" | "login-needed" | "unavailable"; detail?: string };
export type BridgeTask = {
    id: string;
    kind?: string;
    nodeId?: string | null;
    status: string;
    prompt: string;
    error: string | null;
    note?: string | null;
    accountId: string | null;
    attempt: number;
};
export type ConvMessage = { id: string; role: "user" | "bot"; text: string; hasVideo: boolean };
export type ConvScan = { messages?: ConvMessage[]; conversationId?: string | null; taskId: string; accountId: string; attempt: number };
type DesktopBridgeApi = {
    doubaoBridgeInfo: () => Promise<BridgeInfo | null>;
    doubaoBridgeStatus: () => Promise<BridgeStatus>;
    retryDoubaoBridge: () => Promise<boolean>;
    onDoubaoBridgeStatus: (callback: (status: BridgeStatus) => void) => () => void;
    beep?: (kind: "ok" | "error") => Promise<boolean>;
};
export const desktopBridgeApi = typeof window === "undefined" ? undefined : (window as unknown as { desktop?: DesktopBridgeApi }).desktop;

export class BridgeHttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

async function bridgeRequest<T>(bridge: BridgeInfo, pathname: string, signal: AbortSignal, body?: unknown): Promise<T> {
    const response = await fetch(`${bridge.baseUrl.replace(/\/+$/, "")}${pathname}`, {
        method: body === undefined ? "GET" : "POST",
        signal,
        headers: { Authorization: `Bearer ${bridge.adminToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new BridgeHttpError(response.status, result?.detail || `豆包服务请求失败（${response.status}）`);
    return result as T;
}

export async function readConversation(bridge: BridgeInfo, task: Pick<BridgeTask, "id" | "accountId" | "attempt">, signal: AbortSignal) {
    if (!task.accountId) throw new BridgeHttpError(409, "任务正在等待分配账号");
    const params = new URLSearchParams({ taskId: task.id, account: task.accountId, attempt: String(task.attempt) });
    const result = await bridgeRequest<ConvScan>(bridge, `/conversation?${params}`, signal);
    if (result.taskId !== task.id || result.accountId !== task.accountId || result.attempt !== task.attempt) throw new Error("会话所属任务已变化，请等待刷新");
    return result;
}
export function sendConversation(bridge: BridgeInfo, task: BridgeTask, text: string, signal: AbortSignal) {
    return bridgeRequest(bridge, "/conversation/send", signal, { taskId: task.id, account: task.accountId, attempt: task.attempt, text });
}
export function retryBridgeTask(bridge: BridgeInfo, taskId: string, signal: AbortSignal) {
    return bridgeRequest(bridge, `/v1/tasks/${encodeURIComponent(taskId)}/retry`, signal, {});
}

// Schedule after completion, so slow requests cannot overlap. Cleanup also fences late responses.
export function pollSequentially<T>(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, onError: (error: unknown) => void, intervalMs: number) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
        try {
            const value = await load(controller.signal);
            if (!controller.signal.aborted) apply(value);
        } catch (error) {
            if (!controller.signal.aborted) onError(error);
        } finally {
            if (!controller.signal.aborted) timer = setTimeout(() => void tick(), intervalMs);
        }
    };
    void tick();
    return () => {
        controller.abort();
        clearTimeout(timer);
    };
}

// Each connection starts with an authoritative snapshot. Polling is canceled before applying it.
type TaskSubscriptionOptions = {
    createEventSource?: (url: string) => EventSource;
    reconnectDelayMs?: number;
    pollIntervalMs?: number;
};

export function subscribeBridgeTasks(bridge: BridgeInfo, apply: (tasks: BridgeTask[]) => void, onError: (error: unknown) => void, options: TaskSubscriptionOptions = {}) {
    let closed = false;
    let source: EventSource | undefined;
    let generation = 0;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let stopPolling: (() => void) | undefined;
    let tasks: BridgeTask[] = [];
    let snapshotReceived = false;
    const fallback = () => {
        if (closed || stopPolling) return;
        stopPolling = pollSequentially(
            (signal) => bridgeRequest<{ data: BridgeTask[] }>(bridge, "/v1/tasks", signal),
            (result) => {
                tasks = result.data;
                apply(tasks);
            },
            onError,
            options.pollIntervalMs ?? 5000,
        );
    };
    const connect = () => {
        if (closed) return;
        const currentGeneration = ++generation;
        snapshotReceived = false;
        const currentSource = (options.createEventSource ?? ((url) => new EventSource(url)))(`${bridge.baseUrl.replace(/\/+$/, "")}/v1/events?token=${encodeURIComponent(bridge.adminToken)}`);
        source = currentSource;
        currentSource.onmessage = (event) => {
            if (closed || currentGeneration !== generation) return;
            let payload: { type?: string; tasks?: BridgeTask[]; task?: BridgeTask };
            try {
                payload = JSON.parse(event.data);
            } catch {
                return;
            }
            if (payload.type === "snapshot" && Array.isArray(payload.tasks)) {
                stopPolling?.();
                stopPolling = undefined;
                snapshotReceived = true;
                tasks = payload.tasks;
                apply(tasks);
            } else if (snapshotReceived && payload.type === "task" && payload.task) {
                const task = payload.task;
                tasks = tasks.some((item) => item.id === task.id) ? tasks.map((item) => (item.id === task.id ? task : item)) : [task, ...tasks];
                apply(tasks);
            }
        };
        currentSource.onerror = () => {
            if (closed || currentGeneration !== generation) return;
            generation += 1;
            currentSource.close();
            if (source === currentSource) source = undefined;
            onError(new Error("实时连接暂时中断，正在重连；任务状态仍会自动刷新"));
            fallback();
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, options.reconnectDelayMs ?? 10000);
        };
    };
    fallback();
    connect();
    return () => {
        closed = true;
        generation += 1;
        source?.close();
        stopPolling?.();
        clearTimeout(reconnectTimer);
    };
}
