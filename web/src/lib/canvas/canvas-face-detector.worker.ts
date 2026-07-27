/// <reference lib="webworker" />

import { FaceDetector } from "@mediapipe/tasks-vision";

import type { CanvasFaceBox } from "./canvas-emotion";

type DetectFaceRequest = {
    id: number;
    image: ImageBitmap;
};

type DetectFaceResponse = {
    id: number;
    faces?: CanvasFaceBox[];
    imageWidth?: number;
    imageHeight?: number;
    error?: string;
};

let detectorPromise: Promise<FaceDetector> | null = null;

const workerGlobal = self as typeof self & {
    importScripts: (...urls: string[]) => void;
    import?: (url: string) => Promise<unknown>;
};

// MediaPipe 会在模块 Worker 中从 importScripts 失败分支转向 self.import。
// 这里显式标记为运行时 URL，避免 Vite 将 public loader 当作源码模块转换。
workerGlobal.importScripts = () => { throw new TypeError("module worker uses dynamic import"); };
workerGlobal.import = async (url: string) => {
    const response = await fetch(url.replace(/\?import(?:&.*)?$/, ""));
    if (!response.ok) throw new Error(`MediaPipe loader 加载失败：${response.status}`);
    const blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }));
    try {
        return await import(/* @vite-ignore */ blobUrl);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
};

function getDetector() {
    if (!detectorPromise) {
        detectorPromise = FaceDetector.createFromOptions(
            {
                wasmLoaderPath: "/mediapipe/wasm/vision_wasm_module_internal.js",
                wasmBinaryPath: "/mediapipe/wasm/vision_wasm_module_internal.wasm",
            },
            {
                baseOptions: { modelAssetPath: "/canvas/models/blaze-face-full-range-sparse.tflite" },
                runningMode: "IMAGE",
                minDetectionConfidence: 0.25,
                minSuppressionThreshold: 0.3,
            },
        );
    }
    return detectorPromise;
}

self.onmessage = async (event: MessageEvent<DetectFaceRequest>) => {
    const { id, image } = event.data;
    const response: DetectFaceResponse = { id, imageWidth: image.width, imageHeight: image.height };
    try {
        const detector = await getDetector();
        response.faces = detector.detect(image).detections.flatMap((detection, index) => {
            const box = detection.boundingBox;
            if (!box) return [];
            return [{
                id: `face-${id}-${index}`,
                x: box.originX,
                y: box.originY,
                width: box.width,
                height: box.height,
                confidence: detection.categories[0]?.score,
                source: "detected" as const,
            }];
        });
    } catch (error) {
        response.error = error instanceof Error ? error.message : "人脸识别失败";
    } finally {
        image.close();
    }
    self.postMessage(response);
};

export {};
