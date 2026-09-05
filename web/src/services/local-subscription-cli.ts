import type { LocalRuntimeTransport } from "@/services/local-runtime";
import { LocalRuntimeClientError } from "@/services/local-runtime-session";

export type SubscriptionCliProvider = "chatgpt" | "antigravity";
export type SubscriptionCliModel = {
    provider: SubscriptionCliProvider;
    id: string;
    displayName: string;
    modality: "text" | "image";
    adapterSupported: true;
    currentlyObservedAvailable: "yes";
    source: "cli-proxy-api-models";
};
export type SubscriptionCliToolStatus = {
    id: "cli-proxy-api" | "codex" | "antigravity" | "gemini";
    displayName: string;
    installed: boolean;
};
export type SubscriptionCliStatus = {
    provider: "cli-proxy-api";
    state: "stopped" | "key_missing" | "authentication_failed" | "ready" | "error";
    installed: boolean;
    running: boolean;
    keyConfigured: boolean;
    endpoint: "127.0.0.1:8317";
    message: string;
    tools: SubscriptionCliToolStatus[];
    models: SubscriptionCliModel[];
};

type RecoverableSessionTransport = LocalRuntimeTransport & {
    connect(signal?: AbortSignal): Promise<{ state: string }>;
    revokeLocalSession(): void;
};

export class SubscriptionCliClientError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "SubscriptionCliClientError";
    }
}

export async function getSubscriptionCliStatus(client: RecoverableSessionTransport, signal?: AbortSignal): Promise<SubscriptionCliStatus> {
    const value = await requestWithSessionRecovery(client, "/subscription-cli/status", { method: "GET", signal }, 2 * 1024 * 1024);
    const root = record(value);
    return parseStatus(root?.status);
}

export async function runSubscriptionText(client: RecoverableSessionTransport, input: { provider: SubscriptionCliProvider; model: string; prompt: string; confirmed: true }, signal?: AbortSignal) {
    const value = await requestWithSessionRecovery(client, "/subscription-cli/completions", jsonRequest(input, signal), 2 * 1024 * 1024);
    const root = record(value);
    if (root?.ok !== true || root.provider !== input.provider || root.model !== input.model || typeof root.text !== "string" || !root.text.trim()) throw invalidResponse();
    return root.text;
}

export async function runSubscriptionImage(client: RecoverableSessionTransport, input: { provider: SubscriptionCliProvider; model: string; prompt: string; aspectRatio: string; quality: string; confirmed: true }, signal?: AbortSignal) {
    const value = await requestWithSessionRecovery(client, "/subscription-cli/images", jsonRequest(input, signal), 45 * 1024 * 1024);
    const root = record(value);
    if (root?.ok !== true || root.provider !== input.provider || root.model !== input.model || !Array.isArray(root.images) || root.images.length !== 1) throw invalidResponse();
    const image = record(root.images[0]);
    if (!image || typeof image.dataUrl !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl) || typeof image.mimeType !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType))
        throw invalidResponse();
    return [{ dataUrl: image.dataUrl, mimeType: image.mimeType, ...(typeof image.bytes === "number" ? { bytes: image.bytes } : {}) }];
}

export function confirmSubscriptionCall(
    input: { provider: SubscriptionCliProvider; model: string; capability: "text" | "image"; count?: number },
    confirm: (message: string) => boolean = (message) => typeof window !== "undefined" && window.confirm(message),
) {
    const provider = input.provider === "chatgpt" ? "ChatGPT/Codex" : "Google Antigravity";
    const action = input.capability === "image" ? `生成 ${Math.max(1, input.count || 1)} 张图片` : "生成文本";
    const accepted = confirm(`${provider} 订阅调用确认\n\n将使用 ${input.model} ${action}。本次调用只发送到本机 CLIProxyAPI，不会自动切换到 API Key 或其他付费渠道。`);
    if (!accepted) throw new DOMException("Subscription request cancelled", "AbortError");
}

function jsonRequest(value: unknown, signal?: AbortSignal): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value), signal };
}

async function requestWithSessionRecovery(client: RecoverableSessionTransport, path: string, init: RequestInit, limit: number) {
    try {
        return await request(client, path, init, limit);
    } catch (error) {
        if (init.signal?.aborted || !isRecoverableSessionFailure(error)) throw error;
        client.revokeLocalSession();
        const connection = await client.connect(init.signal ?? undefined);
        if (connection.state !== "connected") throw error;
        return request(client, path, init, limit);
    }
}

async function request(client: LocalRuntimeTransport, path: string, init: RequestInit, limit: number) {
    const response = await client.request(path, init);
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) throw invalidResponse(response.status);
    const value = await readBoundedJson(response, limit);
    if (!response.ok) {
        const root = record(value);
        const code = typeof root?.code === "string" ? root.code : response.status === 401 ? "session_required" : response.status === 403 ? "scope_denied" : "subscription_request_failed";
        const message = typeof root?.message === "string" && root.message.length <= 200 ? root.message : "订阅本机服务调用失败；不会切换其他渠道或付费 API";
        throw new SubscriptionCliClientError(code, message, response.status);
    }
    return value;
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw invalidResponse(response.status);
    if (!response.body) throw invalidResponse(response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > limit) {
                await reader.cancel();
                throw invalidResponse(response.status);
            }
            chunks.push(part.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw invalidResponse(response.status);
    }
}

function parseStatus(value: unknown): SubscriptionCliStatus {
    const root = record(value);
    if (
        !root ||
        root.provider !== "cli-proxy-api" ||
        !["stopped", "key_missing", "authentication_failed", "ready", "error"].includes(String(root.state)) ||
        typeof root.installed !== "boolean" ||
        typeof root.running !== "boolean" ||
        typeof root.keyConfigured !== "boolean" ||
        root.endpoint !== "127.0.0.1:8317" ||
        typeof root.message !== "string" ||
        !Array.isArray(root.tools) ||
        !Array.isArray(root.models)
    )
        throw invalidResponse();
    const tools = root.tools.map(parseTool);
    const models = root.models.map(parseModel);
    return { provider: "cli-proxy-api", state: root.state as SubscriptionCliStatus["state"], installed: root.installed, running: root.running, keyConfigured: root.keyConfigured, endpoint: "127.0.0.1:8317", message: root.message, tools, models };
}

function parseTool(value: unknown): SubscriptionCliToolStatus {
    const item = record(value);
    if (!item || !["cli-proxy-api", "codex", "antigravity", "gemini"].includes(String(item.id)) || typeof item.displayName !== "string" || typeof item.installed !== "boolean") throw invalidResponse();
    return { id: item.id as SubscriptionCliToolStatus["id"], displayName: item.displayName, installed: item.installed };
}

function parseModel(value: unknown): SubscriptionCliModel {
    const item = record(value);
    if (
        !item ||
        (item.provider !== "chatgpt" && item.provider !== "antigravity") ||
        typeof item.id !== "string" ||
        typeof item.displayName !== "string" ||
        (item.modality !== "text" && item.modality !== "image") ||
        item.adapterSupported !== true ||
        item.currentlyObservedAvailable !== "yes" ||
        item.source !== "cli-proxy-api-models"
    )
        throw invalidResponse();
    return { provider: item.provider, id: item.id, displayName: item.displayName, modality: item.modality, adapterSupported: true, currentlyObservedAvailable: "yes", source: "cli-proxy-api-models" };
}

function isRecoverableSessionFailure(error: unknown) {
    return (error instanceof SubscriptionCliClientError && (error.code === "session_required" || error.code === "scope_denied")) || (error instanceof LocalRuntimeClientError && error.code === "session_required");
}

function invalidResponse(status = 502) {
    return new SubscriptionCliClientError("subscription_response_invalid", "订阅本机服务响应无效", status);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
