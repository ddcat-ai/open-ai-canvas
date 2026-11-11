import { getActiveUserScope } from "@/lib/user-scope";
import { captureVideoPoster } from "@/lib/video-poster";
import { loadCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { resolveVideoMediaUrl } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type VideoPreview = NonNullable<CanvasNodeMetadata["videoPreview"]>;
type HydratedPoster = { poster: Blob; persisted: Promise<VideoPreview | null> };
type CanvasVideoHydrationEntry = {
    promise: Promise<HydratedPoster | null>;
    controller: AbortController;
    subscribers: number;
    settled: boolean;
};

const canvasVideoHydrationBySource = new Map<string, CanvasVideoHydrationEntry>();

export type HydratedCanvasVideoPreview = {
    /** 页面先用这个 object URL 渲染首帧，不等待 OSS 预览图上传。 */
    localUrl: string;
    /** 持久化上传在首帧已经可见后后台完成；失败不影响本地首帧。 */
    persisted: Promise<VideoPreview | null>;
};

export function hydrateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal) {
    const sourceKey = node.metadata?.storageKey || node.metadata?.content || "";
    if (!sourceKey) return Promise.resolve(null);
    const key = `${getActiveUserScope()}:${sourceKey}`;
    let entry = canvasVideoHydrationBySource.get(key);
    if (!entry) {
        const controller = new AbortController();
        entry = { promise: Promise.resolve(null), controller, subscribers: 0, settled: false };
        const request = generateCanvasVideoPreview(node, controller.signal).then(
            (result) => {
                entry!.settled = true;
                return result;
            },
            (error) => {
                entry!.settled = true;
                throw error;
            },
        );
        entry.promise = request;
        canvasVideoHydrationBySource.set(key, entry);
        void request.then(
            (result) => {
                if (result) return result.persisted.finally(() => clearCanvasVideoHydration(key, entry!));
                clearCanvasVideoHydration(key, entry!);
                return null;
            },
            () => {
                clearCanvasVideoHydration(key, entry!);
                return null;
            },
        );
    }
    entry.subscribers += 1;
    const shared = entry;
    return withAbort(shared.promise, signal)
        .then((result) => {
            if (!result) return null;
            const localUrl = URL.createObjectURL(result.poster);
            return { localUrl, persisted: result.persisted };
        })
        .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            return null;
        })
        .finally(() => releaseCanvasVideoHydration(key, shared));
}

function releaseCanvasVideoHydration(key: string, entry: CanvasVideoHydrationEntry) {
    entry.subscribers = Math.max(0, entry.subscribers - 1);
    if (entry.subscribers || entry.settled || canvasVideoHydrationBySource.get(key) !== entry) return;
    entry.controller.abort();
    canvasVideoHydrationBySource.delete(key);
}

function clearCanvasVideoHydration(key: string, entry: CanvasVideoHydrationEntry) {
    if (canvasVideoHydrationBySource.get(key) === entry) canvasVideoHydrationBySource.delete(key);
}

async function generateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal): Promise<HydratedPoster | null> {
    await waitForBrowserIdle(signal);
    throwIfAborted(signal);
    const storageKey = node.metadata?.storageKey;
    const lease = storageKey ? await loadCachedResourceObjectUrl(storageKey).catch(() => null) : null;
    let captured: Awaited<ReturnType<typeof captureVideoPoster>>;
    try {
        throwIfAborted(signal);
        const source = lease?.url || (await resolveVideoMediaUrl(node.metadata?.storageKey, node.metadata?.content || ""));
        if (!source) return null;
        captured = await captureVideoPoster(source, { signal, maxWidth: 400 });
    } finally {
        lease?.release();
    }
    throwIfAborted(signal);
    if (!captured.poster) return null;
    const persisted = uploadImage(captured.poster)
        .then((preview) => ({
            content: preview.url,
            storageKey: preview.storageKey,
            width: preview.width,
            height: preview.height,
            bytes: preview.bytes,
            mimeType: preview.mimeType,
        }))
        .catch((error) => {
            // 首帧已经在本地可见；预览图持久化失败只影响后续刷新，不阻断视频节点。
            console.warn("视频首帧持久化失败，保留本地首帧", { nodeId: node.id, error });
            return null;
        });
    return { poster: captured.poster, persisted };
}

function waitForBrowserIdle(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        let idleId: number | undefined;
        let timerId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const idleWindow = window as unknown as {
            requestIdleCallback?: Window["requestIdleCallback"];
            cancelIdleCallback?: Window["cancelIdleCallback"];
        };
        const cleanup = () => {
            signal?.removeEventListener("abort", handleAbort);
            if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
            if (timerId !== undefined) globalThis.clearTimeout(timerId);
        };
        const finish = () => {
            cleanup();
            resolve();
        };
        const handleAbort = () => {
            cleanup();
            reject(abortError());
        };
        signal?.addEventListener("abort", handleAbort, { once: true });
        if (idleWindow.requestIdleCallback) idleId = idleWindow.requestIdleCallback(finish, { timeout: 1_000 });
        else timerId = globalThis.setTimeout(finish, 250);
    });
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const handleAbort = () => {
            cleanup();
            reject(abortError());
        };
        const cleanup = () => signal.removeEventListener("abort", handleAbort);
        signal.addEventListener("abort", handleAbort, { once: true });
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
}

function abortError() {
    return new DOMException("Canvas video preview hydration aborted", "AbortError");
}
