import { useState, useEffect } from "react";

const CACHE_NAME = "canvas-inspiration-cache-v1";

/**
 * 内存 L1 缓存 (In-Memory LRU Map)
 * 映射: 原始 URL ➔ 本地已解析的 Blob URL 或 本地静态路径
 */
const memoryCache = new Map<string, string>();

/**
 * 是否支持浏览器原生 CacheStorage API
 */
const isCacheStorageSupported = typeof window !== "undefined" && "caches" in window;

/**
 * 用户端电脑本地分级缓存管理器 (InspirationCacheManager)
 * - L1: 内存秒开 (0ms)
 * - L2: 浏览器/桌面端硬盘持久化 (CacheStorage / 本地磁盘)
 * - L3: 优雅故障降级
 */
export const InspirationCache = {
    /**
     * 获取指定图片的本地缓存地址
     */
    async get(url: string): Promise<string> {
        if (!url) return "";

        // 1. 本地相对路径无需二次缓存，直接极速返回
        if (url.startsWith("/") || url.startsWith("./") || url.startsWith("blob:") || url.startsWith("data:")) {
            return url;
        }

        // 2. L1: 内存缓存命中检查
        if (memoryCache.has(url)) {
            return memoryCache.get(url)!;
        }

        // 3. L2: 本地磁盘持久缓存 (CacheStorage) 检查
        if (isCacheStorageSupported) {
            try {
                const cache = await caches.open(CACHE_NAME);
                const matched = await cache.match(url);
                if (matched) {
                    const blob = await matched.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    memoryCache.set(url, objectUrl);
                    return objectUrl;
                }

                // 4. 本地未命中：后台异步写入 CacheStorage，不阻塞前台当前渲染
                fetch(url, { mode: "cors" }).then(async (response) => {
                    if (response.ok) {
                        await cache.put(url, response.clone());
                        const blob = await response.blob();
                        const objectUrl = URL.createObjectURL(blob);
                        memoryCache.set(url, objectUrl);
                    }
                }).catch(() => {});
            } catch (err) {
                // 异常时直接降级
            }
        }

        // 5. 极速降级：直接返回 CDN 加速地址，由浏览器原生 HTTP 缓存管道即刻渲染
        return url;
    },

    /**
     * 同步检查当前内存中是否已有可用缓存
     */
    getMemoryCached(url: string): string | null {
        if (!url) return null;
        if (url.startsWith("/") || url.startsWith("./") || url.startsWith("blob:")) {
            return url;
        }
        return memoryCache.get(url) || null;
    },

    /**
     * 获取当前本地磁盘持久缓存统计指标
     */
    async getCacheStats(): Promise<{ count: number; estimatedSizeMB: number }> {
        if (!isCacheStorageSupported) return { count: memoryCache.size, estimatedSizeMB: 0 };
        try {
            const cache = await caches.open(CACHE_NAME);
            const requests = await cache.keys();
            return {
                count: requests.length,
                estimatedSizeMB: Number(((requests.length * 24) / 1024).toFixed(2)), // 单张 WebP 均值约 24KB
            };
        } catch {
            return { count: 0, estimatedSizeMB: 0 };
        }
    },

    /**
     * 清空本地磁盘持久缓存
     */
    async clearCache(): Promise<void> {
        memoryCache.clear();
        if (isCacheStorageSupported) {
            try {
                await caches.delete(CACHE_NAME);
            } catch {}
        }
    },

    /**
     * 后台流式批量预热拉取并落盘
     */
    async prewarm(
        urls: string[],
        onProgress?: (done: number, total: number) => void
    ): Promise<void> {
        let completed = 0;
        const total = urls.length;
        const concurrency = 6;
        let index = 0;

        const workers = Array.from({ length: concurrency }, async () => {
            while (index < urls.length) {
                const url = urls[index++];
                if (url) {
                    try {
                        await InspirationCache.get(url);
                    } catch {}
                }
                completed++;
                onProgress?.(completed, total);
            }
        });

        await Promise.all(workers);
    }
};

/**
 * React 自定义 Hook：智能响应用户端本地分级缓存
 */
export function useInspirationCachedImage(url: string | undefined) {
    const [cachedSrc, setCachedSrc] = useState<string>(() => {
        if (!url) return "";
        return InspirationCache.getMemoryCached(url) || url;
    });
    const [isFromCache, setIsFromCache] = useState<boolean>(() => {
        if (!url) return false;
        return InspirationCache.getMemoryCached(url) !== null;
    });
    const [isLoading, setIsLoading] = useState<boolean>(!isFromCache);

    useEffect(() => {
        if (!url) {
            setCachedSrc("");
            setIsLoading(false);
            return;
        }

        let isMounted = true;
        const memHit = InspirationCache.getMemoryCached(url);
        if (memHit) {
            setCachedSrc(memHit);
            setIsFromCache(true);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        InspirationCache.get(url).then((resolved) => {
            if (isMounted) {
                setCachedSrc(resolved);
                setIsFromCache(resolved.startsWith("blob:") || resolved.startsWith("/"));
                setIsLoading(false);
            }
        }).catch(() => {
            if (isMounted) {
                setCachedSrc(url);
                setIsLoading(false);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [url]);

    return { cachedSrc, isFromCache, isLoading };
}
