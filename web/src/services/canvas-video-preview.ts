import { captureVideoPoster } from "@/lib/video-poster";
import { resolveMediaUrl } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type VideoPreview = NonNullable<CanvasNodeMetadata["videoPreview"]>;

export type HydratedCanvasVideoPreview = {
    /** 页面先用这个 object URL 渲染首帧，不等待 OSS 预览图上传。 */
    localUrl: string;
    /** 持久化上传在首帧已经可见后后台完成；失败不影响本地首帧。 */
    persisted: Promise<VideoPreview | null>;
};

export function hydrateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal) {
    const sourceKey = node.metadata?.storageKey || node.metadata?.content || "";
    if (!sourceKey) return Promise.resolve(null);
    return generateCanvasVideoPreview(node, signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return null;
    });
}

async function generateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal): Promise<HydratedCanvasVideoPreview | null> {
    await waitForBrowserIdle(signal);
    throwIfAborted(signal);
    const source = await resolveMediaUrl(node.metadata?.storageKey, node.metadata?.content || "");
    if (!source) return null;
    const captured = await captureVideoPoster(source, { signal, maxWidth: 400 });
    throwIfAborted(signal);
    if (!captured.poster) return null;
    const localUrl = URL.createObjectURL(captured.poster);
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
    return { localUrl, persisted };
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

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
}

function abortError() {
    return new DOMException("Canvas video preview hydration aborted", "AbortError");
}
