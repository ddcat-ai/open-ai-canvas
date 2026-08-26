import fs from "node:fs/promises";

import * as ort from "onnxruntime-node";

import type { DecodedPortraitImage } from "./image-metrics.js";
import { cosineSimilarity } from "./image-metrics.js";
import { portraitModelDirectory, portraitModelStatus } from "./model-store.js";

export type PortraitFace = {
    bbox: [number, number, number, number];
    detScore: number;
    keypoints: Array<[number, number]>;
    areaRatio: number;
    embedding?: Float32Array;
};

export type PortraitFaceAnalysis = {
    faces: PortraitFace[];
    selectedFace?: PortraitFace;
    embedding?: Float32Array;
};

export class PortraitFaceEngineError extends Error {
    constructor(readonly code: "portrait_model_missing" | "portrait_face_engine_failed", message: string) {
        super(message);
        this.name = "PortraitFaceEngineError";
    }
}

type FaceEngineOptions = {
    modelRoot: string;
    detectorSize?: number;
    threshold?: number;
};

type DetectorSession = { session: ort.InferenceSession; inputName: string };
type EmbeddingSession = { session: ort.InferenceSession; inputName: string };

export class PortraitFaceEngine {
    private detector?: Promise<DetectorSession>;
    private embedding?: Promise<EmbeddingSession>;
    private readonly detectorSize: number;
    private readonly threshold: number;

    constructor(private readonly options: FaceEngineOptions) {
        this.detectorSize = options.detectorSize ?? 640;
        // Keep low-confidence detections available for crop/search and let the
        // precheck mark them unreliable instead of discarding them before the
        // report can explain why the result is inconclusive.
        this.threshold = options.threshold ?? 0.4;
    }

    async status() {
        return portraitModelStatus(this.options.modelRoot);
    }

    async analyze(image: DecodedPortraitImage): Promise<PortraitFaceAnalysis> {
        const models = await this.status();
        if (!models.ready) throw new PortraitFaceEngineError("portrait_model_missing", "本地肖像 ONNX 模型尚未安装");
        try {
            const faces = await this.detect(image);
            for (const face of faces) face.embedding = await this.embed(image, face.keypoints);
            const selectedFace = [...faces].sort((left, right) => right.detScore - left.detScore || right.areaRatio - left.areaRatio)[0];
            return { faces, selectedFace, embedding: selectedFace?.embedding };
        } catch (error) {
            if (error instanceof PortraitFaceEngineError) throw error;
            throw new PortraitFaceEngineError("portrait_face_engine_failed", "本地人脸模型执行失败");
        }
    }

    async compare(left: DecodedPortraitImage, right: DecodedPortraitImage) {
        const [a, b] = await Promise.all([this.analyze(left), this.analyze(right)]);
        return { left: a, right: b, similarity: a.embedding && b.embedding ? cosineSimilarity(a.embedding, b.embedding) : undefined };
    }

    private async detect(image: DecodedPortraitImage) {
        const session = await this.getDetectorSession();
        const input = await detectorTensor(image, this.detectorSize);
        const output = await session.session.run({ [session.inputName]: input.tensor });
        const detections: PortraitFace[] = [];
        const outputs = session.session.outputNames.map((name) => output[name]);
        if (outputs.length < 9) throw new Error("portrait_detector_outputs_invalid");
        for (let level = 0; level < 3; level += 1) {
            const scores = numericTensorData(outputs[level]!);
            const boxes = numericTensorData(outputs[level + 3]!);
            const keypoints = numericTensorData(outputs[level + 6]!);
            const anchors = scores.length;
            const gridWidth = Math.round(Math.sqrt(anchors / 2));
            const gridHeight = gridWidth;
            if (gridWidth * gridHeight * 2 !== anchors || boxes.length !== anchors * 4 || keypoints.length !== anchors * 10) throw new Error("portrait_detector_shape_invalid");
            const stride = [8, 16, 32][level]!;
            for (let index = 0; index < anchors; index += 1) {
                const score = normalizedScore(Number(scores[index]));
                if (score < this.threshold) continue;
                const cell = Math.floor(index / 2);
                const x = cell % gridWidth;
                const y = Math.floor(cell / gridWidth);
                const centerX = x * stride;
                const centerY = y * stride;
                const offset = index * 4;
                const left = centerX - Number(boxes[offset]) * stride;
                const top = centerY - Number(boxes[offset + 1]) * stride;
                const right = centerX + Number(boxes[offset + 2]) * stride;
                const bottom = centerY + Number(boxes[offset + 3]) * stride;
                const pointOffset = index * 10;
                const points: Array<[number, number]> = [];
                for (let point = 0; point < 5; point += 1) points.push([centerX + Number(keypoints[pointOffset + point * 2]) * stride, centerY + Number(keypoints[pointOffset + point * 2 + 1]) * stride]);
                detections.push({
                    bbox: mapBoxToSource([left, top, right, bottom], image, input.scale, input.offsetX, input.offsetY),
                    detScore: score,
                    keypoints: points.map(([pointX, pointY]) => mapPointToSource(pointX, pointY, image, input.scale, input.offsetX, input.offsetY)),
                    areaRatio: 0,
                });
            }
        }
        const selected = nonMaximumSuppression(detections, 0.4);
        return selected.map((face) => ({ ...face, areaRatio: areaRatio(face.bbox, image.width, image.height) }));
    }

    private async embed(image: DecodedPortraitImage, keypoints: Array<[number, number]>) {
        const session = await this.getEmbeddingSession();
        const aligned = alignFace(image, keypoints);
        const data = new Float32Array(1 * 3 * 112 * 112);
        for (let index = 0; index < 112 * 112; index += 1) {
            const source = index * 3;
            data[index] = (aligned[source]! - 127.5) / 127.5;
            data[112 * 112 + index] = (aligned[source + 1]! - 127.5) / 127.5;
            data[2 * 112 * 112 + index] = (aligned[source + 2]! - 127.5) / 127.5;
        }
        const output = await session.session.run({ [session.inputName]: new ort.Tensor("float32", data, [1, 3, 112, 112]) });
        const embedding = new Float32Array(numericTensorData(output[session.session.outputNames[0]!]));
        let norm = 0;
        for (const value of embedding) norm += value * value;
        norm = Math.sqrt(norm);
        if (!norm) return embedding;
        for (let index = 0; index < embedding.length; index += 1) embedding[index] = embedding[index]! / norm;
        return embedding;
    }

    private getDetectorSession() {
        this.detector ??= this.loadDetector();
        return this.detector;
    }

    private getEmbeddingSession() {
        this.embedding ??= this.loadEmbedding();
        return this.embedding;
    }

    private async loadDetector() {
        const filePath = `${portraitModelDirectory(this.options.modelRoot)}/det_10g.onnx`;
        await fs.access(filePath);
        const session = await ort.InferenceSession.create(filePath, { executionProviders: ["cpu"] });
        return { session, inputName: session.inputNames[0]! };
    }

    private async loadEmbedding() {
        const filePath = `${portraitModelDirectory(this.options.modelRoot)}/w600k_r50.onnx`;
        await fs.access(filePath);
        const session = await ort.InferenceSession.create(filePath, { executionProviders: ["cpu"] });
        return { session, inputName: session.inputNames[0]! };
    }
}

function normalizedScore(value: number) {
    if (!Number.isFinite(value)) return 0;
    return value >= 0 && value <= 1 ? value : 1 / (1 + Math.exp(-value));
}

function numericTensorData(value: unknown) {
    if (!value || typeof value !== "object" || !("data" in value)) throw new Error("portrait_tensor_invalid");
    const data = (value as { data: unknown }).data;
    if (!data || typeof (data as ArrayLike<unknown>).length !== "number") throw new Error("portrait_tensor_invalid");
    return data as ArrayLike<number>;
}

async function detectorTensor(image: DecodedPortraitImage, size: number) {
    const source = await import("sharp");
    const resized = await source.default(image.rgb, { raw: { width: image.width, height: image.height, channels: 3 } })
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const scale = Math.min(size / image.width, size / image.height);
    const offsetX = (size - image.width * scale) / 2;
    const offsetY = (size - image.height * scale) / 2;
    const data = new Float32Array(1 * 3 * size * size);
    for (let index = 0; index < size * size; index += 1) {
        const sourceIndex = index * 3;
        data[index] = (resized.data[sourceIndex]! - 127.5) / 128;
        data[size * size + index] = (resized.data[sourceIndex + 1]! - 127.5) / 128;
        data[2 * size * size + index] = (resized.data[sourceIndex + 2]! - 127.5) / 128;
    }
    return { tensor: new ort.Tensor("float32", data, [1, 3, size, size]), scale, offsetX, offsetY };
}

function mapBoxToSource(box: [number, number, number, number], image: DecodedPortraitImage, scale: number, offsetX: number, offsetY: number): [number, number, number, number] {
    return [
        clamp((box[0] - offsetX) / scale, 0, image.width),
        clamp((box[1] - offsetY) / scale, 0, image.height),
        clamp((box[2] - offsetX) / scale, 0, image.width),
        clamp((box[3] - offsetY) / scale, 0, image.height),
    ];
}

function mapPointToSource(x: number, y: number, image: DecodedPortraitImage, scale: number, offsetX: number, offsetY: number): [number, number] {
    return [clamp((x - offsetX) / scale, 0, image.width), clamp((y - offsetY) / scale, 0, image.height)];
}

function nonMaximumSuppression(faces: PortraitFace[], threshold: number) {
    const sorted = [...faces].sort((left, right) => right.detScore - left.detScore);
    const kept: PortraitFace[] = [];
    while (sorted.length) {
        const current = sorted.shift()!;
        kept.push(current);
        for (let index = sorted.length - 1; index >= 0; index -= 1) if (intersectionOverUnion(current.bbox, sorted[index]!.bbox) > threshold) sorted.splice(index, 1);
    }
    return kept;
}

function intersectionOverUnion(a: PortraitFace["bbox"], b: PortraitFace["bbox"]) {
    const left = Math.max(a[0], b[0]);
    const top = Math.max(a[1], b[1]);
    const right = Math.min(a[2], b[2]);
    const bottom = Math.min(a[3], b[3]);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    return intersection / Math.max(1, areaA + areaB - intersection);
}

function areaRatio(box: PortraitFace["bbox"], width: number, height: number) {
    return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]) / Math.max(1, width * height);
}

function alignFace(image: DecodedPortraitImage, keypoints: Array<[number, number]>) {
    const target: Array<[number, number]> = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
    const transform = similarityTransform(keypoints, target);
    const aligned = new Uint8Array(112 * 112 * 3);
    for (let y = 0; y < 112; y += 1) {
        for (let x = 0; x < 112; x += 1) {
            const sourcePoint = inverseTransform(transform, x, y);
            const targetIndex = (y * 112 + x) * 3;
            sampleRgb(image, sourcePoint[0], sourcePoint[1], aligned, targetIndex);
        }
    }
    return aligned;
}

function similarityTransform(source: Array<[number, number]>, target: Array<[number, number]>) {
    const sourceMean = meanPoint(source);
    const targetMean = meanPoint(target);
    let alpha = 0;
    let beta = 0;
    let denominator = 0;
    for (let index = 0; index < source.length; index += 1) {
        const sx = source[index]![0] - sourceMean[0];
        const sy = source[index]![1] - sourceMean[1];
        const tx = target[index]![0] - targetMean[0];
        const ty = target[index]![1] - targetMean[1];
        alpha += sx * tx + sy * ty;
        beta += sx * ty - sy * tx;
        denominator += sx * sx + sy * sy;
    }
    alpha /= denominator || 1;
    beta /= denominator || 1;
    return {
        alpha,
        beta,
        tx: targetMean[0] - alpha * sourceMean[0] + beta * sourceMean[1],
        ty: targetMean[1] - beta * sourceMean[0] - alpha * sourceMean[1],
    };
}

function inverseTransform(transform: { alpha: number; beta: number; tx: number; ty: number }, x: number, y: number): [number, number] {
    const dx = x - transform.tx;
    const dy = y - transform.ty;
    const denominator = transform.alpha * transform.alpha + transform.beta * transform.beta || 1;
    return [
        (transform.alpha * dx + transform.beta * dy) / denominator,
        (-transform.beta * dx + transform.alpha * dy) / denominator,
    ];
}

function sampleRgb(image: DecodedPortraitImage, x: number, y: number, target: Uint8Array, offset: number) {
    const x0 = clamp(Math.floor(x), 0, image.width - 1);
    const y0 = clamp(Math.floor(y), 0, image.height - 1);
    const index = (y0 * image.width + x0) * 3;
    target[offset] = image.rgb[index]!;
    target[offset + 1] = image.rgb[index + 1]!;
    target[offset + 2] = image.rgb[index + 2]!;
}

function meanPoint(points: Array<[number, number]>): [number, number] {
    return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
