export type HermesSessionStatus = "active" | "completed" | "failed" | "cancelled";

export type HermesSession = {
    id: string;
    status: HermesSessionStatus;
    createdAt?: string;
    updatedAt?: string;
};

export type HermesSessionInput = {
    projectId?: string;
    prompt: string;
    canvasContext?: Record<string, unknown>;
    references?: string[];
};

export type HermesTurnInput = {
    prompt: string;
    references?: string[];
};

export type HermesEvent = {
    id?: string;
    type: "turn_started" | "message_delta" | "tool_call" | "tool_result" | "canvas_operation_pending" | "canvas_operation_applied" | "generation_submitted" | "generation_progress" | "turn_completed" | "turn_failed";
    data: Record<string, unknown>;
};

export class HermesBridgeError extends Error {
    constructor(public readonly status: number, message: string, public readonly data?: unknown) {
        super(message);
        this.name = "HermesBridgeError";
    }
}

export class HermesBridgeClient {
    constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

    async createSession(input: HermesSessionInput, signal?: AbortSignal): Promise<HermesSession> {
        return this.json<HermesSession>("/agent/sessions", { method: "POST", body: input, signal });
    }

    async submitTurn(sessionId: string, input: HermesTurnInput, signal?: AbortSignal): Promise<{ accepted: boolean }> {
        return this.json<{ accepted: boolean }>(`/agent/sessions/${encodeURIComponent(sessionId)}/turns`, { method: "POST", body: input, signal });
    }

    async cancel(sessionId: string, signal?: AbortSignal): Promise<{ cancelled: boolean }> {
        return this.json<{ cancelled: boolean }>(`/agent/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST", signal });
    }

    async *events(sessionId: string, signal?: AbortSignal): AsyncGenerator<HermesEvent> {
        const response = await this.fetchImpl(this.url(`/agent/sessions/${encodeURIComponent(sessionId)}/events`), { headers: { accept: "text/event-stream" }, signal });
        if (!response.ok || !response.body) throw new HermesBridgeError(response.status, `Hermes 事件流失败 (${response.status})`);
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        try {
            for (;;) {
                const next = await reader.read();
                buffer += next.value || "";
                const frames = buffer.split(/\r?\n\r?\n/);
                buffer = frames.pop() || "";
                for (const frame of frames) {
                    const event = parseEvent(frame);
                    if (event) yield event;
                }
                if (next.done) break;
            }
            const event = parseEvent(buffer);
            if (event) yield event;
        } finally { await reader.cancel(); }
    }

    private async json<T>(path: string, options: { method: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
        const response = await this.fetchImpl(this.url(path), { method: options.method, headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }) }, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal });
        const raw = await response.text();
        let data: T | { message?: string; data?: unknown };
        try { data = JSON.parse(raw) as T; } catch { throw new HermesBridgeError(response.status, "Hermes Bridge 返回了无效 JSON"); }
        if (!response.ok) { const failure = data as { message?: string; data?: unknown }; throw new HermesBridgeError(response.status, failure.message || `Hermes Bridge 请求失败 (${response.status})`, failure.data); }
        return data as T;
    }

    private url(path: string) { return `${this.baseUrl.replace(/\/$/, "")}${path}`; }
}

function parseEvent(frame: string): HermesEvent | undefined {
    const lines = frame.split(/\r?\n/);
    const type = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() as HermesEvent["type"] | undefined;
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!type || !data) return undefined;
    try { return { id: lines.find((line) => line.startsWith("id:"))?.slice(3).trim(), type, data: JSON.parse(data) as Record<string, unknown> }; }
    catch { throw new HermesBridgeError(502, "Hermes 事件包含无效 JSON"); }
}
