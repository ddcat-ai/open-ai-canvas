import { getActiveUserScope } from "@/lib/user-scope";
import axios from "axios";
import { apiBaseURL, apiClient, request, type BackendEnvelope } from "@/services/api/request";
import type { CDNAuthType, OSSConnectionTestInput, OSSConnectionTestResult, OSSProvider, S3Preset } from "@/lib/oss-settings";

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
    playbackStatus?: string;
    playbackObjectKey?: string;
    playbackError?: string;
    etag?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

export type ResourceStorageMode = "local" | "oss";

export type UserOSSSetting = {
    enabled: boolean;
    storageMode: ResourceStorageMode;
    provider: OSSProvider;
    configured: boolean;
    effectiveProvider: OSSProvider | "";
    s3Preset: S3Preset;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    cdnAuthType: CDNAuthType;
    hasCdnAuthKey: boolean;
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

export type UserOSSSettingInput = Pick<UserOSSSetting, "enabled" | "provider" | "s3Preset" | "region" | "endpoint" | "cdnBaseUrl" | "cdnAuthType" | "bucket" | "accessKeyId" | "pathPrefix" | "pathStyle"> & {
    accessKeySecret?: string;
    sessionToken?: string;
    cdnAuthKey?: string;
};

export type AccountFileStorageUsage = {
    usedBytes: number;
    totalBytes: number;
};

export type ArkPrivateAssetSync = {
    resourceId: string;
    status: "active" | string;
};

export type ResourceUploadMeta = {
    width?: number;
    height?: number;
    durationMs?: number;
    fileName?: string;
    idempotencyKey?: string;
};

export function playbackVariantUrl(id: string) {
    return `${resourceFileUrl(id)}?variant=playback`;
}

const api = apiClient;
const resourceCache = new Map<string, RemoteResource>();
const resourceRequests = new Map<string, Promise<RemoteResource>>();
const resourceDirectURLRequests = new Map<string, Promise<string>>();
const resourceDirectURLCache = new Map<string, { url: string; expiresAt: number; reverseKey: string }>();
const resourceDirectURLIds = new Map<string, { id: string; cacheKey: string; expiresAt: number }>();
const RESOURCE_DIRECT_URL_TTL_MS = 4 * 60 * 1000;
const MAX_RESOURCE_DIRECT_URL_ENTRIES = 256;
const missingResourceIds = new Set<string>();
let resourceStorageModeCache: { scope: string; mode: ResourceStorageMode } | null = null;
let resourceStorageModeRequest: { scope: string; promise: Promise<ResourceStorageMode> } | null = null;
let resourceCacheGeneration = 0;

export function resourceStorageKey(id: string) {
    return `resource:${id}`;
}

export function getUserOSSSetting() {
    const scope = getActiveUserScope();
    return request<{ setting: UserOSSSetting }>(api.get("/settings/oss")).then((data) => {
        cacheResourceStorageMode(normalizeResourceStorageMode(data.setting.storageMode), scope);
        return data;
    });
}

export async function updateUserOSSSetting(input: UserOSSSettingInput) {
    const scope = getActiveUserScope();
    const data = await request<{ setting: UserOSSSetting }>(api.patch("/settings/oss", input));
    // A public S3 domain can be cached indefinitely. Drop the in-memory URL
    // map when storage settings change so a new domain takes effect now.
    clearResourceDirectURLCaches();
    cacheResourceStorageMode(normalizeResourceStorageMode(data.setting.storageMode), scope);
    return data;
}

export async function getResourceStorageMode(): Promise<ResourceStorageMode> {
    const scope = getActiveUserScope();
    if (scope === "guest") return "local";
    if (resourceStorageModeCache?.scope === scope) return resourceStorageModeCache.mode;
    if (resourceStorageModeRequest?.scope === scope) return resourceStorageModeRequest.promise;
    const promise = getUserOSSSetting()
        .then((data) => normalizeResourceStorageMode(data.setting.storageMode))
        .finally(() => {
            if (resourceStorageModeRequest?.promise === promise) resourceStorageModeRequest = null;
        });
    resourceStorageModeRequest = { scope, promise };
    return promise;
}

function cacheResourceStorageMode(mode: ResourceStorageMode, scope = getActiveUserScope()) {
    if (scope !== "guest") resourceStorageModeCache = { scope, mode };
}

function normalizeResourceStorageMode(value: unknown): ResourceStorageMode {
    // Unknown/missing values fail closed so an older or malformed API cannot
    // silently turn a failed OSS upload into a browser-only asset.
    return value === "local" ? "local" : "oss";
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
    return Boolean(resourceIdFromFileUrl(url));
}

/**
 * Extracts a resource ID from the stable same-origin file URL used by older
 * persisted records. This lets callers migrate the delivery path to a signed
 * provider URL without rewriting every historical canvas immediately.
 */
export function resourceIdFromFileUrl(rawURL?: string) {
    const value = String(rawURL || "").trim();
    if (!value) return "";
    const configuredBase = String(apiBaseURL).replace(/\/+$/, "");
    const absoluteInput = /^https?:\/\//i.test(value);
    let parsed: URL;
    try {
        parsed = new URL(value, "http://canvas.local");
    } catch {
        return "";
    }
    // A relative API base belongs to the current origin. Do not mistake an
    // arbitrary third-party URL that happens to contain `/api/resources/...`
    // for one of our resource URLs.
    if (absoluteInput && !/^https?:\/\//i.test(configuredBase)) {
        const currentOrigin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://canvas.local";
        if (parsed.origin !== currentOrigin) return "";
    }
    let base: URL;
    try {
        base = new URL(configuredBase, parsed.origin);
    } catch {
        return "";
    }
    if (absoluteInput && /^https?:\/\//i.test(configuredBase) && parsed.origin !== base.origin) return "";
    const prefix = `${base.pathname.replace(/\/+$/, "")}/resources/`;
    if (!parsed.pathname.startsWith(prefix) || !parsed.pathname.endsWith("/file")) return "";
    const encodedID = parsed.pathname.slice(prefix.length, -"/file".length);
    if (!encodedID || encodedID.includes("/")) return "";
    try {
        return decodeURIComponent(encodedID);
    } catch {
        return "";
    }
}

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
        const data = await request<{ resource: RemoteResource }>(api.post("/resources", formData, {
            ...uploadRequestConfig(meta?.idempotencyKey),
            onUploadProgress: onProgress ? ({ loaded, total }) => {
                if (total && total > 0) onProgress(Math.min(file.size, file.size * loaded / total), file.size);
            } : undefined,
        }));
        resourceCache.set(resourceCacheKey(data.resource.id), data.resource);
        return data.resource;
    } catch (error) {
        throw normalizeUploadError(error);
    }
}

async function uploadFileInChunks(file: Blob, name: string, kind: "image" | "video" | "audio" | "file", meta: ResourceUploadMeta | undefined, onProgress?: (uploadedBytes: number, totalBytes: number) => void) {
    for (let attempt = 0; attempt < CHUNK_UPLOAD_RETRIES; attempt++) {
        try {
            return await runChunkedUpload(file, name, kind, meta, onProgress);
        } catch (error) {
            if (attempt === CHUNK_UPLOAD_RETRIES - 1) throw normalizeUploadError(error);
        }
    }
    throw new Error("上传失败");
}

async function runChunkedUpload(file: Blob, name: string, kind: "image" | "video" | "audio" | "file", meta: ResourceUploadMeta | undefined, onProgress?: (uploadedBytes: number, totalBytes: number) => void) {
    const session = await request<{ uploadId: string; chunkSize: number; chunkCount: number }>(
        api.post(
            "/resources/uploads",
            { fileName: name, kind, size: file.size, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs, idempotencyKey: meta?.idempotencyKey?.trim() || undefined },
            uploadRequestConfig(meta?.idempotencyKey),
        ),
    );
    for (let index = 0; index < session.chunkCount; index++) {
        const start = index * session.chunkSize;
        const end = Math.min(file.size, start + session.chunkSize);
        const blob = file.slice(start, end);
        await request<{ index: number }>(api.put(`/resources/uploads/${encodeURIComponent(session.uploadId)}/chunks/${index}`, blob, { headers: { "Content-Type": "application/octet-stream" } }));
        onProgress?.(end, file.size);
    }
    const complete = await request<{ resource: RemoteResource }>(api.post(`/resources/uploads/${encodeURIComponent(session.uploadId)}/complete`));
    return complete.resource;
}

function normalizeUploadError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const payload = error.response?.data as { msg?: string } | undefined;
        const message = payload?.msg || "";
        if (status === 400 && /body too large|MaxBytes/i.test(message)) return new Error("文件过大，请使用分片上传或稍后重试");
        if (message) return new Error(message);
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

// Bypass the read cache while polling processing resources, then make the
// latest server state authoritative for subsequent consumers.
export function refreshResource(id: string): Promise<RemoteResource> {
    const cacheKey = resourceCacheKey(id);
    return request<{ resource: RemoteResource }>(api.get(`/resources/${encodeURIComponent(id)}`)).then((data) => {
        resourceCache.set(cacheKey, data.resource);
        missingResourceIds.delete(cacheKey);
        return data.resource;
    });
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

/**
 * Returns the browser URL for the object that backs a resource.
 *
 * The endpoint performs the ownership check server-side. Signed provider URLs
 * are cached briefly, while an explicitly configured public S3 domain is
 * marked stable by the backend and can be reused without a forced refresh.
 */
export async function getResourceDirectUrl(storageKey?: string, options?: { forceRefresh?: boolean }) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("当前媒体尚未上传到后端资源存储");
    const scope = getActiveUserScope();
    const generation = resourceCacheGeneration;
    const cacheKey = resourceCacheKey(id, scope);
    const now = Date.now();
    pruneResourceDirectURLCache(now);
    const cached = resourceDirectURLCache.get(cacheKey);
    if (!options?.forceRefresh && cached && cached.expiresAt > now) return cached.url;
    if (cached) deleteResourceDirectURLCache(cacheKey);
    const pending = resourceDirectURLRequests.get(cacheKey);
    if (pending && !options?.forceRefresh) return pending;
    let task: Promise<string>;
    task = requestDirectResourceUrl(id)
        .then(({ url, stable }) => {
            if (generation !== resourceCacheGeneration) throw new Error("资源账号已切换");
            if (resourceDirectURLRequests.get(cacheKey) !== task) return url;
            deleteResourceDirectURLCache(cacheKey);
            const expiresAt = stable ? Number.POSITIVE_INFINITY : Date.now() + RESOURCE_DIRECT_URL_TTL_MS;
            const reverseKey = resourceDirectURLReverseKey(url, scope);
            resourceDirectURLCache.set(cacheKey, { url, expiresAt, reverseKey });
            resourceDirectURLIds.set(reverseKey, { id, cacheKey, expiresAt });
            pruneResourceDirectURLCache(Date.now());
            return url;
        })
        .finally(() => {
            if (resourceDirectURLRequests.get(cacheKey) === task) resourceDirectURLRequests.delete(cacheKey);
        });
    resourceDirectURLRequests.set(cacheKey, task);
    return task;
}

async function requestDirectResourceUrl(id: string, download = false): Promise<{ url: string; stable: boolean }> {
    try {
        const data = await request<{ url: string; proxy?: boolean; stable?: boolean }>(api.get(`/resources/${encodeURIComponent(id)}/direct-url`, download ? { params: { download: 1 } } : undefined));
        if (data.proxy) return { url: download ? resourceDownloadUrl(id) : resourceFileUrl(id), stable: false };
        if (!data.url) throw new Error("后端未返回对象存储地址");
        return { url: data.url, stable: data.stable === true };
    } catch (error) {
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) throw new Error(error.response?.data.msg || error.message || "获取对象存储地址失败");
        throw error;
    }
}

function resourceCacheKey(id: string, scope = getActiveUserScope()) {
    return `${scope}:${id}`;
}

function deleteResourceDirectURLCache(cacheKey: string) {
    const cached = resourceDirectURLCache.get(cacheKey);
    if (cached && resourceDirectURLIds.get(cached.reverseKey)?.cacheKey === cacheKey) resourceDirectURLIds.delete(cached.reverseKey);
    resourceDirectURLCache.delete(cacheKey);
}

function resourceDirectURLReverseKey(url: string, scope = getActiveUserScope()) {
    return `${scope}:${url}`;
}

function pruneResourceDirectURLCache(now: number) {
    for (const [cacheKey, cached] of resourceDirectURLCache) {
        if (cached.expiresAt <= now) deleteResourceDirectURLCache(cacheKey);
    }
    while (resourceDirectURLCache.size > MAX_RESOURCE_DIRECT_URL_ENTRIES) {
        const oldest = resourceDirectURLCache.keys().next().value;
        if (typeof oldest !== "string") break;
        deleteResourceDirectURLCache(oldest);
    }
    for (const [reverseKey, cached] of resourceDirectURLIds) {
        if (cached.expiresAt <= now || resourceDirectURLCache.get(cached.cacheKey)?.reverseKey !== reverseKey) resourceDirectURLIds.delete(reverseKey);
    }
}

export function resourceFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file`;
}

export function resourceDownloadUrl(id: string) {
    // Legacy/same-origin download route. Provider-backed downloads resolve this
    // ID through /direct-url?download=1 before the browser requests the object.
    return `${resourceFileUrl(id)}?download=1`;
}

export function resourceFallbackUrl(resourceId: string, fallback = "") {
    const value = String(fallback || "").trim();
    return value && !resourceIdFromFileUrl(value) ? value : "";
}

export function resourceDownloadUrlFromUrl(url: string, storageKey?: string) {
    if (/(?:[?&])download=/.test(url)) return url;
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(url) || resourceDirectResourceId(url);
    if (!resourceId) return url;
    return resourceDownloadUrl(resourceId);
}

async function resolveResourceDownloadTarget(url: string) {
    const resourceId = resourceIdFromFileUrl(url) || resourceDirectResourceId(url);
    if (!resourceId) return url;
    return (await requestDirectResourceUrl(resourceId, true)).url;
}

/**
 * Starts an authenticated browser download and keeps failures inside the SPA.
 *
 * Provider-backed resources first resolve to a signed attachment URL through a
 * JSON API, so the object downloads directly without a redirect request in the
 * network panel. Local/proxied resources retain the authenticated file route.
 */
export async function startResourceDownload(url: string, fileName?: string) {
    const target = await resolveResourceDownloadTarget(url);
    if (typeof document === "undefined") return;
    if (isCrossOriginResourceURL(target)) {
        const response = await fetch(target, { credentials: "omit" });
        if (!response.ok) throw new Error(`资源下载失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        const objectURL = URL.createObjectURL(blob);
        try {
            triggerResourceDownload(objectURL, fileName);
        } finally {
            URL.revokeObjectURL(objectURL);
        }
        return;
    }
    triggerResourceDownload(target, fileName);
}

function triggerResourceDownload(target: string, fileName?: string) {
    const anchor = document.createElement("a");
    anchor.href = target;
    anchor.rel = "noopener";
    anchor.download = fileName || "";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

function isCrossOriginResourceURL(value: string) {
    if (!/^https?:\/\//i.test(value)) return false;
    const configuredOrigin = typeof globalThis.location?.origin === "string" ? globalThis.location.origin : "";
    if (!configuredOrigin) return true;
    try {
        return new URL(value).origin !== configuredOrigin;
    } catch {
        return true;
    }
}

function resourceDirectResourceId(url: string) {
    const reverseKey = resourceDirectURLReverseKey(url);
    const cached = resourceDirectURLIds.get(reverseKey);
    if (!cached) return "";
    if (cached.expiresAt <= Date.now()) {
        resourceDirectURLIds.delete(reverseKey);
        return "";
    }
    const directURL = resourceDirectURLCache.get(cached.cacheKey);
    if (!directURL || directURL.reverseKey !== reverseKey) {
        resourceDirectURLIds.delete(reverseKey);
        return "";
    }
    return cached.id;
}

/** Clears in-memory resource metadata and signed URLs when the account changes. */
export function clearResourceClientCaches() {
    resourceCacheGeneration += 1;
    resourceCache.clear();
    missingResourceIds.clear();
    clearResourceDirectURLCaches();
    resourceStorageModeCache = null;
    resourceStorageModeRequest = null;
}

function clearResourceDirectURLCaches() {
    resourceDirectURLRequests.clear();
    resourceDirectURLCache.clear();
    resourceDirectURLIds.clear();
}

function resourceProxyFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?proxy=1`;
}

export function resolveResourceUrl(storageKey?: string, fallback = "") {
    const id = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(fallback);
    // 资源引用本身已经包含稳定 ID；恢复/展示阶段不需要再查一遍元数据。
    // 需要 publicUrl、mime 或尺寸时必须显式调用 getResource，避免隐式 N+1。
    return id ? resourceFileUrl(id) : fallback;
}

export async function getResourceBlob(storageKey: string, options: { proxyFallback?: boolean; signal?: AbortSignal } = {}) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return null;
    const scope = getActiveUserScope();
    const generation = resourceCacheGeneration;
    try {
        // Resolve the signed provider URL first, then keep the object request
        // independent from the application session. This avoids downloading
        // the object through /resources/:id/file and prevents cookies from
        // being sent to a third-party storage origin.
        const directURL = await getResourceDirectUrl(storageKey);
        const response = await fetch(directURL, { credentials: isResourceUrl(directURL) ? "include" : "omit", cache: "force-cache", signal: options.signal });
        if (response.ok) {
            const blob = await response.blob();
            return generation === resourceCacheGeneration && scope === getActiveUserScope() ? blob : null;
        }
    } catch (error) {
        if (isAbortError(error, options.signal)) throw error;
        // Provider CORS may be disabled even though <img>/<video> can follow a
        // redirect. The authenticated same-origin proxy remains an explicit
        // fallback for Blob-only consumers such as IndexedDB caching.
    }
    if (generation !== resourceCacheGeneration || scope !== getActiveUserScope()) return null;
    if (options.proxyFallback === false) return null;
    // Keep a same-origin fallback for private buckets and deployments without CORS.
    const proxyURL = resourceProxyFileUrl(id);
    const response = await fetch(proxyURL, { credentials: "include", signal: options.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    return generation === resourceCacheGeneration && scope === getActiveUserScope() ? blob : null;
}

function isAbortError(error: unknown, signal?: AbortSignal) {
    return signal?.aborted === true || (typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError");
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
