import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, isBuiltinCanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 统一媒体节点最小短边，按 TapNow 的 100% 画布尺寸保持紧凑比例。 */
export const MEDIA_NODE_MIN_SIZE = { width: 250, height: 250 } as const;
/** 图片节点的尺寸合同。视频保留更大的媒体最小尺寸，图片按 dramaclaw 的紧凑预览策略适配。 */
export const IMAGE_NODE_MIN_SIZE = { width: 250, height: 250 } as const;
export const IMAGE_NODE_MAX_SIZE = { width: 444, height: 444 } as const;
export const VIDEO_NODE_MAX_SIZE = { width: 444, height: 444 } as const;
/** 新上传/插入的视频使用与 TapNow 100% 画布一致的紧凑展示盒。 */
export const VIDEO_NODE_UPLOAD_MAX_SIZE = VIDEO_NODE_MAX_SIZE;

export function fitNodeSize(width: number, height: number, maxWidth: number = 720, maxHeight: number = 520, minWidth: number = MEDIA_NODE_MIN_SIZE.width, minHeight: number = MEDIA_NODE_MIN_SIZE.height) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    // 媒体节点既要保留原始比例，也要给生成状态、操作按钮留下稳定的可读空间。
    const preferredScale = Math.min(1, maxWidth / w, maxHeight / h);
    const minimumScale = Math.max(minWidth / w, minHeight / h);
    // 最小边与紧凑上限可能因比例产生极小冲突（例如 16:9 的 250px 最小高会让
    // 宽度变成 444.44px）。上限优先，避免资源节点因为补最小尺寸再次超出紧凑盒。
    const maximumScale = Math.min(maxWidth / w, maxHeight / h);
    const scale = Math.min(Math.max(preferredScale, minimumScale), maximumScale);
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function fitImageNodeSize(width: number, height: number, maxWidth: number = IMAGE_NODE_MAX_SIZE.width, maxHeight: number = IMAGE_NODE_MAX_SIZE.height) {
    return fitNodeSize(width, height, maxWidth, maxHeight, IMAGE_NODE_MIN_SIZE.width, IMAGE_NODE_MIN_SIZE.height);
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number, minWidth: number = MEDIA_NODE_MIN_SIZE.width, minHeight: number = MEDIA_NODE_MIN_SIZE.height) {
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
    return fitNodeSize(candidateSize.width, candidateSize.height, baseWidth, baseHeight, minWidth, minHeight);
}

export function ensureMediaNodeMinimumSize(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return node;
    const title = node.title === "New Generation" ? "图片" : node.title === "Video" ? "视频" : node.title;
    const minSize = node.type === CanvasNodeType.Image ? IMAGE_NODE_MIN_SIZE : MEDIA_NODE_MIN_SIZE;
    let width = node.width;
    let height = node.height;
    const emptyStage = isBuiltinCanvasNodeType(node.type) ? NODE_DEFAULT_SIZE[node.type] : undefined;

    // 如果未完成节点（生成中/失败/空节点）指定了目标比例（如 3:4, 9:16），按目标比例保持占位框尺寸，不能强制变成 16:9 横屏。
    const targetBounds = node.type === CanvasNodeType.Image ? IMAGE_NODE_MAX_SIZE : VIDEO_NODE_MAX_SIZE;
    const targetSize = node.metadata?.size ? nodeSizeFromRatio(node.metadata.size, targetBounds.width, targetBounds.height, minSize.width, minSize.height) : null;
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
        ? nodeSizeFromRatio(node.metadata.size || "auto", node.type === CanvasNodeType.Image ? IMAGE_NODE_MAX_SIZE.width : VIDEO_NODE_MAX_SIZE.width, node.type === CanvasNodeType.Image ? IMAGE_NODE_MAX_SIZE.height : VIDEO_NODE_MAX_SIZE.height, minSize.width, minSize.height)
        : null;
    const naturalRatio = naturalWidth / Math.max(1, naturalHeight);
    const nodeRatio = node.width / Math.max(1, node.height);
    // 修复旧版图生图无条件继承参考节点尺寸造成的比例错误，不覆盖自由拉伸或锁定布局。
    if (requestedSize && naturalWidth > 0 && naturalHeight > 0 && !node.metadata?.freeResize && !node.metadata?.locked && Math.abs(naturalRatio - nodeRatio) > 0.01) {
        const alignedSize = fitNodeSize(naturalWidth, naturalHeight, requestedSize.width, requestedSize.height, minSize.width, minSize.height);
        width = alignedSize.width;
        height = alignedSize.height;
    }
    if (width < minSize.width || height < minSize.height) {
        const scale = Math.max(1, minSize.width / Math.max(1, width), minSize.height / Math.max(1, height));
        width *= scale;
        height *= scale;
    }
    // 旧版本媒体节点通常以更大的尺寸创建。仅压缩没有手动调整过的图片/视频，
    // 让已有画布也能迁移到紧凑尺寸，同时保留用户明确拉伸、锁定或指定比例的布局。
    const compactableMedia = !node.metadata?.freeResize && !node.metadata?.manualSize && !node.metadata?.locked && !node.metadata?.size;
    if (compactableMedia && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video)
        && (width > (node.type === CanvasNodeType.Image ? IMAGE_NODE_MAX_SIZE.width : VIDEO_NODE_MAX_SIZE.width)
            || height > (node.type === CanvasNodeType.Image ? IMAGE_NODE_MAX_SIZE.height : VIDEO_NODE_MAX_SIZE.height))) {
        const compact = node.type === CanvasNodeType.Image
            ? fitImageNodeSize(naturalWidth || width, naturalHeight || height)
            : fitNodeSize(naturalWidth || width, naturalHeight || height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
        width = compact.width;
        height = compact.height;
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
