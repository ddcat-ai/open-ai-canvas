import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";
import { LocalRuntimeClientError } from "@/services/local-runtime-session";
import type { LocalRuntimeTransport } from "@/services/local-runtime";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore } from "@/stores/use-local-runtime-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { PortraitClearanceNodeState, PortraitClearanceSettings, PortraitClearanceMode, PortraitClearanceAnalysisMode, PortraitClearanceInputRole } from "@/lib/portrait-clearance/contracts";

export type PortraitRuntimeStatus = {
    ok: true;
    module: "portrait-clearance";
    apiVersion: 1;
    ready: boolean;
    models: { modelPack: string; ready: boolean; detector: { installed: boolean; fileName: string }; embedding: { installed: boolean; fileName: string } };
    browser: { available: boolean; reason?: string };
    tasks: { active: number; recoverable: number };
};

export type PortraitRuntimeTask = {
    taskId: string;
    mode: PortraitClearanceMode;
    analysisMode: PortraitClearanceAnalysisMode;
    modelRef?: string;
    status: NonNullable<PortraitClearanceNodeState["task"]>["status"];
    stage: NonNullable<PortraitClearanceNodeState["task"]>["stage"];
    progress: number;
    processedCandidates: number;
    totalCandidates?: number;
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    detailsAvailable: boolean;
};

export type PortraitRuntimeModelJob = {
    jobId: string;
    taskId: string;
    pairId: string;
    queryImageId: string;
    comparisonImageId: string;
    status: "pending" | "leased" | "completed" | "failed";
    attempt: number;
    leaseToken?: string;
    leaseExpiresAt?: string;
    errorCode?: string;
    errorMessage?: string;
};

type PortraitTaskInput = {
    nodeId: string;
    role: PortraitClearanceInputRole;
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    dataUrl: string;
};

export async function readPortraitRuntimeStatus(signal?: AbortSignal) {
    return parseStatus(await requestJson<unknown>("/portrait-clearance/status", { method: "GET", signal }));
}

export async function installPortraitClearanceModels(signal?: AbortSignal) {
    await requestJson("/portrait-clearance/model/install", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal });
    return readPortraitRuntimeStatus(signal);
}

export async function createPortraitClearanceTask(input: {
    projectId: string;
    nodeId: string;
    ownerScopeHash: string;
    clientOperationId: string;
    mode: PortraitClearanceMode;
    analysisMode: PortraitClearanceAnalysisMode;
    modelRef?: string;
    settings: PortraitClearanceSettings;
    inputs: PortraitTaskInput[];
}, signal?: AbortSignal) {
    return parseTask((await requestJson<{ task?: unknown }>("/portrait-clearance/tasks", { method: "POST", body: JSON.stringify({ schemaVersion: 1, ...input }), headers: { "content-type": "application/json" }, signal })).task);
}

export async function readPortraitTask(taskId: string, signal?: AbortSignal) {
    return parseTask((await requestJson<{ task?: unknown }>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}`, { method: "GET", signal })).task);
}

export async function readPortraitTaskResult(taskId: string, signal?: AbortSignal) {
    return requestJson<unknown>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/artifacts/clearance-result.json`, { method: "GET", signal });
}

export async function listPortraitTasks(query: { projectId: string; nodeId?: string; ownerScopeHash?: string; limit?: number }, signal?: AbortSignal) {
    const params = new URLSearchParams({ projectId: query.projectId, ...(query.nodeId ? { nodeId: query.nodeId } : {}), ...(query.ownerScopeHash ? { ownerScopeHash: query.ownerScopeHash } : {}), limit: String(query.limit || 30) });
    const value = await requestJson<unknown>(`/portrait-clearance/tasks?${params.toString()}`, { method: "GET", signal });
    if (!isRecord(value) || !Array.isArray(value.tasks)) throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像历史响应无效");
    return { tasks: value.tasks.map(parseTask), nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : undefined };
}

export async function readPortraitTaskImage(taskId: string, imageId: string, signal?: AbortSignal) {
    const { response } = await requestRuntimeResponse(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/images/${encodeURIComponent(imageId)}`, { method: "GET", signal });
    if (!response.ok) throw new LocalRuntimeClientError("portrait_artifact_not_found", "本机肖像图片不可用", response.status);
    const mimeType = imageMime(response.headers.get("content-type") || "", "image/jpeg");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像图片过大", response.status);
    return { mimeType, dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}` };
}

export async function downloadPortraitReport(taskId: string, artifactId: "clearance-result.json" | "clearance-report.md" | "clearance-report.html" | "clearance-report.docx", signal?: AbortSignal) {
    const { response } = await requestRuntimeResponse(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/artifacts/${artifactId}`, { method: "GET", signal });
    if (!response.ok) throw new LocalRuntimeClientError("portrait_artifact_not_found", "本机肖像报告不可用", response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 24 * 1024 * 1024) throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像报告过大", response.status);
    return { bytes, mimeType: response.headers.get("content-type") || "application/octet-stream" };
}

export async function claimPortraitModelJob(taskId: string, signal?: AbortSignal) {
    const value = await requestJson<unknown>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/model-jobs/claim`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal });
    if (!isRecord(value) || value.ok !== true || (value.job !== null && value.job !== undefined && !isRecord(value.job))) throw new LocalRuntimeClientError("runtime_response_invalid", "本机视觉模型作业响应无效");
    return value.job === null || value.job === undefined ? null : parseModelJob(value.job);
}

export async function completePortraitModelJob(taskId: string, job: PortraitRuntimeModelJob, visionComparison: Record<string, unknown>, signal?: AbortSignal) {
    const value = await requestJson<unknown>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/model-jobs/${encodeURIComponent(job.jobId)}/complete`, { method: "POST", body: JSON.stringify({ attempt: job.attempt, leaseToken: job.leaseToken, visionComparison }), headers: { "content-type": "application/json" }, signal });
    if (!isRecord(value) || value.ok !== true || !isRecord(value.task)) throw new LocalRuntimeClientError("runtime_response_invalid", "本机视觉模型结果响应无效");
    return parseTask(value.task);
}

export async function failPortraitModelJob(taskId: string, job: PortraitRuntimeModelJob, errorCode: string, errorMessage: string, retryable: boolean, signal?: AbortSignal) {
    const value = await requestJson<unknown>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/model-jobs/${encodeURIComponent(job.jobId)}/fail`, { method: "POST", body: JSON.stringify({ attempt: job.attempt, leaseToken: job.leaseToken, errorCode, errorMessage, retryable }), headers: { "content-type": "application/json" }, signal });
    if (!isRecord(value) || value.ok !== true || !isRecord(value.task)) throw new LocalRuntimeClientError("runtime_response_invalid", "本机视觉模型失败响应无效");
    return parseTask(value.task);
}

export async function cancelPortraitTask(taskId: string, signal?: AbortSignal) {
    return parseTask((await requestJson<{ task?: unknown }>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal })).task);
}

export async function retryPortraitTask(taskId: string, signal?: AbortSignal) {
    return parseTask((await requestJson<{ task?: unknown }>(`/portrait-clearance/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal })).task);
}

export async function deletePortraitTask(taskId: string, signal?: AbortSignal) {
    await requestJson(`/${"portrait-clearance"}/tasks/${encodeURIComponent(taskId)}/delete`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal });
}

export async function portraitOwnerScopeHash() {
    const bytes = new TextEncoder().encode(getActiveUserScope());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function imageNodeDataUrl(node: CanvasNodeData, signal?: AbortSignal): Promise<{ dataUrl: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; fileName: string }> {
    const source = node.metadata?.content || node.metadata?.previewContent;
    const storageId = node.metadata?.storageKey ? resourceIdFromStorageKey(node.metadata.storageKey) : undefined;
    const storageUrl = storageId ? resourceFileUrl(storageId) : undefined;
    const value = source || storageUrl;
    if (!value) throw new Error("portrait_input_invalid");
    const response = await fetchImage(value, signal);
    const mimeType = imageMime(response.headers.get("content-type") || response.type, node.metadata?.mimeType);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) throw new Error("单张肖像排查图片不能超过 12MB");
    const dataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
    return { dataUrl, mimeType, fileName: node.title || `${node.id}.${mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length)}` };
}

async function requestJson<T = unknown>(path: string, init: RequestInit = {}) {
    const { response, body: responseBody } = await requestRuntimeResponse(path, init);
    const body = responseBody === undefined ? await parseJsonResponse(response) : responseBody;
    if (!response.ok) {
        const code = isRecord(body) && typeof body.code === "string" ? body.code : "portrait_runtime_unavailable";
        const message = isRecord(body) && typeof body.message === "string" ? body.message : "本机肖像引擎请求失败";
        throw new LocalRuntimeClientError(code, message, response.status);
    }
    return body as T;
}

type RuntimeResponse = { response: Response; body?: unknown };

async function requestRuntimeResponse(path: string, init: RequestInit = {}): Promise<RuntimeResponse> {
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

        // The signed session is kept in memory. A Runtime restart can invalidate it
        // while the store still reports "connected", so binary artifact reads need
        // the same one-time recovery as JSON requests.
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

async function parseJsonResponse(response: Response) {
    const text = await boundedText(response, 12 * 1024 * 1024);
    try { return text ? JSON.parse(text) as unknown : {}; } catch { throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像引擎响应无效", response.status); }
}

async function reconnectTransport() {
    const client = getLocalRuntimeSessionClient();
    client.revokeLocalSession();
    await useLocalRuntimeStore.getState().connect();
    const state = useLocalRuntimeStore.getState();
    if (state.connection !== "connected") throw new LocalRuntimeClientError("portrait_runtime_unavailable", state.error || "本机肖像引擎不可用");
}

function isSessionRefreshError(error: unknown): error is LocalRuntimeClientError {
    return error instanceof LocalRuntimeClientError && ["session_required", "session_invalid", "scope_denied"].includes(error.code);
}

function shouldRefreshSession(response: Response, body: unknown) {
    return response.status === 401 || (response.status === 403 && isRecord(body) && body.code === "scope_denied");
}

async function ensureTransport(): Promise<LocalRuntimeTransport> {
    const state = useLocalRuntimeStore.getState();
    if (state.connection !== "connected") await state.connect();
    const current = useLocalRuntimeStore.getState();
    if (current.connection !== "connected") throw new LocalRuntimeClientError("portrait_runtime_unavailable", current.error || "本机肖像引擎不可用");
    return getLocalRuntimeSessionClient();
}

async function boundedText(response: Response, limit: number) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw new LocalRuntimeClientError("runtime_response_invalid", "本机响应过大", response.status);
    const text = await response.text();
    if (text.length > limit) throw new LocalRuntimeClientError("runtime_response_invalid", "本机响应过大", response.status);
    return text;
}

function parseStatus(value: unknown): PortraitRuntimeStatus {
    if (!isRecord(value) || value.ok !== true || value.module !== "portrait-clearance" || value.apiVersion !== 1 || typeof value.ready !== "boolean" || !isRecord(value.models) || !isRecord(value.browser) || !isRecord(value.tasks)) throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像引擎状态无效");
    const models = value.models;
    if (typeof models.modelPack !== "string" || typeof models.ready !== "boolean" || !isRecord(models.detector) || !isRecord(models.embedding) || typeof models.detector.installed !== "boolean" || typeof models.detector.fileName !== "string" || typeof models.embedding.installed !== "boolean" || typeof models.embedding.fileName !== "string") throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像模型状态无效");
    return value as PortraitRuntimeStatus;
}

function parseTask(value: unknown): PortraitRuntimeTask {
    if (!isRecord(value) || typeof value.taskId !== "string" || !["direct-compare", "network-search"].includes(String(value.mode)) || !["local-only", "local-plus-vision"].includes(String(value.analysisMode)) || !["queued", "running", "waiting_model", "partial", "completed", "failed", "cancelled"].includes(String(value.status)) || typeof value.stage !== "string" || typeof value.progress !== "number" || !Number.isFinite(value.progress) || typeof value.processedCandidates !== "number" || typeof value.updatedAt !== "string" || typeof value.createdAt !== "string" || typeof value.detailsAvailable !== "boolean") throw new LocalRuntimeClientError("runtime_response_invalid", "本机肖像任务响应无效");
    return value as PortraitRuntimeTask;
}

function parseModelJob(value: unknown): PortraitRuntimeModelJob {
    if (!isRecord(value) || typeof value.jobId !== "string" || typeof value.taskId !== "string" || typeof value.pairId !== "string" || typeof value.queryImageId !== "string" || typeof value.comparisonImageId !== "string" || !["pending", "leased", "completed", "failed"].includes(String(value.status)) || typeof value.attempt !== "number" || !Number.isInteger(value.attempt) || (value.status === "leased" && typeof value.leaseToken !== "string")) throw new LocalRuntimeClientError("runtime_response_invalid", "本机视觉模型作业响应无效");
    return value as PortraitRuntimeModelJob;
}

function imageMime(value: string, fallback?: string): "image/jpeg" | "image/png" | "image/webp" {
    const mime = value.startsWith("image/") ? value.split(";", 1)[0] : fallback || "";
    if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return mime;
    throw new Error("portrait_input_invalid");
}

async function fetchImage(value: string, signal?: AbortSignal) {
    if (value.startsWith("data:")) {
        const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=_-]+)$/.exec(value);
        if (!match) throw new Error("portrait_input_invalid");
        return new Response(bytesFromBase64(match[2]!), { headers: { "content-type": match[1]! } });
    }
    const response = await fetch(value, { credentials: "include", redirect: "error", cache: "no-store", signal });
    if (!response.ok) throw new Error("portrait_input_invalid");
    return response;
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function bytesFromBase64(value: string) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
