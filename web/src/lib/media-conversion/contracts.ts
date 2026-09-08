import type { CanvasNodeData } from "@/types/canvas";

export const MEDIA_CONVERSION_SCHEMA_VERSION = 1 as const;

export const MEDIA_CONVERSION_NODE_TYPE = "media-conversion" as const;

export type MediaConversionOperation = "grayscale" | "edge-canny" | "lineart" | "depth" | "pose" | "cutout";
export type MediaConversionStatus = "idle" | "processing" | "completed" | "stale" | "skipped" | "unavailable" | "error";
export type MediaConversionOutputKind = "image" | "video";

export type MediaConversionNodeState = {
    schemaVersion: typeof MEDIA_CONVERSION_SCHEMA_VERSION;
    operation: MediaConversionOperation;
    status: MediaConversionStatus;
    sourceNodeId?: string;
    sourceFingerprint?: string;
    outputKind?: MediaConversionOutputKind;
    resultStorageKey?: string;
    resultWidth?: number;
    resultHeight?: number;
    detectedPeople?: number;
    errorCode?: string;
    errorMessage?: string;
    startedAt?: string;
    updatedAt?: string;
};

export const MEDIA_CONVERSION_OPERATION_LABELS: Record<MediaConversionOperation, string> = {
    grayscale: "灰度图",
    "edge-canny": "Canny 边缘",
    lineart: "AI 线稿",
    depth: "深度图",
    pose: "姿态骨架",
    cutout: "透明抠图",
};

export const MEDIA_CONVERSION_OPERATION_DESCRIPTIONS: Record<MediaConversionOperation, string> = {
    grayscale: "普通图像算法，适合先检查明暗层次",
    "edge-canny": "普通图像算法，提取清晰轮廓",
    lineart: "本地 ControlNet Aux 线稿预处理，首次运行需要加载模型",
    depth: "本地 Depth Anything V2 Small，首次运行需要加载模型",
    pose: "本地 OpenPose 人体骨架预处理，未检测到人物时会跳过",
    cutout: "需要安装并验证本地抠图模型",
};

export function createDefaultMediaConversionState(): MediaConversionNodeState {
    return {
        schemaVersion: MEDIA_CONVERSION_SCHEMA_VERSION,
        operation: "edge-canny",
        status: "idle",
    };
}

export function mediaConversionSourceFingerprint(node: CanvasNodeData) {
    const metadata = node.metadata;
    const source = [
        node.id,
        metadata?.storageKey || "",
        compactSource(metadata?.content || metadata?.previewContent || ""),
        metadata?.mimeType || "",
        metadata?.bytes || "",
        metadata?.naturalWidth || "",
        metadata?.naturalHeight || "",
        metadata?.durationMs || "",
    ].join("|");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function mediaConversionOperationLabel(operation: MediaConversionOperation) {
    return MEDIA_CONVERSION_OPERATION_LABELS[operation];
}

export function mediaConversionOperationDescription(operation: MediaConversionOperation) {
    return MEDIA_CONVERSION_OPERATION_DESCRIPTIONS[operation];
}

export function isLocalImageOperation(operation: MediaConversionOperation) {
    return operation === "grayscale" || operation === "edge-canny";
}

function compactSource(value: string) {
    if (value.length <= 2048) return value;
    return `${value.slice(0, 1024)}|${value.slice(-1024)}|${value.length}`;
}
