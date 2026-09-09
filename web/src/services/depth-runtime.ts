import { LocalRuntimeClientError } from "@/services/local-runtime-session";
import type { LocalRuntimeTransport } from "@/services/local-runtime";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore } from "@/stores/use-local-runtime-store";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=_-]+)$/;

export type LocalDepthResult = {
    blob: Blob;
    width: number;
    height: number;
    modelId: string;
    device: "cpu";
};

export type LocalDepthRuntimeStatus = {
    ok: true;
    module: "depth-estimation";
    apiVersion: 1;
    ready: boolean;
    configured: boolean;
    modelCached: boolean;
    loaded: boolean;
    device: "cpu";
    modelId: string;
    reason?: string;
};

export async function runLocalDepthEstimation(sourceUrl: string, signal?: AbortSignal): Promise<LocalDepthResult> {
    const dataUrl = await sourceToDataUrl(sourceUrl, signal);
    const value = await requestJson<unknown>("/depth-estimation/run", {
        method: "POST",
        body: JSON.stringify({ schemaVersion: 1, operation: "depth", dataUrl }),
        headers: { "content-type": "application/json" },
        signal,
    });
    if (!isRecord(value) || value.ok !== true || value.module !== "depth-estimation" || value.apiVersion !== 1 || !isRecord(value.result)) {
        throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度结果响应无效");
    }
    return parseResult(value.result);
}

export async function readLocalDepthRuntimeStatus(signal?: AbortSignal) {
    return parseStatus(await requestJson<unknown>("/depth-estimation/status", { method: "GET", signal }));
}

async function sourceToDataUrl(sourceUrl: string, signal?: AbortSignal) {
    if (sourceUrl.startsWith("data:")) {
        const match = DATA_URL_PATTERN.exec(sourceUrl);
        if (!match) throw new LocalRuntimeClientError("depth_input_invalid", "深度转换只支持 PNG、JPEG 或 WebP 图片", 400);
        const bytes = bytesFromBase64(match[2]!);
        assertImageSize(bytes);
        return `data:${match[1]};base64,${bytesToBase64(bytes)}`;
    }
    let response: Response;
    try {
        response = await fetch(sourceUrl, { credentials: "include", redirect: "error", cache: "no-store", signal });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new LocalRuntimeClientError("depth_input_invalid", "深度转换输入图片无法读取");
    }
    if (!response.ok) throw new LocalRuntimeClientError("depth_input_invalid", "深度转换输入图片无法读取", response.status);
    const mimeType = imageMime(response.headers.get("content-type") || response.type);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        throw new LocalRuntimeClientError("depth_input_invalid", "深度转换图片不能超过 12MB", 400);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertImageSize(bytes);
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

async function requestJson<T = unknown>(path: string, init: RequestInit = {}) {
    const { response, body: responseBody } = await requestRuntimeResponse(path, init);
    const body = responseBody === undefined ? await parseJsonResponse(response) : responseBody;
    if (!response.ok) {
        const code = isRecord(body) && typeof body.code === "string" ? body.code : "depth_runtime_unavailable";
        const message = isRecord(body) && typeof body.message === "string" ? body.message : "本机深度运行时不可用";
        throw new LocalRuntimeClientError(code, message, response.status);
    }
    return body as T;
}

async function requestRuntimeResponse(path: string, init: RequestInit = {}) {
    let refreshed = false;
    while (true) {
        let response: Response;
        try {
            response = await (await ensureTransport()).request(path, init);
        } catch (error) {
            if (refreshed || !isSessionRefreshError(error)) throw error;
            await reconnectTransport();
            refreshed = true;
            continue;
        }
        if (!refreshed && response.status === 401) {
            await reconnectTransport();
            refreshed = true;
            continue;
        }
        if (response.status === 403) {
            const body = await parseJsonResponse(response);
            if (!refreshed && shouldRefreshSession(response, body)) {
                await reconnectTransport();
                refreshed = true;
                continue;
            }
            return { response, body };
        }
        return { response };
    }
}

async function ensureTransport(): Promise<LocalRuntimeTransport> {
    const state = useLocalRuntimeStore.getState();
    if (state.connection !== "connected") await state.connect();
    const current = useLocalRuntimeStore.getState();
    if (current.connection !== "connected") throw new LocalRuntimeClientError("depth_runtime_unavailable", current.error || "本机深度运行时不可用");
    return getLocalRuntimeSessionClient();
}

async function reconnectTransport() {
    const client = getLocalRuntimeSessionClient();
    client.revokeLocalSession();
    await useLocalRuntimeStore.getState().connect();
    const state = useLocalRuntimeStore.getState();
    if (state.connection !== "connected") throw new LocalRuntimeClientError("depth_runtime_unavailable", state.error || "本机深度运行时不可用");
}

async function parseJsonResponse(response: Response) {
    const text = await boundedText(response, MAX_RESPONSE_BYTES);
    try {
        return text ? JSON.parse(text) as unknown : {};
    } catch {
        throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度响应无效", response.status);
    }
}

async function boundedText(response: Response, limit: number) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度响应过大", response.status);
    const text = await response.text();
    if (text.length > limit) throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度响应过大", response.status);
    return text;
}

function parseResult(value: Record<string, unknown>): LocalDepthResult {
    if (value.mimeType !== "image/png" || !isPositiveInteger(value.width) || !isPositiveInteger(value.height) || typeof value.modelId !== "string" || value.device !== "cpu" || typeof value.pngBase64 !== "string") {
        throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度结果无效");
    }
    const bytes = bytesFromBase64(value.pngBase64, "runtime_response_invalid", "本机深度结果无效");
    if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES) throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度结果过大");
    return { blob: new Blob([bytes], { type: "image/png" }), width: value.width, height: value.height, modelId: value.modelId, device: "cpu" };
}

function parseStatus(value: unknown): LocalDepthRuntimeStatus {
    if (!isRecord(value) || value.ok !== true || value.module !== "depth-estimation" || value.apiVersion !== 1 || typeof value.ready !== "boolean" || typeof value.configured !== "boolean" || typeof value.modelCached !== "boolean" || typeof value.loaded !== "boolean" || value.device !== "cpu" || typeof value.modelId !== "string" || (value.reason !== undefined && typeof value.reason !== "string")) {
        throw new LocalRuntimeClientError("runtime_response_invalid", "本机深度状态无效");
    }
    return value as LocalDepthRuntimeStatus;
}

function imageMime(value: string): "image/jpeg" | "image/png" | "image/webp" {
    const mime = value.startsWith("image/") ? value.split(";", 1)[0] : "";
    if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return mime;
    throw new LocalRuntimeClientError("depth_input_invalid", "深度转换只支持 PNG、JPEG 或 WebP 图片", 400);
}

function assertImageSize(bytes: Uint8Array) {
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new LocalRuntimeClientError("depth_input_invalid", "深度转换图片不能超过 12MB", 400);
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function bytesFromBase64(value: string, code = "depth_input_invalid", message = "深度转换输入图片无效") {
    let binary: string;
    try { binary = atob(value.replaceAll("-", "+").replaceAll("_", "/")); } catch { throw new LocalRuntimeClientError(code, message, code === "depth_input_invalid" ? 400 : 0); }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function isSessionRefreshError(error: unknown): error is LocalRuntimeClientError {
    return error instanceof LocalRuntimeClientError && ["session_required", "session_invalid", "scope_denied"].includes(error.code);
}

function shouldRefreshSession(response: Response, body: unknown) {
    return response.status === 401 || (response.status === 403 && isRecord(body) && body.code === "scope_denied");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
