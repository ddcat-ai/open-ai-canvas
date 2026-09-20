import { getActiveUserScope } from "@/lib/user-scope";
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
const ossUrlCache = new Map<string, { url: string; expiresAt: number }>();
const ossUrlRequests = new Map<string, Promise<string>>();
const OSS_URL_CACHE_TTL_MS = 4 * 60 * 1000;

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

export async function uploadResourceFile(
    file: Blob,
    kind: "image" | "video" | "audio" | "file",
    meta?: ResourceUploadMeta,
    onProgress?: (uploadedBytes: number, totalBytes: number) => void,
): Promise<RemoteResource> {
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
            onUploadProgress: onProgress ? ({ loaded, total }) => {
                if (total && total > 0) onProgress(Math.min(file.size, file.size * loaded / total), file.size);
            } : undefined,
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
    const session = await http.post<{ uploadId: string; chunkSize: number; chunkCount: number }>("/resources/uploads", { fileName: name, kind, size: file.size, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs }, uploadRequestConfig(meta?.idempotencyKey));
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
    const cacheKey = resourceCacheKey(id);
    const cached = resourceCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (missingResourceIds.has(cacheKey)) return Promise.reject(new Error("资源不存在或已被删除"));
    const pending = resourceRequests.get(cacheKey);
    if (pending) return pending;
    const task = http.get<{ resource: RemoteResource }>(`/resources/${encodeURIComponent(id)}`)
        .then((data) => {
            resourceCache.set(cacheKey, data.resource);
            return data.resource;
        })
        .catch((error) => {
            if (error instanceof ApiError && error.status === 404) missingResourceIds.add(cacheKey);
            throw error;
        })
        .finally(() => resourceRequests.delete(cacheKey));
    resourceRequests.set(cacheKey, task);
    return task;
}

// refreshResource 绕过缓存强制拉取资源最新状态（转码副本就绪轮询用），并回写缓存。
export function refreshResource(id: string): Promise<RemoteResource> {
    const cacheKey = resourceCacheKey(id);
    return http.get<{ resource: RemoteResource }>(`/resources/${encodeURIComponent(id)}`)
        .then((data) => {
            resourceCache.set(cacheKey, data.resource);
            missingResourceIds.delete(cacheKey);
            return data.resource;
        });
}

export async function getResourceOSSUrl(storageKey?: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("当前媒体尚未上传到后端资源存储");
    const cached = ossUrlCache.get(resourceCacheKey(id));
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const pending = ossUrlRequests.get(resourceCacheKey(id));
    if (pending) return pending;
    const request = (async () => {
        try {
            const data = await http.get<{ url: string }>(`/resources/${encodeURIComponent(id)}/oss-url`);
            if (!data.url) throw new Error("后端未返回对象存储地址");
            ossUrlCache.set(resourceCacheKey(id), { url: data.url, expiresAt: Date.now() + OSS_URL_CACHE_TTL_MS });
            return data.url;
        } catch (error) {
            if (error instanceof ApiError) throw new Error(error.message || "获取对象存储地址失败");
            throw error;
        } finally {
            ossUrlRequests.delete(resourceCacheKey(id));
        }
    })();
    ossUrlRequests.set(resourceCacheKey(id), request);
    return request;
}

function resourceCacheKey(id: string) {
    return `${getActiveUserScope()}:${id}`;
}

export function resourceFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?direct=1`;
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

// playbackVariantUrl 返回浏览器兼容播放副本 URL（H.265→H.264 转码结果）。
// 副本就绪前由后端回退原件，调用方再按需降级。
export function playbackVariantUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?variant=playback&direct=1`;
}

export async function getResourceBlob(storageKey: string, options?: { allowProxyFallback?: boolean }) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return null;
    // A direct OSS response needs CORS to be readable as a Blob. Native <img>/<video>
    // can still display it without CORS, so background cache fills must not proxy it.
    try {
        const ossUrl = await getResourceOSSUrl(storageKey);
        const response = await fetch(ossUrl, { credentials: "omit", mode: "cors" });
        if (response.ok) return response.blob();
        if (!options?.allowProxyFallback || response.status === 401 || response.status === 403 || response.status === 404) return null;
    } catch (error) {
        if (!options?.allowProxyFallback) throw error;
    }
    if (!options?.allowProxyFallback) return null;
    const response = await fetch(resourceProxyFileUrl(id), { credentials: "include" });
    return response.ok ? response.blob() : null;
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
