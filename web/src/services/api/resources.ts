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
    transferPending?: boolean;
    browserDirect?: boolean;
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
    signal?: AbortSignal;
};

export type BrowserResourceUploadResult = {
    resource?: RemoteResource;
    upload?: { id: string; url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
    fallbackReason?: string;
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
export type ResourceAccessVariant = "original" | "playback" | "thumbnail";
export type ResourceAccess = {
    resourceId: string;
    requestedVariant: ResourceAccessVariant;
    actualVariant: ResourceAccessVariant;
    url: string;
    delivery: "cdn" | "origin" | "platform-local" | "platform-proxy" | "upstream";
    issuedAt: string;
    expiresAt?: string;
    refreshAt: string;
    revision: string;
    fallbackReason?: string;
    originalWidth?: number;
    originalHeight?: number;
};

export type ResourceAccessFetchOptions = {
    /** Bypass both in-memory and persisted display-address caches. */
    forceRefresh?: boolean;
};

type ResourceAccessBatchItem = { resourceId: string; access?: ResourceAccess; error?: { code?: number; reason?: string; msg?: string } };
type CachedResourceAccess = { value: ResourceAccess; expiresAt: number };
type ResourceAccessRequestPayload = {
    resourceId: string;
    purpose: ResourceAccessPurpose;
    variant: ResourceAccessVariant;
    downloadName?: string;
};
type PendingResourceAccess = {
    key: string;
    scope: string;
    generation: number;
    payload: ResourceAccessRequestPayload;
    resolve: (value: ResourceAccess) => void;
    reject: (reason?: unknown) => void;
};
const accessCache = new Map<string, CachedResourceAccess>();
const accessRequests = new Map<string, Promise<ResourceAccess>>();
const pendingResourceAccess = new Map<string, PendingResourceAccess>();
let resourceAccessBatchTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (resourceAccessBatchTimer !== undefined) {
        clearTimeout(resourceAccessBatchTimer);
        resourceAccessBatchTimer = undefined;
    }
    const abortError = new DOMException("资源访问请求已因账号切换失效", "AbortError");
    pendingResourceAccess.forEach((entry) => entry.reject(abortError));
    pendingResourceAccess.clear();
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
    const scope = getActiveUserScope();
    const generation = accessGeneration;
    meta = { ...meta, idempotencyKey: meta?.idempotencyKey || `browser:${scope}:${crypto.randomUUID()}` };
    const name = meta?.fileName || (file instanceof File ? file.name : `${kind}.${extensionFromMime(file.type, kind)}`);
    // 分片与 multipart 两条路径的失败都要归一成 ResourceUploadError，
    // 否则调用方只能靠文案猜测该重试还是该报错。
    try {
        const direct = await http.post<BrowserResourceUploadResult>(
            "/resources/uploads/direct",
            {
                fileName: name,
                mimeType: file.type || "application/octet-stream",
                size: file.size,
                width: meta?.width,
                height: meta?.height,
                durationMs: meta?.durationMs,
                idempotencyKey: meta?.idempotencyKey,
            },
            { signal: meta?.signal },
        );
        if (direct.resource) {
            return rememberUploadedResource(direct.resource, generation, scope);
        }
        if (direct.upload) {
            const upload = direct.upload;
            let uploaded = false;
            try {
                await putBrowserUpload(upload, file, meta?.signal, onProgress);
                uploaded = true;
                const completed = await completeBrowserUpload(upload.id, meta?.signal);
                return rememberUploadedResource(completed.resource, generation, scope);
            } catch (error) {
                if (meta?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
                // PUT 已成功时只重试幂等确认；确认服务故障不能触发删除对象和重传整份文件。
                if (uploaded) throw error;
                // CORS 可能只挡住 PUT 响应；先核验对象，避免已经上传的文件被重复发送。
                try {
                    const completed = await http.post<{ resource: RemoteResource }>(`/resources/uploads/direct/${encodeURIComponent(upload.id)}/complete`);
                    return rememberUploadedResource(completed.resource, generation, scope);
                } catch (completionError) {
                    if (completionError instanceof DOMException && completionError.name === "AbortError") throw completionError;
                    await http.delete(`/resources/uploads/direct/${encodeURIComponent(upload.id)}`);
                }
                console.info("浏览器直传未完成，改用服务器上传", { reason: "browser_upload_failed", resourceId: upload.id });
            }
        } else if (!direct.fallbackReason) {
            throw new Error("后端未返回上传会话或明确的服务器上传原因");
        }
        if (direct.fallbackReason) console.info("使用服务器上传", { reason: direct.fallbackReason });
        if (file.size > CHUNK_UPLOAD_THRESHOLD) {
            const resource = await uploadFileInChunks(file, name, kind, meta, onProgress);
            return rememberUploadedResource(resource, generation, scope);
        }
        const formData = new FormData();
        formData.append("kind", kind);
        formData.append("file", file, name);
        if (meta?.width) formData.append("width", String(Math.round(meta.width)));
        if (meta?.height) formData.append("height", String(Math.round(meta.height)));
        if (meta?.durationMs) formData.append("durationMs", String(Math.round(meta.durationMs)));
        const data = await http.post<{ resource: RemoteResource }>("/resources", formData, {
            ...uploadRequestConfig(meta?.idempotencyKey),
            signal: meta?.signal,
            onUploadProgress: onProgress
                ? ({ loaded, total }) => {
                      if (total && total > 0) onProgress(Math.min(file.size, (file.size * loaded) / total), file.size);
                  }
                : undefined,
        });
        return rememberUploadedResource(data.resource, generation, scope);
    } catch (error) {
        throw normalizeUploadError(error);
    }
}

async function completeBrowserUpload(id: string, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        try {
            return await http.post<{ resource: RemoteResource }>(`/resources/uploads/direct/${encodeURIComponent(id)}/complete`, undefined, { signal, timeout: 30_000 });
        } catch (error) {
            signal?.throwIfAborted();
            if (!(error instanceof ApiError) || !error.retryable || attempt >= 2) throw error;
            const delay = Math.max(500 * 2 ** attempt, error.retryAfterMs || 0);
            if (delay > 10_000) throw error;
            await new Promise<void>((resolve, reject) => {
                const abort = () => {
                    clearTimeout(timer);
                    reject(signal?.reason);
                };
                const timer = setTimeout(() => {
                    signal?.removeEventListener("abort", abort);
                    resolve();
                }, delay);
                signal?.addEventListener("abort", abort, { once: true });
            });
        }
    }
}

export function putBrowserUpload(upload: NonNullable<BrowserResourceUploadResult["upload"]>, file: Blob, signal?: AbortSignal, onProgress?: (uploadedBytes: number, totalBytes: number) => void) {
    return new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        const abort = () => request.abort();
        const finish = (error?: Error) => {
            signal?.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve();
        };
        request.open(upload.method, upload.url);
        request.withCredentials = false;
        request.timeout = 15 * 60_000;
        Object.entries(upload.headers).forEach(([name, value]) => request.setRequestHeader(name, value));
        request.upload.onprogress = ({ loaded }) => onProgress?.(Math.min(file.size, loaded), file.size);
        request.onload = () => finish(request.status >= 200 && request.status < 300 ? undefined : new Error(`对象存储上传失败（${request.status}）`));
        request.onerror = () => finish(new Error("浏览器无法直传对象存储，请检查 CORS 或网络连接"));
        request.ontimeout = () => finish(new Error("浏览器直传超时"));
        request.onabort = () => finish(new DOMException("上传已取消", "AbortError"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            finish(new DOMException("上传已取消", "AbortError"));
            return;
        }
        request.send(file);
    });
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
        { fileName: name, kind, size: file.size, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs, idempotencyKey: meta?.idempotencyKey },
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
            timeout: 60_000,
            headers: { "Content-Type": "application/octet-stream" },
            onUploadProgress: onProgress ? ({ loaded }) => onProgress(start + Math.min(loaded, blob.size), file.size) : undefined,
        });
        onProgress?.(Math.min(end, file.size), file.size);
    }
    const complete = await http.post<{ resource: RemoteResource }>(`/resources/uploads/${encodeURIComponent(session.uploadId)}/complete`, undefined, { timeout: 60_000 });
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
    return { timeout: 60_000, ...(value ? { headers: { "X-Idempotency-Key": value } } : {}) };
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
    return http.get<{ resource: RemoteResource }>(`/resources/${encodeURIComponent(id)}`, { timeout: 15_000 }).then((data) => {
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

function rememberUploadedResource(resource: RemoteResource, generation: number, scope: string) {
    assertResourceRequestCurrent(generation, scope);
    resourceCache.set(`${scope}:${resource.id}`, resource);
    return resource;
}

const RESOURCE_ACCESS_BATCH_LIMIT = 100;
const RESOURCE_ACCESS_BATCH_DELAY_MS = 16;

function resourceAccessAbortError() {
    return new DOMException("资源访问请求已因账号切换失效", "AbortError");
}

function scheduleResourceAccessBatch() {
    if (resourceAccessBatchTimer !== undefined) return;
    resourceAccessBatchTimer = setTimeout(() => {
        resourceAccessBatchTimer = undefined;
        void flushResourceAccessBatch();
    }, RESOURCE_ACCESS_BATCH_DELAY_MS);
}

function enqueueResourceAccess(entry: Omit<PendingResourceAccess, "resolve" | "reject">) {
    return new Promise<ResourceAccess>((resolve, reject) => {
        pendingResourceAccess.set(entry.key, { ...entry, resolve, reject });
        scheduleResourceAccessBatch();
    });
}

async function completeResourceAccessBatchEntry(entry: PendingResourceAccess, item: ResourceAccessBatchItem | undefined) {
    if (entry.generation !== accessGeneration || entry.scope !== getActiveUserScope()) throw resourceAccessAbortError();
    if (!item?.access?.url) throw new ApiError(item?.error?.msg || "后端未返回资源访问地址", { code: item?.error?.code, reason: item?.error?.reason });
    const value = item.access;
    const cachedEntry = { value, expiresAt: resourceAccessCacheExpiry(value) } satisfies CachedResourceAccess;
    if (cachedEntry.expiresAt > Date.now()) {
        accessCache.set(entry.key, cachedEntry);
        if (entry.payload.purpose === "display") await persistDisplayAccess(entry.scope, entry.payload.resourceId, entry.payload.variant, cachedEntry);
    }
    if (entry.generation !== accessGeneration || entry.scope !== getActiveUserScope()) {
        accessCache.delete(entry.key);
        throw resourceAccessAbortError();
    }
    if (value.delivery === "upstream" && typeof document !== "undefined") {
        void import("@/services/generated-resource-transfer")
            .then(({ scheduleGeneratedResourceTransfer }) => {
                if (entry.scope === getActiveUserScope()) scheduleGeneratedResourceTransfer(value.resourceId, value.url);
            })
            .catch(() => undefined);
    }
    return value;
}

const resourceAccessListeners = new Set<(resourceId: string) => void>();

export function subscribeResourceAccessUpdates(listener: (resourceId: string) => void) {
    resourceAccessListeners.add(listener);
    return () => {
        resourceAccessListeners.delete(listener);
    };
}

export async function invalidateResourceAccess(storageKey: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return;
    const scope = getActiveUserScope();
    const prefix = `${scope}:${id}:`;
    await Promise.allSettled(
        Array.from(accessRequests.entries())
            .filter(([key]) => key.startsWith(prefix))
            .map(([, request]) => request),
    );
    if (scope !== getActiveUserScope()) return;
    for (const key of accessCache.keys()) if (key.startsWith(prefix)) accessCache.delete(key);
    await Promise.allSettled(["original", "thumbnail"].map((variant) => localForageStorageForScope(scope).removeItem(persistedDisplayAccessKey(id, variant as ResourceAccessVariant))));
    if (scope === getActiveUserScope()) resourceAccessListeners.forEach((listener) => listener(id));
}

export function beginGeneratedResourceUpload(id: string, blob: Blob, width: number, height: number, signal?: AbortSignal) {
    return http.post<BrowserResourceUploadResult>(
        `/resources/${encodeURIComponent(id)}/generated-upload`,
        {
            fileName: "generated",
            mimeType: blob.type,
            size: blob.size,
            width,
            height,
        },
        { signal },
    );
}

export async function completeGeneratedResourceUpload(id: string, uploadId: string, signal?: AbortSignal) {
    const result = await http.post<{ resource: RemoteResource }>(`/resources/${encodeURIComponent(id)}/generated-upload/${encodeURIComponent(uploadId)}/complete`, undefined, { signal });
    return result.resource;
}

export function requestGeneratedResourceFallback(id: string, uploadId = "") {
    return http.post(`/resources/${encodeURIComponent(id)}/generated-upload/${encodeURIComponent(uploadId || "none")}/fallback`);
}

async function flushResourceAccessBatch() {
    const currentScope = getActiveUserScope();
    const currentGeneration = accessGeneration;
    const queuedEntries = Array.from(pendingResourceAccess.values());
    pendingResourceAccess.clear();
    const entries: PendingResourceAccess[] = [];
    for (const entry of queuedEntries) {
        if (entry.scope !== currentScope || entry.generation !== currentGeneration) entry.reject(resourceAccessAbortError());
        else if (entries.length < RESOURCE_ACCESS_BATCH_LIMIT) entries.push(entry);
        else pendingResourceAccess.set(entry.key, entry);
    }
    if (!entries.length) {
        if (pendingResourceAccess.size) scheduleResourceAccessBatch();
        return;
    }

    try {
        const data = await http.post<{ items: ResourceAccessBatchItem[] }>(
            "/resources/access",
            entries.map((entry) => entry.payload),
            { timeout: 15_000 },
        );
        await Promise.all(
            entries.map(async (entry, index) => {
                try {
                    entry.resolve(await completeResourceAccessBatchEntry(entry, data.items?.[index]));
                } catch (error) {
                    entry.reject(error);
                }
            }),
        );
    } catch (error) {
        entries.forEach((entry) => entry.reject(error));
    } finally {
        if (pendingResourceAccess.size) scheduleResourceAccessBatch();
    }
}

export async function getResourceAccess(storageKey: string | undefined, purpose: ResourceAccessPurpose = "display", variant: ResourceAccessVariant = "original", downloadName = "", fetchOptions: ResourceAccessFetchOptions = {}) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("当前媒体尚未上传到后端资源存储");
    const scope = getActiveUserScope();
    const generation = accessGeneration;
    const key = `${scope}:${id}:${purpose}:${variant}:${downloadName}`;
    const forceRefresh = fetchOptions.forceRefresh === true;
    if (forceRefresh) {
        accessCache.delete(key);
        const inFlightRefresh = accessRequests.get(key);
        if (inFlightRefresh) return inFlightRefresh;
        if (purpose === "display") {
            try {
                await localForageStorageForScope(scope).removeItem(persistedDisplayAccessKey(id, variant));
            } catch {
                // Persisted address caching is optional; the network request below remains authoritative.
            }
        }
    }
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
            return await enqueueResourceAccess({
                key,
                scope,
                generation,
                payload: { resourceId: id, purpose, variant, ...(downloadName ? { downloadName } : {}) },
            });
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

/** 浏览器无法读取 CDN 时，给多模态 Agent 一个可由模型上游直接访问的展示签名地址。 */
export async function getResourceDisplayURL(storageKey?: string) {
    return resolveResourceAccessURL((await getResourceAccess(storageKey, "display")).url);
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

export async function getResourceBlob(storageKey: string, options: { signal?: AbortSignal; variant?: ResourceAccessVariant } = {}) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return null;
    const access = await getResourceAccess(storageKey, "browser-process", options.variant || "original");
    // CDN/origin URLs carry their own authorization and must not receive the
    // application session cookie. Local/proxy delivery is intentionally
    // session-bound, so a Blob read must include it even when the URL is
    // relative to the platform origin.
    const credentials = access.delivery === "platform-local" || access.delivery === "platform-proxy" ? "include" : "omit";
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    let response: Response;
    try {
        response = await fetch(resolveResourceAccessURL(access.url), { credentials, mode: "cors", signal });
    } catch (error) {
        if (signal.aborted || !(error instanceof TypeError) || access.delivery === "platform-local" || access.delivery === "platform-proxy") throw error;
        console.info("浏览器无法读取对象存储，使用已鉴权服务器路径", { resourceId: id, reason: "cors_or_network" });
        const base = String(apiBaseURL).replace(/\/+$/, "");
        response = await fetch(`${base}/resources/${encodeURIComponent(id)}/browser-file?reason=cors_or_network&variant=${encodeURIComponent(options.variant || "original")}`, { credentials: "include", signal });
    }
    if (!response.ok) throw new Error(`资源读取失败（${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("资源内容为空");
    return blob;
}

export async function uploadResourceThumbnail(storageKey: string, blob: Blob) {
    const scope = getActiveUserScope();
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("原图尚未上传，无法保存缩略图");
    const { createImageBitmap } = globalThis;
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        const input = { fileName: "thumbnail", mimeType: blob.type, size: blob.size, width: bitmap.width, height: bitmap.height };
        bitmap.close();
        try {
            const direct = await http.post<BrowserResourceUploadResult>(`/resources/${encodeURIComponent(id)}/thumbnail-upload/begin`, input);
            if (scope !== getActiveUserScope()) return;
            if (direct.resource) return;
            if (direct.upload) {
                try {
                    await putBrowserUpload(direct.upload, blob, AbortSignal.timeout(45_000));
                } catch {
                    /* PUT responses can be hidden by CORS; verify the object first. */
                }
                await http.post(`/resources/${encodeURIComponent(id)}/thumbnail-upload/complete`, input);
                if (scope === getActiveUserScope()) await invalidateResourceAccess(storageKey);
                return;
            }
        } catch {
            // Bounded thumbnail fallback never delays the already available original.
        }
    }
    if (scope !== getActiveUserScope()) return;
    const data = new FormData();
    data.append("file", blob, blob.type === "image/jpeg" ? "thumbnail.jpg" : "thumbnail.png");
    await http.post(`/resources/${encodeURIComponent(id)}/thumbnail`, data);
    if (scope === getActiveUserScope()) await invalidateResourceAccess(storageKey);
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
