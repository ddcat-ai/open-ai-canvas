import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { getActiveUserScope } from "@/lib/user-scope";
import { ApiError } from "@/services/api/request";
import { getResourceAccess, importResourceFromUrl, isResourceUrl, refreshResource, resolveResourceAccessURL, resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, ResourceUploadError, uploadResourceFile } from "@/services/api/resources";
import { getCachedResourceBlob, primeResourceBlobCache } from "@/services/resource-blob-cache";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    /**
     * true 表示直传失败、文件当前只存在于本机 IndexedDB。
     * 云端数据同步会用同一幂等键重传，但在那之前它不是一份已持久化的服务端资源：
     * `url` 是页面级 objectURL，刷新即失效。UI 不得把这种结果说成"已保存"。
     */
    pendingRemoteUpload?: boolean;
    /** 直传失败原因，仅在 pendingRemoteUpload 为 true 时有值，供 UI 如实告知用户。 */
    remoteUploadError?: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const uploadedImageStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_upload_results" });
const objectUrls = new Map<string, string>();
type LocalImageUploadState = "staged" | "queued" | "uploading" | "ready" | "failed";
type LocalImageUploadJob = {
    storageKey: string;
    fileName?: string;
    blob?: Blob;
    previewUrl: string;
    state: LocalImageUploadState;
    promise: Promise<UploadedImage>;
    resolve: (image: UploadedImage) => void;
    reject: (error: unknown) => void;
    result?: UploadedImage;
    error?: unknown;
    cancelled?: boolean;
    settled?: boolean;
};
export type LocalImageUploadEvent = { state: LocalImageUploadState; image?: UploadedImage; error?: unknown };
const stagedImageBlobs = new Map<string, Blob>();
const imageStageWrites = new Map<string, Promise<void>>();
const localImageUploadJobs = new Map<string, LocalImageUploadJob>();
const localImageUploadQueue: LocalImageUploadJob[] = [];
const localImageUploadListeners = new Map<string, Set<(event: LocalImageUploadEvent) => void>>();
const MAX_CONCURRENT_LOCAL_IMAGE_UPLOADS = 2;
let activeLocalImageUploads = 0;

export function createImageStorageKey() {
    return `image:${getActiveUserScope()}:${nanoid()}`;
}

export function releaseImagePreview(storageKey: string, fallbackUrl = "") {
    const url = objectUrls.get(storageKey) || fallbackUrl;
    objectUrls.delete(storageKey);
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

/**
 * 将图片先写入浏览器本地存储并返回即时预览地址；此函数不发起网络请求。
 * 图片仅在调用 ensureImageUploaded（生成或显式云端同步）时上传。
 */
export function stageLocalImageUpload(input: Blob, options: { storageKey?: string; previewUrl?: string; fileName?: string } = {}) {
    const storageKey = options.storageKey || createImageStorageKey();
    const previewUrl = options.previewUrl || URL.createObjectURL(input);
    objectUrls.set(storageKey, previewUrl);
    stagedImageBlobs.set(storageKey, input);
    const write = store
        .setItem(storageKey, input)
        .then(() => {
            stagedImageBlobs.delete(storageKey);
        })
        .catch((error: unknown) => {
            // 保留当前会话中的 Blob，使用户仍可继续生成；刷新前若 IndexedDB 不可用则会明确报错。
            console.warn("参考图片本地暂存失败", error);
        });
    imageStageWrites.set(storageKey, write);
    void write.finally(() => {
        if (imageStageWrites.get(storageKey) === write) imageStageWrites.delete(storageKey);
    });
    return { storageKey, previewUrl };
}

export function subscribeLocalImageUpload(storageKey: string, listener: (event: LocalImageUploadEvent) => void) {
    const listeners = localImageUploadListeners.get(storageKey) || new Set();
    listeners.add(listener);
    localImageUploadListeners.set(storageKey, listeners);
    const job = localImageUploadJobs.get(storageKey);
    listener(job ? localImageUploadEvent(job) : { state: "staged" });
    return () => {
        listeners.delete(listener);
        if (!listeners.size) localImageUploadListeners.delete(storageKey);
    };
}

/** 在用户提交生成或明确同步时上传本地图片；同一 storageKey 并发复用同一个任务。 */
export async function ensureImageUploaded(storageKey: string, fileName?: string): Promise<UploadedImage> {
    const cachedResult = await uploadedImageStore.getItem<UploadedImage>(storageKey);
    if (cachedResult?.storageKey && resourceIdFromStorageKey(cachedResult.storageKey)) {
        const resourceId = resourceIdFromStorageKey(cachedResult.storageKey);
        try {
            const resource = await refreshResource(resourceId);
            if (resource.status !== "deleted" && resource.status !== "failed") {
                localImageUploadListeners.get(storageKey)?.forEach((listener) => listener({ state: "ready", image: cachedResult }));
                return cachedResult;
            }
        } catch (error) {
            // 网络暂时不可用时仍可复用已知资源；明确的 404 才回到本地 Blob 重传。
            if (!(error instanceof ApiError) || error.status !== 404) {
                localImageUploadListeners.get(storageKey)?.forEach((listener) => listener({ state: "ready", image: cachedResult }));
                return cachedResult;
            }
        }
        await uploadedImageStore.removeItem(storageKey).catch(() => undefined);
        localImageUploadJobs.delete(storageKey);
    }

    const existing = localImageUploadJobs.get(storageKey);
    if (existing?.state === "ready" && existing.result) return existing.result;
    if (existing && (existing.state === "queued" || existing.state === "uploading")) return existing.promise;

    await imageStageWrites.get(storageKey);
    const concurrent = localImageUploadJobs.get(storageKey);
    if (concurrent?.state === "ready" && concurrent.result) return concurrent.result;
    if (concurrent && (concurrent.state === "queued" || concurrent.state === "uploading")) return concurrent.promise;

    const blob = stagedImageBlobs.get(storageKey) || (await getImageBlob(storageKey));
    if (!blob) throw new Error("参考图片尚未保存在本机，请重新添加后再生成");
    const job = createLocalImageUploadJob(storageKey, blob, fileName, objectUrls.get(storageKey) || "");
    localImageUploadJobs.set(storageKey, job);
    localImageUploadQueue.push(job);
    pumpLocalImageUploads();
    return job.promise;
}

export async function hasCompletedImageUpload(storageKey: string) {
    if (resourceIdFromStorageKey(storageKey)) return true;
    const job = localImageUploadJobs.get(storageKey);
    if (job?.state === "ready") return true;
    const result = await uploadedImageStore.getItem<UploadedImage>(storageKey);
    return Boolean(result?.storageKey && resourceIdFromStorageKey(result.storageKey));
}

function createLocalImageUploadJob(storageKey: string, blob: Blob, fileName: string | undefined, previewUrl: string): LocalImageUploadJob {
    let resolve!: (image: UploadedImage) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<UploadedImage>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { storageKey, blob, fileName, previewUrl, state: "queued", promise, resolve, reject };
}

function localImageUploadEvent(job: LocalImageUploadJob): LocalImageUploadEvent {
    return { state: job.state, ...(job.result ? { image: job.result } : {}), ...(job.error ? { error: job.error } : {}) };
}

function notifyLocalImageUpload(job: LocalImageUploadJob) {
    const event = localImageUploadEvent(job);
    localImageUploadListeners.get(job.storageKey)?.forEach((listener) => listener(event));
}

function pumpLocalImageUploads() {
    while (activeLocalImageUploads < MAX_CONCURRENT_LOCAL_IMAGE_UPLOADS && localImageUploadQueue.length) {
        const job = localImageUploadQueue.shift();
        if (!job) return;
        activeLocalImageUploads += 1;
        job.state = "uploading";
        notifyLocalImageUpload(job);
        void uploadLocalImageJob(job)
            .then((image) => {
                if (job.cancelled) return;
                void uploadedImageStore
                    .setItem(job.storageKey, image)
                    .catch((error: unknown) => console.warn("参考图片上传结果缓存失败", error))
                    .finally(() => {
                        if (job.cancelled) {
                            void uploadedImageStore.removeItem(job.storageKey).catch(() => undefined);
                            return;
                        }
                        job.state = "ready";
                        job.result = image;
                        job.blob = undefined;
                        settleLocalImageUpload(job, image);
                        notifyLocalImageUpload(job);
                    });
            })
            .catch((error: unknown) => {
                if (job.cancelled) return;
                job.state = "failed";
                job.error = error;
                settleLocalImageUpload(job, undefined, error);
                notifyLocalImageUpload(job);
            })
            .finally(() => {
                activeLocalImageUploads = Math.max(0, activeLocalImageUploads - 1);
                pumpLocalImageUploads();
            });
    }
}

function settleLocalImageUpload(job: LocalImageUploadJob, image?: UploadedImage, error?: unknown) {
    if (job.settled) return;
    job.settled = true;
    if (error) job.reject(error);
    else if (image) job.resolve(image);
}

export function cancelLocalImageUpload(storageKey: string) {
    const job = localImageUploadJobs.get(storageKey);
    if (!job || job.state === "ready" || job.state === "failed") return;
    job.cancelled = true;
    job.state = "failed";
    job.error = new DOMException("本地图片上传已取消", "AbortError");
    const queuedIndex = localImageUploadQueue.indexOf(job);
    if (queuedIndex >= 0) localImageUploadQueue.splice(queuedIndex, 1);
    settleLocalImageUpload(job, undefined, job.error);
    notifyLocalImageUpload(job);
    localImageUploadJobs.delete(storageKey);
}

async function uploadLocalImageJob(job: LocalImageUploadJob): Promise<UploadedImage> {
    const blob = job.blob || (await getImageBlob(job.storageKey));
    if (!blob) throw new Error("参考图片的本地缓存已失效，请重新添加后再生成");
    let meta = job.previewUrl ? await readImageMeta(job.previewUrl).catch(() => undefined) : undefined;
    if (!meta) {
        const previewUrl = URL.createObjectURL(blob);
        try {
            meta = await readImageMeta(previewUrl).catch(() => undefined);
        } finally {
            URL.revokeObjectURL(previewUrl);
        }
    }
    const resource = await uploadResourceFile(blob, "image", {
        width: meta?.width,
        height: meta?.height,
        fileName: job.fileName,
        idempotencyKey: job.storageKey,
    });
    const storageKey = resourceStorageKey(resource.id);
    await primeResourceBlobCache(storageKey, blob).catch(() => "");
    return {
        url: resource.publicUrl || resourceFileUrl(resource.id),
        storageKey,
        width: resource.width || meta?.width || 0,
        height: resource.height || meta?.height || 0,
        bytes: resource.size || blob.size,
        mimeType: resource.mimeType || blob.type || meta?.mimeType || "image/png",
    };
}

export async function uploadImage(input: string | Blob, onProgress?: (uploadedBytes: number, totalBytes: number) => void): Promise<UploadedImage> {
    // 同一个逻辑上传在直传失败后会退回 IndexedDB，并由云端数据同步再次提交。
    // 提前生成本地 key，确保两条路径向后端发送相同的幂等标识。
    const storageKey = createImageStorageKey();
    if (typeof input === "string" && shouldImportRemoteImage(input)) {
        try {
            const resource = await importResourceFromUrl(input, "image", { idempotencyKey: storageKey });
            return {
                url: resource.publicUrl || resourceFileUrl(resource.id),
                storageKey: resourceStorageKey(resource.id),
                width: resource.width || 1024,
                height: resource.height || 1024,
                bytes: resource.size || 0,
                mimeType: resource.mimeType || "image/png",
            };
        } catch {
            // Keep the browser-side path as a fallback for CORS-enabled HTTPS images.
        }
    }
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const previewUrl = URL.createObjectURL(blob);
    const meta = await readImageMeta(previewUrl);
    let remoteUploadError = "";
    try {
        const resource = await uploadResourceFile(blob, "image", { width: meta.width, height: meta.height, fileName: input instanceof File ? input.name : undefined, idempotencyKey: storageKey }, onProgress);
        await primeResourceBlobCache(resourceStorageKey(resource.id), blob).catch(() => "");
        URL.revokeObjectURL(previewUrl);
        return {
            url: resource.publicUrl || resourceFileUrl(resource.id),
            storageKey: resourceStorageKey(resource.id),
            width: resource.width || meta.width,
            height: resource.height || meta.height,
            bytes: resource.size || blob.size,
            mimeType: resource.mimeType || blob.type || meta.mimeType,
        };
    } catch (error) {
        // 鉴权失效、越权、体积超限这类失败重传也是同样结果，不能退化成"稍后自动同步"。
        if (error instanceof ResourceUploadError && error.permanent) throw error;
        remoteUploadError = error instanceof Error ? error.message : "图片直传失败";
    }
    // 瞬时失败退回本机：文件仍可用，且云端数据同步会用同一幂等键重传。
    await store.setItem(storageKey, blob);
    const url = previewUrl;
    objectUrls.set(storageKey, url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType, pendingRemoteUpload: true, remoteUploadError };
}

function shouldImportRemoteImage(input: string) {
    return /^https?:\/\//i.test(input) && !isResourceUrl(input);
}

export async function resolveImageUrl(storageKey?: string, fallback = "", options?: { cacheMiss?: boolean }) {
    if (!storageKey) return fallback;
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (resourceId) {
        // 远程资源展示直接使用 OSS/CDN 授权地址，不把媒体内容读进浏览器 Blob。
        return resolveResourceAccessURL((await getResourceAccess(storageKey, "display")).url);
    }
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (resourceIdFromStorageKey(storageKey)) return getCachedResourceBlob(storageKey);
    const staged = stagedImageBlobs.get(storageKey);
    if (staged) return staged;
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (resourceIdFromStorageKey(storageKey)) return primeResourceBlobCache(storageKey, blob);
    stagedImageBlobs.set(storageKey, blob);
    void uploadedImageStore.removeItem(storageKey).catch(() => undefined);
    await store.setItem(storageKey, blob);
    stagedImageBlobs.delete(storageKey);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string; name?: string; type?: string; mimeType?: string }) {
    if (image.storageKey) {
        const blob = await getImageBlob(image.storageKey);
        if (blob) return blobToDataUrl(await normalizeImageBlob(blob, image.name || image.url));
    }
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url) return url;
    if (url.startsWith("data:image/")) return url;
    if (url.startsWith("data:")) return blobToDataUrl(await normalizeImageBlob(await (await fetch(url)).blob(), image.name));
    const blob = await (await fetch(url, { credentials: isResourceUrl(url) ? "include" : "same-origin" })).blob();
    return blobToDataUrl(await normalizeImageBlob(blob, image.name || url));
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            if (resourceIdFromStorageKey(key)) return;
            cancelLocalImageUpload(key);
            await imageStageWrites.get(key);
            stagedImageBlobs.delete(key);
            localImageUploadJobs.delete(key);
            await uploadedImageStore.removeItem(key).catch(() => undefined);
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown, scope = getActiveUserScope()) {
    const usedKeys = collectImageStorageKeys(usedData);
    const currentPrefixes = [`image:${scope}:`, `generation-image:${scope}:`];
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (currentPrefixes.some((prefix) => key.startsWith(prefix)) && !usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.startsWith("image:") || value.storageKey.startsWith("generation-image:") || resourceIdFromStorageKey(value.storageKey))) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function normalizeImageBlob(blob: Blob, sourceName = "") {
    if (blob.type.startsWith("image/")) return blob;
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const mimeType = detectImageMimeType(bytes) || imageMimeTypeFromName(sourceName);
    if (!mimeType) throw new Error("无法识别参考图片格式，请重新上传 PNG、JPEG、WebP 或 GIF 图片");
    return blob.slice(0, blob.size, mimeType);
}

function detectImageMimeType(bytes: Uint8Array) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    return "";
}

function imageMimeTypeFromName(value: string) {
    const path = value.toLowerCase().split(/[?#]/)[0];
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".gif")) return "image/gif";
    if (path.endsWith(".bmp")) return "image/bmp";
    return "";
}
