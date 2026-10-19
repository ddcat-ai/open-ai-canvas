import type { LibTVImportNode, LibTVImportWarning } from "@/services/api/libtv";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { imageGenerationChildPosition } from "./canvas-generation-layout";

const LIBTV_PROJECT_UUID_PATTERN = /^[a-f0-9]{32}$/i;
const LIBTV_RESOURCE_HOST = "libtv-res.liblib.art";
const LIBTV_PREVIEW_WIDTH = 960;
const LIBTV_VIDEO_PREVIEW_WIDTH = 400;

export function parseLibTVProjectUUID(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    let candidate = trimmed;
    try {
        const parsed = new URL(trimmed);
        candidate = parsed.searchParams.get("projectId") || parsed.searchParams.get("uuid") || parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    } catch {
        candidate = trimmed;
    }
    return LIBTV_PROJECT_UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : "";
}

export function formatLibTVBatchTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function summarizeLibTVImportWarnings(warnings: readonly LibTVImportWarning[]) {
    const groups = new Map<string, { message: string; count: number }>();
    for (const warning of warnings) {
        // 详情与导入确认都仍是预览，转换结果不代表已经写入画布。
        const message = warning.message.trim().replace("已导入第", "将保留第");
        if (!message) continue;
        const group = groups.get(message);
        if (group) group.count += 1;
        else groups.set(message, { message, count: 1 });
    }
    return [...groups.values()];
}

export function buildLibTVImagePreviewUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return rawUrl;
        if (!url.searchParams.has("x-oss-process")) {
            url.searchParams.set("x-oss-process", `image/resize,w_${LIBTV_PREVIEW_WIDTH}`);
        }
        return url.toString();
    } catch {
        return rawUrl;
    }
}

export function buildLibTVVideoPreviewUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return "";
        if (!url.searchParams.has("x-oss-process")) {
            url.searchParams.set("x-oss-process", `video/snapshot,t_0,f_jpg,w_${LIBTV_VIDEO_PREVIEW_WIDTH},m_fast,ar_auto`);
        }
        return url.toString();
    } catch {
        return "";
    }
}

/**
 * Restores the playable LibTV asset URL when a snapshot transform was
 * persisted as the node's content by an older importer.  The OSS transform
 * belongs only on previewContent; VideoPlayer must receive the original MP4.
 */
export function buildLibTVVideoSourceUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return rawUrl;
        url.searchParams.delete("x-oss-process");
        return url.toString();
    } catch {
        return rawUrl;
    }
}

const LIBTV_NODE_TYPES: Record<LibTVImportNode["type"], CanvasNodeType> = {
    image: CanvasNodeType.Image,
    video: CanvasNodeType.Video,
    audio: CanvasNodeType.Audio,
    text: CanvasNodeType.Text,
    frame: CanvasNodeType.Frame,
};

function libTVCanvasMetadata(node: LibTVImportNode): NonNullable<CanvasNodeData["metadata"]> {
    const metadata: NonNullable<CanvasNodeData["metadata"]> = {
        prompt: node.prompt,
        model: node.model,
        status: node.status || "idle",
        errorDetails: node.errorDetails,
        importSource: node.metadata,
    };

    if (node.type === "frame") {
        metadata.frame = { collapsed: false, expandedWidth: node.width, expandedHeight: node.height };
    } else if (node.type === "text") {
        metadata.content = node.content || "";
    } else if (node.type === "audio") {
        metadata.content = node.content;
        metadata.durationMs = node.durationMs;
        metadata.mimeType = node.mimeType;
    } else if (node.type === "video") {
        metadata.content = buildLibTVVideoSourceUrl(node.content);
        metadata.previewContent = buildLibTVVideoPreviewUrl(node.content) || undefined;
        metadata.naturalWidth = node.naturalWidth;
        metadata.naturalHeight = node.naturalHeight;
        metadata.durationMs = node.durationMs;
        metadata.mimeType = node.mimeType;
    } else {
        metadata.content = node.content;
        metadata.previewContent = buildLibTVImagePreviewUrl(node.content);
        metadata.naturalWidth = node.naturalWidth;
        metadata.naturalHeight = node.naturalHeight;
        metadata.mimeType = node.mimeType;
    }
    if (node.aspectRatio) metadata.size = node.aspectRatio;
    return metadata;
}

/**
 * 导入节点整体平移到当前视口中心。画布里画框子节点同样使用世界绝对坐标，
 * 所以每个节点只加一次同一偏移，不再叠加父级位置。
 */
export function buildLibTVCanvasNodes(nodes: LibTVImportNode[], viewport: ViewportTransform, viewportSize: { width: number; height: number }) {
    if (!nodes.length) return [];
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    const offsetX = (viewportSize.width / 2 - viewport.x) / viewport.k - (minX + maxX) / 2;
    const offsetY = (viewportSize.height / 2 - viewport.y) / viewport.k - (minY + maxY) / 2;

    return nodes.flatMap<CanvasNodeData>((node) => {
        const results = node.type === "image" || node.type === "video" || node.type === "audio" ? node.results || [] : [];
        const root: CanvasNodeData = {
            id: node.id,
            type: LIBTV_NODE_TYPES[node.type] ?? CanvasNodeType.Image,
            title: node.title,
            position: { x: node.x + offsetX, y: node.y + offsetY },
            width: node.width,
            height: node.height,
            parentId: node.parentId,
            metadata: libTVCanvasMetadata(results.length ? { ...node, ...results[0] } : node),
        };
        if (results.length < 2) return [root];

        // Upstream supports image stacks only; keep other media results individually visible.
        if (node.type !== "image") {
            return results.map((result, index) => ({
                ...root,
                id: index === 0 ? root.id : `libtv-result-${node.metadata.batchId}-${node.metadata.nodeKey}-${result.sourceIndex + 1}`,
                title: `${node.title} · 结果 ${result.sourceIndex + 1}`,
                position: index === 0 ? root.position : imageGenerationChildPosition(root.position, root.width, root, index - 1),
                metadata: libTVCanvasMetadata({ ...node, ...result, status: "success", errorDetails: undefined }),
            }));
        }

        // Keep the source node ID for references and edges; each result has its own persisted card.
        const cards = results.map<CanvasNodeData>((result, index) => ({
            ...root,
            id: `libtv-result-${node.metadata.batchId}-${node.metadata.nodeKey}-${result.sourceIndex + 1}`,
            title: `${node.title} · 结果 ${result.sourceIndex + 1}`,
            position: imageGenerationChildPosition(root.position, root.width, root, index),
            metadata: {
                ...libTVCanvasMetadata({ ...node, ...result, status: "success", errorDetails: undefined }),
                batchRootId: root.id,
            },
        }));
        root.metadata = {
            ...root.metadata,
            isBatchRoot: true,
            batchChildIds: cards.map((card) => card.id),
            primaryImageId: cards[0].id,
            imageBatchExpanded: false,
        };
        return [root, ...cards];
    });
}
