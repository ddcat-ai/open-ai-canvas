import type { LocalRuntimeTransport } from "@/services/local-runtime";

export type LocalRuntimeEvent = {
    type: string;
    data: string;
    id?: string;
};

export type LocalRuntimeEventStreamOptions = {
    signal?: AbortSignal;
    lastEventId?: string;
    onEvent(event: LocalRuntimeEvent): void;
};

export class CanvasRuntimeStreamError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "CanvasRuntimeStreamError";
    }
}

const MAX_EVENT_BYTES = 256 * 1024;
const AUTO_CONNECT_MODES = new Set(["new", "recent", "choose"]);

export function shouldAutoConnectCanvasRuntime(params: URLSearchParams) {
    return AUTO_CONNECT_MODES.has(params.get("mode") ?? "");
}

type CanvasRuntimeStore = {
    getState(): {
        connection: string;
        modules: Array<{ id: string }>;
        error?: string;
        connect(signal?: AbortSignal): Promise<void>;
    };
};

export async function prepareCanvasRuntimeConnection(store: CanvasRuntimeStore, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await store.getState().connect(signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const state = store.getState();
    if (state.connection !== "connected" || state.error) {
        throw new CanvasRuntimeStreamError("canvas_runtime_unavailable", "本机运行时尚未连接");
    }
    if (!state.modules.some((module) => module.id === "canvas-agent")) {
        throw new CanvasRuntimeStreamError("canvas_module_unavailable", "Canvas Agent 模块未加载");
    }
}

export function waitForCanvasRuntimeReconnect(signal: AbortSignal, delayMs = 1_000) {
    return new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };
        const timer = setTimeout(finish, delayMs);
        signal.addEventListener("abort", finish, { once: true });
    });
}

export type CanvasRuntimeStateResult = {
    accepted: boolean;
    revision: number;
    stateHash: string;
    idempotent?: boolean;
    reason?: string;
};

export async function postCanvasRuntimeState(client: LocalRuntimeTransport, clientId: string, snapshot: unknown): Promise<CanvasRuntimeStateResult> {
    try {
        const response = await client.request(`/canvas/state?clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot),
        });
        const body = await response.json().catch(() => null) as Partial<CanvasRuntimeStateResult> | null;
        if (!response.ok && response.status !== 409) throw new Error("Canvas Agent 状态同步请求失败");
        if (body?.accepted !== true || typeof body.revision !== "number" || typeof body.stateHash !== "string") {
            throw new CanvasRuntimeStreamError("canvas_state_conflict", body?.reason === "stale_revision" || body?.reason === "revision_conflict" ? "画布状态已被其他操作更新，请重新读取后再试" : "画布状态同步被拒绝");
        }
        return { accepted: true, revision: body.revision, stateHash: body.stateHash, idempotent: body.idempotent, reason: body.reason };
    } catch (error) {
        if (error instanceof CanvasRuntimeStreamError) throw error;
        throw new CanvasRuntimeStreamError("canvas_state_sync_failed", "画布状态同步失败");
    }
}

export async function consumeLocalRuntimeEventStream(client: LocalRuntimeTransport, path: string, options: LocalRuntimeEventStreamOptions) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const headers = new Headers();
    if (options.lastEventId) headers.set("Last-Event-ID", options.lastEventId);
    const response = await client.request(path, {
        method: "GET",
        headers,
        signal: options.signal,
    });
    if (!response.ok) throw new CanvasRuntimeStreamError("canvas_stream_unavailable", "Canvas Agent 事件流不可用");
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") || !response.body) {
        throw new CanvasRuntimeStreamError("canvas_stream_invalid", "Canvas Agent 事件流响应无效");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    let eventType = "";
    let eventId: string | undefined;
    let data: string[] = [];
    let eventBytes = 0;
    const dispatch = () => {
        if (data.length) {
            options.onEvent({
                type: eventType || "message",
                data: data.join("\n"),
                ...(eventId !== undefined ? { id: eventId } : {}),
            });
        }
        eventType = "";
        eventId = undefined;
        data = [];
        eventBytes = 0;
    };
    const consumeLine = (line: string) => {
        eventBytes += new TextEncoder().encode(line).byteLength + 1;
        if (eventBytes > MAX_EVENT_BYTES) {
            throw new CanvasRuntimeStreamError("canvas_event_too_large", "Canvas Agent 事件超过安全上限");
        }
        if (!line) {
            dispatch();
            return;
        }
        if (line.startsWith(":")) return;
        const separator = line.indexOf(":");
        const field = separator < 0 ? line : line.slice(0, separator);
        const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (field === "event") eventType = value;
        else if (field === "data") data.push(value);
        else if (field === "id" && !value.includes("\0")) eventId = value;
    };

    try {
        while (true) {
            const item = await reader.read();
            if (item.done) break;
            buffer += decoder.decode(item.value, { stream: true });
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, "");
                buffer = buffer.slice(newline + 1);
                consumeLine(line);
                newline = buffer.indexOf("\n");
            }
            if (eventBytes + new TextEncoder().encode(buffer).byteLength > MAX_EVENT_BYTES) {
                throw new CanvasRuntimeStreamError("canvas_event_too_large", "Canvas Agent 事件超过安全上限");
            }
        }
        buffer += decoder.decode();
        if (buffer) consumeLine(buffer.replace(/\r$/, ""));
        dispatch();
    } catch (error) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (error instanceof CanvasRuntimeStreamError) throw error;
        throw new CanvasRuntimeStreamError("canvas_stream_invalid", "Canvas Agent 事件流响应无效");
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
