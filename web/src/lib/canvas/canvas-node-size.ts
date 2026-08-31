import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, isBuiltinCanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const MEDIA_NODE_MIN_SIZE = { width: 420, height: 236 } as const;
export const VIDEO_NODE_MAX_SIZE = { width: 720, height: 520 } as const;

export function fitNodeSize(width: number, height: number, maxWidth = 720, maxHeight = 520, minWidth = MEDIA_NODE_MIN_SIZE.width, minHeight = MEDIA_NODE_MIN_SIZE.height) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    // 媒体节点既要保留原始比例，也要给生成状态、操作按钮留下稳定的可读空间。
    const preferredScale = Math.min(1, maxWidth / w, maxHeight / h);
    const minimumScale = Math.max(minWidth / w, minHeight / h);
    const scale = Math.max(preferredScale, minimumScale);
    return { width: w * scale, height: h * scale };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const raw = String(size || "").trim();
    if (!raw || raw.toLowerCase() === "auto") return null;
    let width = 0;
    let height = 0;
    const match = raw.match(/^(\d+(?:\.\d+)?)(?:x|:)(\d+(?:\.\d+)?)/i);
    if (match) {
        width = Number(match[1]);
        height = Number(match[2]);
    } else if (raw.includes("竖") || raw.includes("portrait") || raw.includes("9:16")) {
        width = 9;
        height = 16;
    } else if (raw.includes("横") || raw.includes("landscape") || raw.includes("16:9")) {
        width = 16;
        height = 9;
    } else if (raw.includes("(1:1)") || raw.includes("1:1") || raw.includes("square")) {
        width = 1;
        height = 1;
    } else if (raw.includes("3:4")) {
        width = 3;
        height = 4;
    } else if (raw.includes("4:3")) {
        width = 4;
        height = 3;
    } else if (raw.includes("2:3")) {
        width = 2;
        height = 3;
    } else if (raw.includes("3:2")) {
        width = 3;
        height = 2;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    const candidateSize = ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
    return fitNodeSize(candidateSize.width, candidateSize.height, baseWidth, baseHeight);
}

export function ensureMediaNodeMinimumSize(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return node;
    const title = node.title === "New Generation" ? "图片" : node.title === "Video" ? "视频" : node.title;
    let width = node.width;
    let height = node.height;
    const emptyStage = isBuiltinCanvasNodeType(node.type) ? NODE_DEFAULT_SIZE[node.type] : undefined;

    // 如果未完成节点（生成中/失败/空节点）指定了目标比例（如 3:4, 9:16），按目标比例保持占位框尺寸，不能强制变成 16:9 横屏。
    const targetSize = node.metadata?.size ? nodeSizeFromRatio(node.metadata.size, emptyStage?.width || 720, emptyStage?.height || 405) : null;
    if (targetSize && !node.metadata?.content && !node.metadata?.freeResize && !node.metadata?.locked) {
        width = targetSize.width;
        height = targetSize.height;
    } else {
        const shouldPromoteEmptyStage = !node.metadata?.content
            && !node.metadata?.freeResize
            && !node.metadata?.locked
            && emptyStage !== undefined
            && (width <= 0 || height <= 0);
        if (shouldPromoteEmptyStage) {
            width = emptyStage.width;
            height = emptyStage.height;
        }
    }
    const naturalWidth = node.metadata?.naturalWidth || 0;
    const naturalHeight = node.metadata?.naturalHeight || 0;
    const requestedSize = node.type === CanvasNodeType.Image && node.metadata?.generationType === "edit"
        ? nodeSizeFromRatio(node.metadata.size || "auto", node.width, node.height)
        : null;
    const naturalRatio = naturalWidth / Math.max(1, naturalHeight);
    const nodeRatio = node.width / Math.max(1, node.height);
    // 修复旧版图生图无条件继承参考节点尺寸造成的比例错误，不覆盖自由拉伸或锁定布局。
    if (requestedSize && naturalWidth > 0 && naturalHeight > 0 && !node.metadata?.freeResize && !node.metadata?.locked && Math.abs(naturalRatio - nodeRatio) > 0.01) {
        const alignedSize = fitNodeSize(naturalWidth, naturalHeight, requestedSize.width, requestedSize.height);
        width = alignedSize.width;
        height = alignedSize.height;
    }
    if (width < MEDIA_NODE_MIN_SIZE.width || height < MEDIA_NODE_MIN_SIZE.height) {
        const scale = Math.max(1, MEDIA_NODE_MIN_SIZE.width / Math.max(1, width), MEDIA_NODE_MIN_SIZE.height / Math.max(1, height));
        width *= scale;
        height *= scale;
    }
    if (width === node.width && height === node.height && title === node.title) return node;
    return {
        ...node,
        title,
        position: {
            x: node.position.x + node.width / 2 - width / 2,
            y: node.position.y + node.height / 2 - height / 2,
        },
        width,
        height,
    };
}
