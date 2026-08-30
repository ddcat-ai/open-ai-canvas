import { captureVideoPoster } from "@/lib/video-poster";
import { resolveMediaUrl } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type VideoPreview = NonNullable<CanvasNodeMetadata["videoPreview"]>;

const previewRequests = new Map<string, Promise<VideoPreview | null>>();

export function hydrateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal) {
    const sourceKey = node.metadata?.storageKey || node.metadata?.content || "";
    if (!sourceKey) return Promise.resolve(null);
    const requestKey = `${node.id}:${sourceKey}`;
    const existing = previewRequests.get(requestKey);
    if (existing) return existing;

    const request = generateCanvasVideoPreview(node, signal).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
            previewRequests.delete(requestKey);
            throw error;
        }
        return null;
    });
    previewRequests.set(requestKey, request);
    return request;
}

async function generateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal): Promise<VideoPreview | null> {
    await waitForBrowserIdle(signal);
    throwIfAborted(signal);
    const source = await resolveMediaUrl(node.metadata?.storageKey, node.metadata?.content || "");
    if (!source) return null;
    const captured = await captureVideoPoster(source, { signal, maxWidth: 400 });
    throwIfAborted(signal);
    if (!captured.poster) return null;
    const preview = await uploadImage(captured.poster);
    throwIfAborted(signal);
    return {
        content: preview.url,
        storageKey: preview.storageKey,
        width: preview.width,
        height: preview.height,
        bytes: preview.bytes,
        mimeType: preview.mimeType,
    };
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
