import { getActiveUserScope } from "@/lib/user-scope";
import axios from "axios";
import { apiBaseURL, apiClient, request, type BackendEnvelope } from "@/services/api/request";
import type { OSSConnectionTestInput, OSSConnectionTestResult, OSSProvider, S3Preset } from "@/lib/oss-settings";

export type RemoteResource = {
    id: string;
    userId: string;
    kind: "image" | "video" | "audio" | "file" | string;
    status: "pending" | "ready" | "failed" | "deleted" | string;
    provider: string;
    endpoint: string;
    bucket: string;
    objectKey: string;
    publicUrl: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
    durationMs?: number;
    etag?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

export type UserOSSSetting = {
    enabled: boolean;
    provider: OSSProvider;
    s3Preset: S3Preset;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    bucket: string;
    accessKeyId: string;
    hasAccessKeySecret: boolean;
    sessionToken?: string;
    hasSessionToken: boolean;
    pathStyle: boolean;
    allowUserS3: boolean;
    publicBaseUrl: string;
    pathPrefix: string;
    testedAt?: string;
    testedDigest?: string;
    historyCount?: number;
    referencedResourceCount?: number;
    updatedAt?: string;
};

export type UserOSSSettingInput = Pick<UserOSSSetting, "enabled" | "provider" | "s3Preset" | "region" | "endpoint" | "cdnBaseUrl" | "bucket" | "accessKeyId" | "pathPrefix" | "pathStyle"> & {
    accessKeySecret?: string;
    sessionToken?: string;
};

export type AccountFileStorageUsage = {
    usedBytes: number;
    totalBytes: number;
};

export type ArkPrivateAssetSync = {
    resourceId: string;
    status: "active" | string;
};

type ResourceUploadMeta = {
    width?: number;
    height?: number;
    durationMs?: number;
    fileName?: string;
    idempotencyKey?: string;
};

const api = apiClient;
const resourceCache = new Map<string, RemoteResource>();
const resourceRequests = new Map<string, Promise<RemoteResource>>();
const missingResourceIds = new Set<string>();

export function resourceStorageKey(id: string) {
    return `resource:${id}`;
}

export function getUserOSSSetting() {
    return request<{ setting: UserOSSSetting }>(api.get("/settings/oss"));
}

export function updateUserOSSSetting(input: UserOSSSettingInput) {
    return request<{ setting: UserOSSSetting }>(api.patch("/settings/oss", input));
}

export function testUserOSSConnection(input: OSSConnectionTestInput) {
    return request<OSSConnectionTestResult>(api.post("/settings/oss/test", input));
}

export async function getAccountFileStorageUsage() {
    const data = await request<{ usage: AccountFileStorageUsage }>(api.get("/resources/storage-usage"));
    return data.usage;
}

export async function syncResourceToArkPrivateAsset(id: string) {
    const data = await request<{ sync: ArkPrivateAssetSync }>(api.post(`/resources/${encodeURIComponent(id)}/ark-private-asset`));
    return data.sync;
}

export function resourceIdFromStorageKey(storageKey?: string) {
    return storageKey?.startsWith("resource:") ? storageKey.slice("resource:".length) : "";
}

export function isResourceUrl(url?: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    const path = url?.split(/[?#]/, 1)[0] || "";
    return path.startsWith(`${base}/resources/`) && path.endsWith("/file");
}

// 超过该阈值（与后端单请求 multipart 上限 50MB 一致）的本地媒体走分片上传，避免大视频导入失败。
const CHUNK_UPLOAD_THRESHOLD = 50 << 20;
const CHUNK_UPLOAD_RETRIES = 2;

export async function uploadResourceFile(
    file: Blob,
    kind: "image" | "video" | "audio" | "file",
    meta?: ResourceUploadMeta,
    onProgress?: (uploadedBytes: number, totalBytes: number) => void,
): Promise<RemoteResource> {
    const name = meta?.fileName || (file instanceof File ? file.name : `${kind}.${extensionFromMime(file.type, kind)}`);
    if (file.size > CHUNK_UPLOAD_THRESHOLD) {
        const resource = await uploadFileInChunks(file, name, kind, meta, onProgress);
        resourceCache.set(resourceCacheKey(resource.id), resource);
        return resource;
    }
    const formData = new FormData();
    formData.append("kind", kind);
    formData.append("file", file, name);
    if (meta?.width) formData.append("width", String(Math.round(meta.width)));
    if (meta?.height) formData.append("height", String(Math.round(meta.height)));
    if (meta?.durationMs) formData.append("durationMs", String(Math.round(meta.durationMs)));
    try {
        const data = await request<{ resource: RemoteResource }>(api.post("/resources", formData, uploadRequestConfig(meta?.idempotencyKey)));
        resourceCache.set(resourceCacheKey(data.resource.id), data.resource);
        return data.resource;
    } catch (error) {
        throw normalizeUploadError(error);
    }
}

// 分片上传：POST 开始会话 → 逐片 PUT 原始二进制（每片 8MB）→ POST 合并落库。
// 单请求体积小、可断点续传/失败重试；单文件不再受 50MB 限制（仅日/总量配额约束）。
async function uploadFileInChunks(file: Blob, name: string, kind: "image" | "video" | "audio" | "file", meta: ResourceUploadMeta | undefined, onProgress?: (uploadedBytes: number, totalBytes: number) => void) {
    // 片级失败通常意味着会话过期/网络抖动：整体重开一次会话重传（整传重试）。
    for (let attempt = 0; attempt < CHUNK_UPLOAD_RETRIES; attempt++) {
        try {
            return await runChunkedUpload(file, name, kind, meta, onProgress);
        } catch (error) {
            if (attempt === CHUNK_UPLOAD_RETRIES - 1) throw error;
        }
    }
    throw new Error("上传失败");
}

async function runChunkedUpload(file: Blob, name: string, kind: "image" | "video" | "audio" | "file", meta: ResourceUploadMeta | undefined, onProgress?: (uploadedBytes: number, totalBytes: number) => void) {
    const session = await request<{ uploadId: string; chunkSize: number; chunkCount: number }>(
        api.post("/resources/uploads", { fileName: name, kind, size: file.size, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs }, uploadRequestConfig(meta?.idempotencyKey)),
    );
    for (let index = 0; index < session.chunkCount; index++) {
        const start = index * session.chunkSize;
        const end = Math.min(file.size, start + session.chunkSize);
        const blob = file.slice(start, end);
        const data = new FormData();
        data.append("chunk", blob);
        // raw 二进制直传，与后端按裸 body 逐片落盘对齐（勿设手动 Content-Type，让 axios 处理）。
        await request<{ index: number }>(api.put(`/resources/uploads/${encodeURIComponent(session.uploadId)}/chunks/${index}`, blob, { headers: { "Content-Type": "application/octet-stream" } }));
        onProgress?.(Math.min(end, file.size), file.size);
    }
    const complete = await request<{ resource: RemoteResource }>(api.post(`/resources/uploads/${encodeURIComponent(session.uploadId)}/complete`));
    return complete.resource;
}

function normalizeUploadError(error: unknown): Error {
    // 兜底：即使误超 50MB multipart 上限（http.MaxBytesError），也给出可读中文而非英文裸错。
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data as { msg?: string } | undefined;
        const msg = message?.msg || "";
        if (status === 400 && /body too large|MaxBytes/i.test(msg)) {
            return new Error("文件过大，请使用小于 50MB 的文件或稍后重试");
        }
        if (msg) return new Error(msg);
        if (status === 413) return new Error("文件过大，无法上传");
    }
    return error instanceof Error ? error : new Error("上传失败");
}

export async function importResourceFromUrl(url: string, kind: "image" | "video" | "audio" | "file", meta?: Omit<ResourceUploadMeta, "fileName">) {
    const data = await request<{ resource: RemoteResource }>(api.post("/resources/import", { url, kind, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs }, uploadRequestConfig(meta?.idempotencyKey)));
    resourceCache.set(resourceCacheKey(data.resource.id), data.resource);
    return data.resource;
}

function uploadRequestConfig(idempotencyKey?: string) {
    const value = idempotencyKey?.trim();
    return value ? { headers: { "X-Idempotency-Key": value } } : undefined;
}

export function getResource(id: string): Promise<RemoteResource> {
    const cacheKey = resourceCacheKey(id);
    const cached = resourceCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (missingResourceIds.has(cacheKey)) return Promise.reject(new Error("资源不存在或已被删除"));
    const pending = resourceRequests.get(cacheKey);
    if (pending) return pending;
    const task = request<{ resource: RemoteResource }>(api.get(`/resources/${encodeURIComponent(id)}`))
        .then((data) => {
            resourceCache.set(cacheKey, data.resource);
            return data.resource;
        })
        .catch((error) => {
            if (axios.isAxiosError(error) && error.response?.status === 404) missingResourceIds.add(cacheKey);
            throw error;
        })
        .finally(() => resourceRequests.delete(cacheKey));
    resourceRequests.set(cacheKey, task);
    return task;
}

export async function getResourceOSSUrl(storageKey?: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("当前媒体尚未上传到后端资源存储");
    try {
        const data = await request<{ url: string }>(api.get(`/resources/${encodeURIComponent(id)}/oss-url`));
        if (!data.url) throw new Error("后端未返回对象存储地址");
        return data.url;
    } catch (error) {
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) throw new Error(error.response?.data.msg || error.message || "获取对象存储地址失败");
        throw error;
    }
}

function resourceCacheKey(id: string) {
    return `${getActiveUserScope()}:${id}`;
}

export function resourceFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file`;
}

function resourceProxyFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?proxy=1`;
}

export function resolveResourceUrl(storageKey?: string, fallback = "") {
    const id = resourceIdFromStorageKey(storageKey);
    // 资源引用本身已经包含稳定 ID；恢复/展示阶段不需要再查一遍元数据。
    // 需要 publicUrl、mime 或尺寸时必须显式调用 getResource，避免隐式 N+1。
    return id ? resourceFileUrl(id) : fallback;
}

export async function getResourceBlob(storageKey: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return null;
    const url = resourceProxyFileUrl(id);
    const response = await fetch(url, { credentials: isResourceUrl(url) ? "include" : "same-origin" });
    if (!response.ok) return null;
    return response.blob();
}

function extensionFromMime(mimeType: string, kind: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    return kind === "image" ? "png" : "bin";
}
