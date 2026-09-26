import { getActiveUserScope } from "@/lib/user-scope";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { http, apiBaseURL, ApiError } from "@/services/api/request";
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
    playbackStatus?: string;
    playbackObjectKey?: string;
    playbackError?: string;
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
    cdnAuthMode: "" | "public" | "qiniu" | string;
    requireCDN: boolean;
    allowPrivateProxy: boolean;
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
    cdnAuthMode?: "" | "public" | "qiniu" | string;
    requireCDN?: boolean;
    allowPrivateProxy?: boolean;
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

/**
 * 资源直传失败。
 *
 * `permanent` 是这条边界上唯一重要的信息：媒体直传失败后，调用方默认会把文件留在本机
 * IndexedDB，并由云端数据同步用同一幂等键重传（见 user-data-sync 的 uploadLocalStorageKey）。
 * 但鉴权失效、越权、请求本身不合法这几类失败重传多少次都是同样结果，把它们也归入
 * "稍后自动同步" 等于向用户撒谎，必须当场抛出。
 */
export class ResourceUploadError extends Error {
    readonly status?: number;
    /** true 表示重试不会自愈，调用方不得降级为本地暂存。 */
    readonly permanent: boolean;

    constructor(message: string, options: { status?: number; permanent: boolean; cause?: unknown }) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "ResourceUploadError";
        this.status = options.status;
        this.permanent = options.permanent;
    }
}

const resourceCache = new Map<string, RemoteResource>();
const resourceRequests = new Map<string, Promise<RemoteResource>>();
const missingResourceIds = new Set<string>();
export type ResourceAccessPurpose = "display" | "copy" | "download" | "browser-process" | "provider-input";
export type ResourceAccessVariant = "original" | "playback";
export type ResourceAccess = {
    resourceId: string;
    requestedVariant: ResourceAccessVariant;
    actualVariant: ResourceAccessVariant;
    url: string;
    delivery: "cdn" | "origin" | "platform-local" | "platform-proxy";
    issuedAt: string;
    expiresAt?: string;
    refreshAt: string;
    revision: string;
    fallbackReason?: string;
};

type ResourceAccessBatchItem = { resourceId: string; access?: ResourceAccess; error?: { msg?: string } };
type CachedResourceAccess = { value: ResourceAccess; expiresAt: number };
const accessCache = new Map<string, CachedResourceAccess>();
const accessRequests = new Map<string, Promise<ResourceAccess>>();
const PERSISTED_DISPLAY_ACCESS_PREFIX = "resource-access-v1:";

function persistedDisplayAccessKey(resourceId: string, variant: ResourceAccessVariant) {
    return `${PERSISTED_DISPLAY_ACCESS_PREFIX}${resourceId}:${variant}`;
}

function shouldPersistDisplayAccess(value: ResourceAccess) {
    // 只跨页面缓存 OSS/CDN 直连地址；平台本地/代理地址仍只在内存中保留，避免把平台签名凭据落到持久存储。
    return value.delivery === "cdn" || value.delivery === "origin";
}

function resourceAccessCacheExpiry(value: ResourceAccess, now = Date.now()) {
    const expiresAt = value.expiresAt ? new Date(value.expiresAt).getTime() : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= now + 1_000) return now;
    const refreshAt = value.refreshAt ? new Date(value.refreshAt).getTime() : Number.NaN;
    const candidates = [Number.isFinite(refreshAt) && refreshAt > now ? refreshAt : Number.POSITIVE_INFINITY, Number.isFinite(expiresAt) && expiresAt > now ? expiresAt - 15_000 : Number.POSITIVE_INFINITY].filter(Number.isFinite);
    if (candidates.length) return Math.max(now, Math.min(...candidates));
    return now + 5 * 60_000;
}

async function readPersistedDisplayAccess(scope: string, resourceId: string, variant: ResourceAccessVariant): Promise<CachedResourceAccess | undefined> {
    try {
        const raw = await localForageStorageForScope(scope).getItem(persistedDisplayAccessKey(resourceId, variant));
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as Partial<CachedResourceAccess>;
        if (!parsed.value?.url || !shouldPersistDisplayAccess(parsed.value) || typeof parsed.expiresAt !== "number") return undefined;
        const actualExpiresAt = parsed.value.expiresAt ? new Date(parsed.value.expiresAt).getTime() : Number.NaN;
        if (parsed.expiresAt <= Date.now() || (Number.isFinite(actualExpiresAt) && actualExpiresAt <= Date.now() + 1_000)) {
            await localForageStorageForScope(scope).removeItem(persistedDisplayAccessKey(resourceId, variant));
            return undefined;
        }
        return parsed as CachedResourceAccess;
    } catch {
        // 签名地址缓存只是性能优化，存储不可用或数据损坏时继续走后端签发。
        return undefined;
    }
}

async function persistDisplayAccess(scope: string, resourceId: string, variant: ResourceAccessVariant, entry: CachedResourceAccess) {
    if (!shouldPersistDisplayAccess(entry.value) || entry.expiresAt <= Date.now()) return;
    try {
        await localForageStorageForScope(scope).setItem(persistedDisplayAccessKey(resourceId, variant), JSON.stringify(entry));
    } catch {
        // 不把本地缓存失败升级为资源访问失败。
    }
}
let accessGeneration = 0;

/**
 * Drop every in-memory access descriptor when the authenticated scope changes.
 * Signed URLs are credentials, so an old request must not be allowed to publish
 * its result into the next account's cache after a logout/login race.
 */
export function clearResourceAccessCache() {
    accessGeneration += 1;
    accessCache.clear();
    accessRequests.clear();
    resourceCache.clear();
    resourceRequests.clear();
    missingResourceIds.clear();
}

export function resourceStorageKey(id: string) {
    return `resource:${id}`;
}

export function getUserOSSSetting() {
    return http.get<{ setting: UserOSSSetting }>("/settings/oss");
}

export function updateUserOSSSetting(input: UserOSSSettingInput) {
    return http.patch<{ setting: UserOSSSetting }>("/settings/oss", input);
}

export function testUserOSSConnection(input: OSSConnectionTestInput) {
    return http.post<OSSConnectionTestResult>("/settings/oss/test", input);
}

export async function getAccountFileStorageUsage() {
    const data = await http.get<{ usage: AccountFileStorageUsage }>("/resources/storage-usage");
    return data.usage;
}

export async function syncResourceToArkPrivateAsset(id: string) {
    const data = await http.post<{ sync: ArkPrivateAssetSync }>(`/resources/${encodeURIComponent(id)}/ark-private-asset`);
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

export async function uploadResourceFile(file: Blob, kind: "image" | "video" | "audio" | "file", meta?: ResourceUploadMeta, onProgress?: (uploadedBytes: number, totalBytes: number) => void): Promise<RemoteResource> {
    const name = meta?.fileName || (file instanceof File ? file.name : `${kind}.${extensionFromMime(file.type, kind)}`);
    // 分片与 multipart 两条路径的失败都要归一成 ResourceUploadError，
    // 否则调用方只能靠文案猜测该重试还是该报错。
    try {
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
        const data = await http.post<{ resource: RemoteResource }>("/resources", formData, {
            ...uploadRequestConfig(meta?.idempotencyKey),
            onUploadProgress: onProgress
                ? ({ loaded, total }) => {
                      if (total && total > 0) onProgress(Math.min(file.size, (file.size * loaded) / total), file.size);
                  }
                : undefined,
        });
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
    const session = await http.post<{ uploadId: string; chunkSize: number; chunkCount: number }>(
        "/resources/uploads",
        { fileName: name, kind, size: file.size, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs },
        uploadRequestConfig(meta?.idempotencyKey),
    );
    for (let index = 0; index < session.chunkCount; index++) {
        const start = index * session.chunkSize;
        const end = Math.min(file.size, start + session.chunkSize);
        const blob = file.slice(start, end);
        const data = new FormData();
        data.append("chunk", blob);
        // raw 二进制直传，与后端按裸 body 逐片落盘对齐（勿设手动 Content-Type，让 axios 处理）。
        await http.put<{ index: number }>(`/resources/uploads/${encodeURIComponent(session.uploadId)}/chunks/${index}`, blob, {
            headers: { "Content-Type": "application/octet-stream" },
            onUploadProgress: onProgress ? ({ loaded }) => onProgress(start + Math.min(loaded, blob.size), file.size) : undefined,
        });
        onProgress?.(Math.min(end, file.size), file.size);
    }
    const complete = await http.post<{ resource: RemoteResource }>(`/resources/uploads/${encodeURIComponent(session.uploadId)}/complete`);
    return complete.resource;
}

// 失败分类直接复用 request() 已经算好的 ApiError.retryable（408/425/429/5xx 可重试），
// 不在这里另起一套响应码判断，避免两处规则漂移。
// 差别只有一处：没有拿到任何 HTTP 响应（断网、超时）时 retryable 为 false，
// 但这种失败恰恰是最该退回本机等待重传的，因此单独按瞬时处理。
function normalizeUploadError(error: unknown): ResourceUploadError {
    if (error instanceof ResourceUploadError) return error;
    // 请求取消不是上传失败，保持原始语义交给调用方。
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ApiError) {
        const status = error.status;
        const permanent = status !== undefined && !error.retryable;
        // 即使误超 50MB multipart 上限（后端 http.MaxBytesError），也给出可读中文而非英文裸错。
        if (status === 400 && /body too large|MaxBytes/i.test(error.message)) {
            return new ResourceUploadError("文件过大，请使用小于 50MB 的文件或稍后重试", { status, permanent: true, cause: error });
        }
        if (status === 413) return new ResourceUploadError("文件过大，无法上传", { status, permanent: true, cause: error });
        return new ResourceUploadError(error.message || "上传失败", { status, permanent, cause: error });
    }
    return new ResourceUploadError(error instanceof Error ? error.message : "上传失败", { permanent: false, cause: error });
}

export async function importResourceFromUrl(url: string, kind: "image" | "video" | "audio" | "file", meta?: Omit<ResourceUploadMeta, "fileName">) {
    const data = await http.post<{ resource: RemoteResource }>("/resources/import", { url, kind, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs }, uploadRequestConfig(meta?.idempotencyKey));
    resourceCache.set(resourceCacheKey(data.resource.id), data.resource);
    return data.resource;
}

function uploadRequestConfig(idempotencyKey?: string) {
    const value = idempotencyKey?.trim();
    return value ? { headers: { "X-Idempotency-Key": value } } : undefined;
}

export function getResource(id: string): Promise<RemoteResource> {
    const generation = accessGeneration;
    const scope = getActiveUserScope();
    const cacheKey = resourceCacheKey(id);
    const cached = resourceCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (missingResourceIds.has(cacheKey)) return Promise.reject(new Error("资源不存在或已被删除"));
    const pending = resourceRequests.get(cacheKey);
    if (pending) return pending;
    const task = http
        .get<{ resource: RemoteResource }>(`/resources/${encodeURIComponent(id)}`)
        .then((data) => {
            assertResourceRequestCurrent(generation, scope);
            resourceCache.set(cacheKey, data.resource);
            return data.resource;
        })
        .catch((error) => {
            assertResourceRequestCurrent(generation, scope);
            if (error instanceof ApiError && error.status === 404) missingResourceIds.add(cacheKey);
            throw error;
        })
        .finally(() => {
            if (resourceRequests.get(cacheKey) === task) resourceRequests.delete(cacheKey);
        });
    resourceRequests.set(cacheKey, task);
    return task;
}

// refreshResource 绕过缓存强制拉取资源最新状态（转码副本就绪轮询用），并回写缓存。
export function refreshResource(id: string): Promise<RemoteResource> {
    const generation = accessGeneration;
    const scope = getActiveUserScope();
    const cacheKey = resourceCacheKey(id);
    return http.get<{ resource: RemoteResource }>(`/resources/${encodeURIComponent(id)}`).then((data) => {
        assertResourceRequestCurrent(generation, scope);
        resourceCache.set(cacheKey, data.resource);
        missingResourceIds.delete(cacheKey);
        return data.resource;
    });
}

function assertResourceRequestCurrent(generation: number, scope: string) {
    if (generation !== accessGeneration || scope !== getActiveUserScope()) {
        throw new DOMException("资源请求已因账号切换失效", "AbortError");
    }
}

export async function getResourceAccess(storageKey: string | undefined, purpose: ResourceAccessPurpose = "display", variant: ResourceAccessVariant = "original", downloadName = "") {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("当前媒体尚未上传到后端资源存储");
    const scope = getActiveUserScope();
    const generation = accessGeneration;
    const key = `${scope}:${id}:${purpose}:${variant}:${downloadName}`;
    const cached = accessCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = accessRequests.get(key);
    if (pending) return pending;
    let request!: Promise<ResourceAccess>;
    request = (async () => {
        try {
            // 只跨页面复用普通展示地址。下载和模型输入地址可能包含更敏感的权限/文件名，仍只保留内存缓存。
            if (purpose === "display") {
                const persisted = await readPersistedDisplayAccess(scope, id, variant);
                assertResourceRequestCurrent(generation, scope);
                if (persisted) {
                    accessCache.set(key, persisted);
                    return persisted.value;
                }
            }
            const data = await http.post<{ items: ResourceAccessBatchItem[] }>("/resources/access", [{ resourceId: id, purpose, variant, ...(downloadName ? { downloadName } : {}) }]);
            if (generation !== accessGeneration || scope !== getActiveUserScope()) {
                throw new DOMException("资源访问请求已因账号切换失效", "AbortError");
            }
            const item = data.items?.[0];
            if (!item?.access?.url) throw new Error(item?.error?.msg || "后端未返回资源访问地址");
            const value = item.access;
            const entry = { value, expiresAt: resourceAccessCacheExpiry(value) } satisfies CachedResourceAccess;
            if (entry.expiresAt > Date.now()) {
                accessCache.set(key, entry);
                if (purpose === "display") await persistDisplayAccess(scope, id, variant, entry);
            }
            return value;
        } catch (error) {
            if (error instanceof ApiError) throw new Error(error.message || "获取对象存储地址失败");
            throw error;
        } finally {
            if (accessRequests.get(key) === request) accessRequests.delete(key);
        }
    })();
    accessRequests.set(key, request);
    return request;
}

/** 模型上游读取资源使用更长 TTL，但仍走统一资源访问合同。 */
export async function getResourceInputURL(storageKey?: string) {
    return (await getResourceAccess(storageKey, "provider-input")).url;
}

/**
 * Resolve a platform delivery URL against the configured API origin.
 *
 * Cloud deliveries are already absolute CDN/origin URLs. Local/proxy
 * deliveries are intentionally returned by the backend as controlled API
 * paths; when the frontend talks to a separate backend origin, resolving the
 * path here prevents a Blob read from accidentally targeting the web origin.
 */
export function resolveResourceAccessURL(url: string) {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return url;
    const base = String(apiBaseURL).trim();
    if (!/^https?:\/\//i.test(base)) return url;
    return new URL(url, `${base.replace(/\/+$/, "")}/`).toString();
}

function resourceCacheKey(id: string) {
    return `${getActiveUserScope()}:${id}`;
}

export function resourceFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file`;
}

export function resolveResourceUrl(storageKey?: string, fallback = "") {
    const id = resourceIdFromStorageKey(storageKey);
    // 资源引用本身已经包含稳定 ID；恢复/展示阶段不需要再查一遍元数据。
    // 需要 publicUrl、mime 或尺寸时必须显式调用 getResource，避免隐式 N+1。
    return id ? resourceFileUrl(id) : fallback;
}

// playbackVariantUrl 返回浏览器兼容播放副本 URL（H.265→H.264 转码结果）。
// 副本就绪前由后端回退原件，调用方再按需降级。
export function playbackVariantUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?variant=playback`;
}

export async function getResourceBlob(storageKey: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return null;
    const access = await getResourceAccess(storageKey, "browser-process");
    // CDN/origin URLs carry their own authorization and must not receive the
    // application session cookie. Local/proxy delivery is intentionally
    // session-bound, so a Blob read must include it even when the URL is
    // relative to the platform origin.
    const credentials = access.delivery === "platform-local" || access.delivery === "platform-proxy" ? "include" : "omit";
    const response = await fetch(resolveResourceAccessURL(access.url), { credentials, mode: "cors" });
    if (!response.ok) throw new Error(`资源读取失败（${response.status}）`);
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
