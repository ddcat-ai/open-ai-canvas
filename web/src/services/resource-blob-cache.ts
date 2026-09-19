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
const metaTouchedAt = new Map<string, number>();
const downloadQueue: Array<() => void> = [];
let activeDownloads = 0;
let persistQueue: Promise<void> = Promise.resolve();
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const FALLBACK_CACHE_BYTES = 512 * 1024 * 1024;
const MIN_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const BUDGET_REFRESH_MS = 5 * 60 * 1000;
// 现代浏览器对同源 HTTP/2 连接多路复用；上限给到 16 让大画布冷启动在 1~2 轮内完成并发拉取。
const MAX_CONCURRENT_DOWNLOADS = 16;

export async function getCachedResourceObjectUrl(storageKey: string) {
    const target = await cacheTarget(storageKey);
    if (!target) return "";
    return readCachedObjectUrl(target);
}

/** 同步读取本会话内存中的 Blob URL，命中时节点首帧即可上屏，不必等 IndexedDB 异步读取。 */
export function peekCachedResourceObjectUrl(storageKey: string) {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) return "";
    const userScope = getActiveUserScope();
    if (userScope === "guest") return "";
    return objectUrls.get(`${userScope}:${resourceId}:file`) || "";
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
        await pending.catch(() => "");
        const downloaded = sessionBlobs.get(target.key) || await blobStore.getItem<Blob>(target.key);
        if (downloaded) return downloaded;
        return loadAndPersistProxyFallback(storageKey);
    }
    await cacheResourceObjectUrl(storageKey).catch(() => "");
    const downloaded = sessionBlobs.get(target.key) || await blobStore.getItem<Blob>(target.key);
    if (downloaded) return downloaded;
    // Explicit byte consumers (exports/provider inputs) need a same-origin fallback
    // when the OSS bucket does not expose CORS. Display-only cache fills never do.
    return loadAndPersistProxyFallback(storageKey);
}

async function loadAndPersistProxyFallback(storageKey: string) {
    const blob = await getResourceBlob(storageKey, { allowProxyFallback: true });
    if (blob) await primeResourceBlobCache(storageKey, blob).catch(() => "");
    return blob;
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
        invalidateCacheStats();
        return;
    } catch (firstError) {
        // 第一次失败通常意味着浏览器配额不足；激进淘汰后只允许再尝试一次，
        // 避免缓存层无限重试拖慢资源读取，也不把缓存失败误报成服务端资源失败。
        await evictFor(blob.size, target.key, true);
        try {
            await write();
            invalidateCacheStats();
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
    const now = Date.now();
    // 同一会话内重复访问不落 IndexedDB：淘汰扫描在写入时才需要元数据，
    // 内存时间戳足够让高频读取跳过跨进程 I/O。
    const lastTouchedAt = metaTouchedAt.get(target.key);
    if (lastTouchedAt && now - lastTouchedAt < TOUCH_INTERVAL_MS) return;
    metaTouchedAt.set(target.key, now);
    const current = await metaStore.getItem<ResourceCacheMeta>(target.key);
    if (!current || now - current.lastAccessedAt < TOUCH_INTERVAL_MS) return;
    await metaStore.setItem(target.key, { ...current, lastAccessedAt: now });
}


function touchCacheMetaSafely(target: ResourceCacheMeta) {
    void touchCacheMeta(target).catch((error) => {
        // 访问时间只服务于缓存淘汰，不影响资源读取；失败可降级，但不能无痕吞掉。
        if (cacheMetaTouchWarnings.has(target.key)) return;
        cacheMetaTouchWarnings.add(target.key);
        console.warn("更新资源缓存访问时间失败", { storageKey: target.key, error });
    });
}

// 条目数/字节数与存储配额在内存中跟踪，常规写入只做 O(1) 检查，
// 只有接近预算才执行全量 LRU 扫描，避免每张图持久化都 iterate 全部元数据。
let cacheStats: { count: number; bytes: number } | null = null;
let cachedBudget: { value: number; at: number } | null = null;

async function evictFor(incomingBytes: number, protectedKey: string, aggressive = false) {
    const entryCount = await metaStore.length().catch(() => 0);
    const budget = aggressive ? Math.max(MIN_CACHE_BYTES, (await cacheBudget()) / 2) : await cacheBudget();
    // 常规写入只在统计可信或明显未接近阈值时跳过全表扫描；写入会使内存统计失效，
    // 因此不会用可能过时的字节数做永久放行。
    if (!aggressive) {
        if (cacheStats && cacheStats.count < MAX_CACHE_ENTRIES && cacheStats.bytes + incomingBytes <= budget) return;
        if (!cacheStats && entryCount < MAX_CACHE_ENTRIES - 10 && incomingBytes < budget / 10) return;
    }
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
    cacheStats = { count, bytes: total };
}

function invalidateCacheStats() {
    cacheStats = null;
}

async function removeCacheEntry(meta: ResourceCacheMeta) {
    const url = objectUrls.get(meta.key);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(meta.key);
    sessionBlobs.delete(meta.key);
    await Promise.all([blobStore.removeItem(meta.key), metaStore.removeItem(meta.key)]);
}

async function cacheBudget() {
    // 配额估计是跨进程调用且会话内基本稳定，短暂缓存避免每张图一次 IPC 往返。
    if (cachedBudget && Date.now() - cachedBudget.at < BUDGET_REFRESH_MS) return cachedBudget.value;
    let value = FALLBACK_CACHE_BYTES;
    if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate().catch(() => null);
        if (estimate?.quota) value = Math.min(MAX_CACHE_BYTES, Math.max(MIN_CACHE_BYTES, Math.floor(estimate.quota * 0.2)));
    }
    cachedBudget = { value, at: Date.now() };
    return value;
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
