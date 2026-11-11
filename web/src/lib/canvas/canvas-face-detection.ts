import type { CanvasFaceBox } from "./canvas-emotion";

type DetectFaceResponse = {
    id: number;
    faces?: CanvasFaceBox[];
    imageWidth?: number;
    imageHeight?: number;
    error?: string;
};

type PendingRequest = {
    resolve: (result: CanvasFaceDetectionResult) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
};

export type CanvasFaceDetectionResult = {
    faces: CanvasFaceBox[];
    imageWidth: number;
    imageHeight: number;
};

const DETECTOR_IDLE_MS = 30_000;
let detectorWorker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let requestSequence = 0;
const pendingRequests = new Map<number, PendingRequest>();

function abortError() {
    return new DOMException("人脸识别已取消", "AbortError");
}

function stopDetectorWorker(worker: Worker) {
    if (detectorWorker !== worker) return;
    clearTimeout(idleTimer);
    idleTimer = undefined;
    detectorWorker = null;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
}

function scheduleIdleRelease(worker: Worker) {
    if (detectorWorker !== worker || pendingRequests.size) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        idleTimer = undefined;
        if (!pendingRequests.size) stopDetectorWorker(worker);
    }, DETECTOR_IDLE_MS);
}

export async function detectCanvasFaces(dataUrl: string, signal?: AbortSignal): Promise<CanvasFaceDetectionResult> {
    if (signal?.aborted) throw abortError();
    // 画布 <img> 可能缓存了不带 CORS 头的响应，跳过 HTTP 缓存重新读取。
    const response = await fetch(dataUrl, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("无法读取源图片，请重新上传后再试");
    const image = await createImageBitmap(await response.blob());
    // 解码不支持 AbortSignal；取消发生在解码期间时，位图仍由主线程负责释放。
    if (signal?.aborted) {
        image.close();
        throw abortError();
    }
    let worker: Worker;
    try {
        worker = getDetectorWorker();
    } catch (error) {
        image.close();
        throw error;
    }
    const id = ++requestSequence;
    return new Promise((resolve, reject) => {
        let transferred = false;
        const abort = () => {
            const request = pendingRequests.get(id);
            if (!request) return;
            pendingRequests.delete(id);
            request.cleanup();
            if (!transferred) image.close();
            reject(abortError());
            // 最后一个消费者取消后，无需等待模型下载/识别；有其他消费者时保留其 Worker。
            if (!pendingRequests.size) stopDetectorWorker(worker);
        };
        const cleanup = () => signal?.removeEventListener("abort", abort);
        pendingRequests.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        try {
            worker.postMessage({ id, image }, [image]);
            transferred = true;
        } catch (error) {
            pendingRequests.delete(id);
            cleanup();
            image.close();
            reject(error);
            scheduleIdleRelease(worker);
        }
    });
}

function getDetectorWorker() {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    if (detectorWorker) return detectorWorker;
    const worker = new Worker(new URL("./canvas-face-detector.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<DetectFaceResponse>) => {
        if (detectorWorker !== worker) return;
        const request = pendingRequests.get(event.data.id);
        if (!request) return;
        pendingRequests.delete(event.data.id);
        request.cleanup();
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve({ faces: event.data.faces || [], imageWidth: event.data.imageWidth || 0, imageHeight: event.data.imageHeight || 0 });
        scheduleIdleRelease(worker);
    };
    const fail = (message: string) => {
        if (detectorWorker !== worker) return;
        const error = new Error(message);
        pendingRequests.forEach((request) => {
            request.cleanup();
            request.reject(error);
        });
        pendingRequests.clear();
        stopDetectorWorker(worker);
    };
    worker.onerror = (event) => fail(event.message || "人脸识别服务初始化失败");
    worker.onmessageerror = () => fail("人脸识别结果读取失败");
    detectorWorker = worker;
    return worker;
}
