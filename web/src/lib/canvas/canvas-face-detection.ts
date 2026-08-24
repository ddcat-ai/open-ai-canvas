import { t } from "@/i18n";
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

let detectorWorker: Worker | null = null;
let requestSequence = 0;
const pendingRequests = new Map<number, PendingRequest>();

export async function detectCanvasFaces(dataUrl: string, signal?: AbortSignal): Promise<CanvasFaceDetectionResult> {
    if (signal?.aborted) throw new DOMException(t("canvas:face-detection-was-cancelled-2"), "AbortError");
    const response = await fetch(dataUrl, { signal });
    if (!response.ok) throw new Error(t("canvas:unable-to-read-the-source-image-re-upload-and-try-again-2"));
    const image = await createImageBitmap(await response.blob());
    const worker = getDetectorWorker();
    const id = ++requestSequence;
    return new Promise((resolve, reject) => {
        const abort = () => {
            const request = pendingRequests.get(id);
            if (!request) return;
            pendingRequests.delete(id);
            request.cleanup();
            reject(new DOMException(t("canvas:face-detection-was-cancelled-2"), "AbortError"));
        };
        const cleanup = () => signal?.removeEventListener("abort", abort);
        pendingRequests.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", abort, { once: true });
        worker.postMessage({ id, image }, [image]);
    });
}

function getDetectorWorker() {
    if (detectorWorker) return detectorWorker;
    const worker = new Worker(new URL("./canvas-face-detector.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<DetectFaceResponse>) => {
        const request = pendingRequests.get(event.data.id);
        if (!request) return;
        pendingRequests.delete(event.data.id);
        request.cleanup();
        if (event.data.error) {
            request.reject(new Error(event.data.error));
            return;
        }
        request.resolve({
            faces: event.data.faces || [],
            imageWidth: event.data.imageWidth || 0,
            imageHeight: event.data.imageHeight || 0,
        });
    };
    worker.onerror = (event) => {
        const error = new Error(event.message || t("canvas:face-recognition-service-failed-to-initialize"));
        pendingRequests.forEach((request) => {
            request.cleanup();
            request.reject(error);
        });
        pendingRequests.clear();
        worker.terminate();
        detectorWorker = null;
    };
    detectorWorker = worker;
    return worker;
}
