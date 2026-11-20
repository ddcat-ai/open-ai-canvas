import localforage from "localforage";

import { getActiveUserScope } from "@/lib/user-scope";
import { clearLocalMediaObjectUrls } from "@/services/local-media-object-urls";
import { getResourceBlob, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";

type ResourceCacheMeta = {
    key: string;
    userScope: string;
    resourceId: string;
    version: string;
    size: number;
    mimeType: string;
    lastAccessedAt: number;
};

export type ResourceObjectUrlLease = { url: string; release: () => void };
type LeasedUrl = { url: string; references: number };

const blobStore = localforage.createInstance({ name: "yingce", storeName: "resource_blobs" });
const metaStore = localforage.createInstance({ name: "yingce", storeName: "resource_blob_meta" });
const leasedUrls = new Map<string, LeasedUrl>();
const sessionBlobs = new Map<string, Blob>();
let sessionBytes = 0;
const blobInFlight = new Map<string, Promise<Blob | null>>();
const cacheMetaTouchWarnings = new Set<string>();
const metaTouchedAt = new Map<string, number>();
const downloadQueue: Array<() => void> = [];
let activeDownloads = 0;
let persistQueue: Promise<void> = Promise.resolve();
let pendingPersistBytes = 0;
let cacheGeneration = 0;
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const FALLBACK_CACHE_BYTES = 512 * 1024 * 1024;
const MIN_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 1500;
// 只限制可丢弃的内存加速层；正在解码/播放的调用方持有自己的 Blob 或 URL 租约。
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_ENTRIES = 128;
const MAX_PENDING_PERSIST_BYTES = 64 * 1024 * 1024;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const BUDGET_REFRESH_MS = 5 * 60 * 1000;
const MAX_CONCURRENT_DOWNLOADS = 6;

/** Account/logout transitions invalidate pending readers as well as current leases. */
export function clearResourceBlobCache() {
    clearLocalMediaObjectUrls();
    cacheGeneration += 1;
    leasedUrls.forEach(({ url }) => URL.revokeObjectURL(url));
    leasedUrls.clear();
    sessionBlobs.clear();
    sessionBytes = 0;
    blobInFlight.clear();
    metaTouchedAt.clear();
    cacheMetaTouchWarnings.clear();
    cacheStats = null;
}

/** 借用内存中的资源；只在 effect/任务中调用，并在卸载或任务 finally 中 release。 */
export function acquireCachedResourceObjectUrl(storageKey: string): ResourceObjectUrlLease | null {
    const target = cacheTarget(storageKey);
    if (!target) return null;
    const existing = leasedUrls.get(target.key);
    if (existing) return retainUrl(target.key, existing);
    const blob = sessionBlob(target.key);
    return blob ? leaseBlob(target.key, blob) : null;
}

/** 仅查内存/磁盘缓存，不为预览额外下载整个视频。 */
export async function loadCachedResourceObjectUrl(storageKey: string): Promise<ResourceObjectUrlLease | null> {
    const target = cacheTarget(storageKey);
    if (!target) return null;
    const generation = cacheGeneration;
    const existing = acquireCachedResourceObjectUrl(storageKey);
    if (existing) return existing;
    const blob = await blobStore.getItem<Blob>(target.key);
    if (!blob || !isCurrent(target, generation)) return null;
    rememberBlob(target.key, blob);
    touchCacheMetaSafely(target);
    return leaseBlob(target.key, blob);
}

function leaseBlob(key: string, blob: Blob) {
    let entry = leasedUrls.get(key);
    if (!entry) {
        entry = { url: URL.createObjectURL(blob), references: 0 };
        leasedUrls.set(key, entry);
    }
    return retainUrl(key, entry);
}

function retainUrl(key: string, entry: LeasedUrl): ResourceObjectUrlLease {
    entry.references += 1;
    let released = false;
    return {
        url: entry.url,
        release: () => {
            if (released) return;
            released = true;
            entry.references -= 1;
            if (!entry.references && leasedUrls.get(key) === entry) {
                leasedUrls.delete(key);
                URL.revokeObjectURL(entry.url);
            }
        },
    };
}

function sessionBlob(key: string) {
    const blob = sessionBlobs.get(key);
    if (blob) {
        sessionBlobs.delete(key);
        sessionBlobs.set(key, blob);
    }
    return blob;
}

function rememberBlob(key: string, blob: Blob) {
    const previous = sessionBlobs.get(key);
    if (previous) {
        sessionBlobs.delete(key);
        sessionBytes -= previous.size;
    }
    if (blob.size > MAX_SESSION_BYTES) return;
    sessionBlobs.set(key, blob);
    sessionBytes += blob.size;
    while (sessionBytes > MAX_SESSION_BYTES || sessionBlobs.size > MAX_SESSION_ENTRIES) {
        const oldest = sessionBlobs.entries().next().value;
        if (!oldest) break;
        sessionBlobs.delete(oldest[0]);
        sessionBytes -= oldest[1].size;
    }
}

function withDownloadSlot<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
        downloadQueue.push(() => {
            activeDownloads += 1;
            task()
                .then(resolve, reject)
                .finally(() => {
                    activeDownloads -= 1;
                    runDownloadQueue();
                });
        });
        runDownloadQueue();
    });
}

function runDownloadQueue() {
    while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length) downloadQueue.shift()?.();
}

/** 资源已由服务端保存；预热只留有界 Blob，不把无人持有的 objectURL 挂到整个会话。 */
export async function primeResourceBlobCache(storageKey: string, blob: Blob) {
    const target = cacheTarget(storageKey);
    if (!target) return "";
    rememberBlob(target.key, blob);
    void enqueuePersist(target, blob, cacheGeneration);
    return resourceFileUrl(target.resourceId);
}

export async function getCachedResourceBlob(storageKey: string) {
    const target = cacheTarget(storageKey);
    if (!target) return null;
    const generation = cacheGeneration;
    const blob = sessionBlob(target.key);
    if (blob) return blob;
    const cached = await blobStore.getItem<Blob>(target.key);
    if (!isCurrent(target, generation)) return null;
    if (cached) {
        rememberBlob(target.key, cached);
        touchCacheMetaSafely(target);
        return cached;
    }
    return getOrDownloadResourceBlob(storageKey, target);
}

async function getOrDownloadResourceBlob(storageKey: string, target: ResourceCacheMeta) {
    const blob = sessionBlob(target.key);
    if (blob) return blob;
    const pending = blobInFlight.get(target.key);
    if (pending) return pending;
    const generation = cacheGeneration;
    const task = withDownloadSlot(async () => {
        if (!isCurrent(target, generation)) return null;
        const downloaded = await getResourceBlob(storageKey);
        if (!downloaded || !isCurrent(target, generation)) return null;
        rememberBlob(target.key, downloaded);
        await enqueuePersist(target, downloaded, generation);
        return isCurrent(target, generation) ? downloaded : null;
    }).finally(() => {
        if (blobInFlight.get(target.key) === task) blobInFlight.delete(target.key);
    });
    blobInFlight.set(target.key, task);
    return task;
}

function enqueuePersist(target: ResourceCacheMeta, blob: Blob, generation: number) {
    // 缓存写入排队也会持有 Blob；拥塞时跳过可重建缓存，绝不影响服务端资源或本地待上传原件。
    if (pendingPersistBytes + blob.size > MAX_PENDING_PERSIST_BYTES) return Promise.resolve();
    pendingPersistBytes += blob.size;
    const task = persistQueue.then(() => (isCurrent(target, generation) ? persistBlob(target, blob) : undefined));
    const observed = task
        .catch((error) => {
            console.warn("媒体缓存持久化失败，资源仍可从服务端读取", { resourceId: target.resourceId, version: target.version, error });
        })
        .finally(() => {
            pendingPersistBytes -= blob.size;
        });
    persistQueue = observed;
    return observed;
}

async function persistBlob(target: ResourceCacheMeta, blob: Blob) {
    if (blob.size > (await cacheBudget())) return;
    await evictFor(blob.size, target.key);
    const write = async () => {
        await blobStore.setItem(target.key, blob);
        await metaStore.setItem(target.key, { ...target, size: blob.size, mimeType: blob.type || target.mimeType, lastAccessedAt: Date.now() });
    };
    try {
        await write();
        cacheStats = null;
    } catch (firstError) {
        await evictFor(blob.size, target.key, true);
        try {
            await write();
            cacheStats = null;
        } catch (retryError) {
            const cleanupResults = await Promise.allSettled([blobStore.removeItem(target.key), metaStore.removeItem(target.key)]);
            const cleanupError = cleanupResults.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
            if (cleanupError) console.error("媒体缓存写入失败后的清理也失败", { resourceId: target.resourceId, firstError, retryError, cleanupError });
            cacheStats = null;
            throw retryError;
        }
    }
}

function cacheTarget(storageKey: string): ResourceCacheMeta | null {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) return null;
    const userScope = getActiveUserScope();
    if (userScope === "guest") return null;
    // 资源 ID 不可变；缓存不必为每次读取再请求一遍元数据。
    return { key: `${userScope}:${resourceId}:file`, userScope, resourceId, version: "file", size: 0, mimeType: "application/octet-stream", lastAccessedAt: Date.now() };
}

function isCurrent(target: ResourceCacheMeta, generation: number) {
    return generation === cacheGeneration && target.userScope === getActiveUserScope();
}

async function touchCacheMeta(target: ResourceCacheMeta) {
    const now = Date.now();
    const lastTouchedAt = metaTouchedAt.get(target.key);
    if (lastTouchedAt && now - lastTouchedAt < TOUCH_INTERVAL_MS) return;
    metaTouchedAt.delete(target.key);
    metaTouchedAt.set(target.key, now);
    while (metaTouchedAt.size > MAX_CACHE_ENTRIES) metaTouchedAt.delete(metaTouchedAt.keys().next().value!);
    const current = await metaStore.getItem<ResourceCacheMeta>(target.key);
    if (!current || now - current.lastAccessedAt < TOUCH_INTERVAL_MS) return;
    await metaStore.setItem(target.key, { ...current, lastAccessedAt: now });
}

function touchCacheMetaSafely(target: ResourceCacheMeta) {
    void touchCacheMeta(target).catch((error) => {
        if (cacheMetaTouchWarnings.has(target.key)) return;
        if (cacheMetaTouchWarnings.size >= MAX_CACHE_ENTRIES) cacheMetaTouchWarnings.clear();
        cacheMetaTouchWarnings.add(target.key);
        console.warn("更新资源缓存访问时间失败", { storageKey: target.key, error });
    });
}

let cacheStats: { count: number; bytes: number } | null = null;
let cachedBudget: { value: number; at: number } | null = null;

async function evictFor(incomingBytes: number, protectedKey: string, aggressive = false) {
    const budget = aggressive ? Math.max(MIN_CACHE_BYTES, (await cacheBudget()) / 2) : await cacheBudget();
    if (!aggressive && cacheStats && cacheStats.count < MAX_CACHE_ENTRIES && cacheStats.bytes + incomingBytes <= budget) return;
    const metas: ResourceCacheMeta[] = [];
    await metaStore.iterate<ResourceCacheMeta, void>((value) => {
        if (value?.key) metas.push(value);
    });
    let total = metas.reduce((sum, item) => sum + Math.max(0, item.size || 0), 0);
    let count = metas.length;
    // 磁盘缓存与活跃 URL 分开管理：删除可重建的磁盘副本不会撤销页面仍借用的 URL。
    const candidates = metas.filter((item) => item.key !== protectedKey).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const previous = metas.find((item) => item.key === protectedKey);
    const additionalBytes = Math.max(0, incomingBytes - (previous?.size || 0));
    for (const candidate of candidates) {
        if (total + additionalBytes <= budget && count + (previous ? 0 : 1) <= MAX_CACHE_ENTRIES) break;
        await Promise.all([blobStore.removeItem(candidate.key), metaStore.removeItem(candidate.key)]);
        metaTouchedAt.delete(candidate.key);
        cacheMetaTouchWarnings.delete(candidate.key);
        total -= Math.max(0, candidate.size || 0);
        count -= 1;
    }
    cacheStats = { count, bytes: total };
}

async function cacheBudget() {
    if (cachedBudget && Date.now() - cachedBudget.at < BUDGET_REFRESH_MS) return cachedBudget.value;
    let value = FALLBACK_CACHE_BYTES;
    if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate().catch(() => null);
        if (estimate?.quota) value = Math.min(MAX_CACHE_BYTES, Math.max(MIN_CACHE_BYTES, Math.floor(estimate.quota * 0.2)));
    }
    cachedBudget = { value, at: Date.now() };
    return value;
}

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", (event) => {
        if (!event.persisted) clearResourceBlobCache();
    });
}
