import localforage from "localforage";

import { getActiveUserScope } from "@/lib/user-scope";
import { getResourceBlob, resourceIdFromStorageKey } from "@/services/api/resources";

type ResourceCacheMeta = {
    key: string;
    userScope: string;
    resourceId: string;
    version: string;
    size: number;
    mimeType: string;
    lastAccessedAt: number;
};

const blobStore = localforage.createInstance({ name: "infinite-canvas", storeName: "resource_blobs" });
const metaStore = localforage.createInstance({ name: "infinite-canvas", storeName: "resource_blob_meta" });
const objectUrls = new Map<string, string>();
const sessionBlobs = new Map<string, Blob>();
const inFlight = new Map<string, Promise<string>>();
const scheduled = new Set<string>();
const cacheMetaTouchWarnings = new Set<string>();
const downloadQueue: Array<() => void> = [];
let activeDownloads = 0;
let persistQueue: Promise<void> = Promise.resolve();
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const FALLBACK_CACHE_BYTES = 512 * 1024 * 1024;
const MIN_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_DOWNLOADS = 16;
const recentlyTouched = new Set<string>();

export function peekCachedResourceObjectUrl(storageKey: string): string {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) return "";
    const userScope = getActiveUserScope();
    if (userScope === "guest") return "";
    const key = `${userScope}:${resourceId}:file`;
    return objectUrls.get(key) || "";
}

export async function getCachedResourceObjectUrl(storageKey: string) {
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    return readCachedObjectUrl(target);
}

export async function cacheResourceObjectUrl(storageKey: string) {
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    const cached = await readCachedObjectUrl(target);
    if (cached) return cached;
    const pending = inFlight.get(target.key);
    if (pending) return pending;

    const task = withDownloadSlot(() => downloadAndCacheResource(storageKey, target)).finally(() => inFlight.delete(target.key));
    inFlight.set(target.key, task);
    return task;
}

/**
 * 播放器先使用支持 Range 的资源 URL 起播；确认用户实际播放后，再延迟下载完整 Blob。
 * 这样不会让 IndexedDB 缓存阻塞首帧，同时后续打开可直接复用本地 Object URL。
 */
export function scheduleResourceBlobCache(storageKey: string, delayMs = 4_000) {
    if (!resourceIdFromStorageKey(storageKey) || scheduled.has(storageKey)) return;
    scheduled.add(storageKey);
    const run = () => {
        void cacheResourceObjectUrl(storageKey)
            .catch((error) => {
                // 这是播放后的后台缓存优化，不应让播放器失败；但下载/持久化异常必须可观测。
                console.warn("后台缓存资源 Blob 失败", { storageKey, error });
                return "";
            })
            .finally(() => scheduled.delete(storageKey));
    };
    if (typeof window === "undefined") {
        run();
        return;
    }
    window.setTimeout(run, Math.max(0, delayMs));
}

function withDownloadSlot<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
        downloadQueue.push(() => {
            activeDownloads += 1;
            task().then(resolve, reject).finally(() => {
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

export async function primeResourceBlobCache(storageKey: string, blob: Blob) {
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    sessionBlobs.set(target.key, blob);
    const url = objectUrl(target.key, blob);
    if (blob.size <= MAX_CACHE_BYTES) void enqueuePersist(target, blob);
    return url;
}

export async function getCachedResourceBlob(storageKey: string) {
    const target = await cacheTarget(storageKey);
    if (!target) return null;
    const cached = await blobStore.getItem<Blob>(target.key);
    if (cached) {
        touchCacheMetaSafely(target);
        return cached;
    }
    const sessionBlob = sessionBlobs.get(target.key);
    if (sessionBlob) return sessionBlob;
    const pending = inFlight.get(target.key);
    if (pending) {
        await pending;
        return sessionBlobs.get(target.key) || blobStore.getItem<Blob>(target.key);
    }
    await cacheResourceObjectUrl(storageKey);
    return sessionBlobs.get(target.key) || blobStore.getItem<Blob>(target.key);
}

async function downloadAndCacheResource(storageKey: string, target: ResourceCacheMeta) {
    const blob = await downloadResourceBlob(storageKey, target);
    if (!blob) return "";
    return objectUrl(target.key, blob);
}

async function downloadResourceBlob(storageKey: string, target: ResourceCacheMeta) {
    const blob = await getResourceBlob(storageKey);
    if (!blob) return null;
    sessionBlobs.set(target.key, blob);
    if (blob.size <= MAX_CACHE_BYTES) await enqueuePersist(target, blob);
    return blob;
}

function enqueuePersist(target: ResourceCacheMeta, blob: Blob) {
    const task = persistQueue.then(() => persistBlob(target, blob));
    // IndexedDB 缓存是读性能优化，不得反向判定服务端资源上传失败；但失败必须可观测，
    // 并把队列恢复为 fulfilled，避免一个坏条目永久阻断后续缓存写入。
    const observed = task.catch((error) => {
        console.warn("媒体缓存持久化失败，当前会话仍可继续读取", { resourceId: target.resourceId, version: target.version, error });
    });
    persistQueue = observed;
    return observed;
}

async function persistBlob(target: ResourceCacheMeta, blob: Blob) {
    // 不尝试写入超过当前缓存预算的单个媒体，避免触发浏览器配额异常和无效的全量淘汰。
    if (blob.size > (await cacheBudget())) return;
    await evictFor(blob.size, target.key);

    const write = async () => {
        await blobStore.setItem(target.key, blob);
        await metaStore.setItem(target.key, {
            ...target,
            size: blob.size,
            mimeType: blob.type || target.mimeType,
            lastAccessedAt: Date.now(),
        });
    };

    try {
        await write();
        return;
    } catch (firstError) {
        // 第一次失败通常意味着浏览器配额不足；激进淘汰后只允许再尝试一次，
        // 避免缓存层无限重试拖慢资源读取，也不把缓存失败误报成服务端资源失败。
        await evictFor(blob.size, target.key, true);
        try {
            await write();
            return;
        } catch (retryError) {
            const cleanupResults = await Promise.allSettled([blobStore.removeItem(target.key), metaStore.removeItem(target.key)]);
            const cleanupError = cleanupResults.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
            if (cleanupError) {
                console.error("媒体缓存写入失败后的清理也失败", {
                    resourceId: target.resourceId,
                    version: target.version,
                    firstError,
                    retryError,
                    cleanupError,
                });
            }
            throw retryError;
        }
    }
}

async function readCachedObjectUrl(target: ResourceCacheMeta) {
    const existing = objectUrls.get(target.key);
    if (existing) {
        touchCacheMetaSafely(target);
        return existing;
    }
    const blob = await blobStore.getItem<Blob>(target.key);
    if (!blob) return "";
    touchCacheMetaSafely(target);
    return objectUrl(target.key, blob);
}

async function cacheTarget(storageKey: string): Promise<ResourceCacheMeta | null> {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) return null;
    const userScope = getActiveUserScope();
    if (userScope === "guest") throw new Error("游客不能读取远程媒体缓存");
    // resource ID 是不可变资源的稳定标识，文件接口本身负责鉴权。
    // 缓存初始化不能先对每个资源读取一遍元数据，否则首屏会重新形成 N+1 请求。
    const version = "file";
    return {
        key: `${userScope}:${resourceId}:${version}`,
        userScope,
        resourceId,
        version,
        size: 0,
        mimeType: "application/octet-stream",
        lastAccessedAt: Date.now(),
    };
}

async function touchCacheMeta(target: ResourceCacheMeta) {
    if (recentlyTouched.has(target.key)) return;
    recentlyTouched.add(target.key);
    const current = await metaStore.getItem<ResourceCacheMeta>(target.key);
    if (!current || Date.now() - current.lastAccessedAt < TOUCH_INTERVAL_MS) return;
    await metaStore.setItem(target.key, { ...current, lastAccessedAt: Date.now() });
}


function touchCacheMetaSafely(target: ResourceCacheMeta) {
    void touchCacheMeta(target).catch((error) => {
        // 访问时间只服务于缓存淘汰，不影响资源读取；失败可降级，但不能无痕吞掉。
        if (cacheMetaTouchWarnings.has(target.key)) return;
        cacheMetaTouchWarnings.add(target.key);
        console.warn("更新资源缓存访问时间失败", { storageKey: target.key, error });
    });
}

async function evictFor(incomingBytes: number, protectedKey: string, aggressive = false) {
    const entryCount = await metaStore.length().catch(() => 0);
    const budget = aggressive ? Math.max(MIN_CACHE_BYTES, (await cacheBudget()) / 2) : await cacheBudget();
    // 只有当条目数接近上限或需要激进淘汰时，才进行全量迭代，避免写入每个文件都跑全表扫描
    if (!aggressive && entryCount < MAX_CACHE_ENTRIES - 10 && incomingBytes < budget / 10) return;

    const metas: ResourceCacheMeta[] = [];
    await metaStore.iterate<ResourceCacheMeta, void>((value) => {
        if (value?.key) metas.push(value);
    });
    let total = metas.reduce((sum, item) => sum + Math.max(0, item.size || 0), 0);
    let count = metas.length;
    // 当前页面正在使用的 Blob URL 不能在 LRU 清理时撤销，否则已渲染节点会立即变成失效资源。
    const candidates = metas.filter((item) => item.key !== protectedKey && !objectUrls.has(item.key) && !sessionBlobs.has(item.key)).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const candidate of candidates) {
        if (total + incomingBytes <= budget && count < MAX_CACHE_ENTRIES) break;
        await removeCacheEntry(candidate);
        total -= Math.max(0, candidate.size || 0);
        count -= 1;
    }
}

async function removeCacheEntry(meta: ResourceCacheMeta) {
    const url = objectUrls.get(meta.key);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(meta.key);
    sessionBlobs.delete(meta.key);
    await Promise.all([blobStore.removeItem(meta.key), metaStore.removeItem(meta.key)]);
}

async function cacheBudget() {
    if (!navigator.storage?.estimate) return FALLBACK_CACHE_BYTES;
    const estimate = await navigator.storage.estimate().catch(() => null);
    if (!estimate?.quota) return FALLBACK_CACHE_BYTES;
    return Math.min(MAX_CACHE_BYTES, Math.max(MIN_CACHE_BYTES, Math.floor(estimate.quota * 0.2)));
}

function objectUrl(key: string, blob: Blob) {
    const existing = objectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, url);
    return url;
}

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", (event) => {
        if (event.persisted) return;
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        objectUrls.clear();
        sessionBlobs.clear();
    });
}
