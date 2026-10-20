import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, isBuiltinCanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const MEDIA_NODE_MIN_SIZE = { width: 420, height: 236 } as const;
export const VIDEO_NODE_MAX_SIZE = { width: 720, height: 520 } as const;
export const IMAGE_NODE_MAX_SIZE = { width: 720, height: 520 } as const;

/** 图片预览以最大边界为准；最短边不能反过来撑大竖图或长图。 */
export function fitImageNodeSize(width: number, height: number, maxWidth: number = IMAGE_NODE_MAX_SIZE.width, maxHeight: number = IMAGE_NODE_MAX_SIZE.height) {
    const w = Number.isFinite(width) && width > 0 ? width : NODE_DEFAULT_SIZE[CanvasNodeType.Image].width;
    const h = Number.isFinite(height) && height > 0 ? height : NODE_DEFAULT_SIZE[CanvasNodeType.Image].height;
    const limit = Math.min(maxWidth / w, maxHeight / h);
    const scale = Math.min(limit, Math.max(Math.min(1, limit), 320 / Math.max(w, h)));
    return { width: w * scale, height: h * scale };
}

/** 异步产物回填只更新媒体；用户在等待期间确定的显示尺寸仍然有效。 */
export function preserveImageNodeSize(node: CanvasNodeData | null | undefined, suggested: { width: number; height: number }) {
    return node && (node.metadata?.manualSize || node.metadata?.locked || node.metadata?.freeResize)
        ? { width: node.width, height: node.height } : suggested;
}

/** 素材使用有界预览框，极宽文字/极窄装饰不能把整组撑大；文件比例由 object-contain 保留。 */
export function fitImageMaterialNodeSize(width: number, height: number) {
    const fitted = fitNodeSize(width, height, 720, 520, 0, 0);
    return { width: Math.max(MEDIA_NODE_MIN_SIZE.width, fitted.width), height: Math.max(MEDIA_NODE_MIN_SIZE.height, fitted.height) };
}

export function fitNodeSize(width: number, height: number, maxWidth = 720, maxHeight = 520, minWidth: number = MEDIA_NODE_MIN_SIZE.width, minHeight: number = MEDIA_NODE_MIN_SIZE.height) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    // 媒体节点既要保留原始比例，也要给生成状态、操作按钮留下稳定的可读空间。
    const preferredScale = Math.min(1, maxWidth / w, maxHeight / h);
    const minimumScale = Math.max(minWidth / w, minHeight / h);
    const scale = Math.max(preferredScale, minimumScale);
    return { width: w * scale, height: h * scale };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number, image = false) {
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
    if (!image && (ratio < 0.25 || ratio > 4)) return { width: baseWidth, height: baseHeight };
    const candidateSize = ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
    return image ? fitImageNodeSize(candidateSize.width, candidateSize.height, baseWidth, baseHeight) : fitNodeSize(candidateSize.width, candidateSize.height, baseWidth, baseHeight);
}

export function imageNodeSizeFromRatio(size: string, baseWidth = 720, baseHeight = 520) {
    return nodeSizeFromRatio(size, baseWidth, baseHeight, true);
}

export function ensureMediaNodeMinimumSize(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return node;
    const title = node.title === "New Generation" ? "图片" : node.title === "Video" ? "视频" : node.title;
    if (node.type === CanvasNodeType.Image) {
        const metadata = node.metadata;
        // 手动尺寸、自由拉伸及锁定布局必须跨保存和重载保持不变。
        if (metadata?.manualSize || metadata?.freeResize || metadata?.locked) return title === node.title ? node : { ...node, title };
        const natural = metadata?.naturalWidth && metadata.naturalHeight
            ? (metadata.imageLayerMaterial ? fitImageMaterialNodeSize(metadata.naturalWidth, metadata.naturalHeight) : fitImageNodeSize(metadata.naturalWidth, metadata.naturalHeight))
            : null;
        const size = natural || (!metadata?.content && metadata?.size ? imageNodeSizeFromRatio(metadata.size) : null)
            || (node.width > 0 && node.height > 0 ? fitImageNodeSize(node.width, node.height) : NODE_DEFAULT_SIZE[CanvasNodeType.Image]);
        if (size.width === node.width && size.height === node.height && title === node.title) return node;
        return { ...node, title, width: size.width, height: size.height, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } };
    }
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
