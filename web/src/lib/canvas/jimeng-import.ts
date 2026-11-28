import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { JimengImportResult } from "@/services/api/jimeng";

const JIMENG_PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JIMENG_SHARE_HOST = "jimeng.jianying.com";
const JIMENG_SHARE_PATH_PATTERN = /^\/ai-tool\/ai-canvas\/[^/]+\/?$/;

export function parseJimengProjectId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    let candidate = trimmed;
    try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
        if (hostname !== JIMENG_SHARE_HOST || !JIMENG_SHARE_PATH_PATTERN.test(parsed.pathname)) return "";
        candidate = parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    } catch {
        candidate = trimmed;
    }
    return JIMENG_PROJECT_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : "";
}

/** 转存成功后可用于画布节点的影策资源信息。 */
export type StoredJimengMedia = {
    url: string;
    storageKey: string;
    width?: number;
    height?: number;
    durationMs?: number;
    mimeType?: string;
    bytes?: number;
};

/** 即梦的媒体地址是短期签名链接，导入前要逐个转存；这里收集需要转存的素材 ID。 */
export function collectJimengMediaResourceIds(result: JimengImportResult) {
    const resourceIds = new Set<string>();
    for (const node of result.nodes) {
        if (node.type === "frame" || !node.content || !node.metadata.mediaResourceId) continue;
        resourceIds.add(node.metadata.mediaResourceId);
    }
    return [...resourceIds];
}

/**
 * 把后端的即梦节点换成画布节点：分组映射为背板，子节点挂在背板下，
 * 已转存的素材改用影策自己的资源地址，其余保留即梦的临时链接。
 */
export function buildJimengCanvasNodes(result: JimengImportResult, viewport: ViewportTransform, viewportSize: { width: number; height: number }, stored: ReadonlyMap<string, StoredJimengMedia> = new Map()) {
    const xs = result.nodes.map((node) => node.x);
    const ys = result.nodes.map((node) => node.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...result.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...result.nodes.map((node) => node.y + node.height));
    const offsetX = (viewportSize.width / 2 - viewport.x) / viewport.k - (minX + maxX) / 2;
    const offsetY = (viewportSize.height / 2 - viewport.y) / viewport.k - (minY + maxY) / 2;

    return result.nodes.map<CanvasNodeData>((node) => {
        const parentId = node.parentId || undefined;
        const position = { x: node.x + offsetX, y: node.y + offsetY };
        if (node.type === "frame") {
            return {
                id: node.id,
                type: CanvasNodeType.Frame,
                title: node.title,
                position,
                width: node.width,
                height: node.height,
                parentId,
                metadata: {
                    frame: { collapsed: false, expandedWidth: node.width, expandedHeight: node.height },
                    importSource: node.metadata,
                },
            };
        }
        const media = node.metadata.mediaResourceId ? stored.get(node.metadata.mediaResourceId) : undefined;
        return {
            id: node.id,
            type: node.type === "video" ? CanvasNodeType.Video : CanvasNodeType.Image,
            title: node.title,
            position,
            width: node.width,
            height: node.height,
            parentId,
            metadata: {
                content: media ? media.url : node.content,
                storageKey: media?.storageKey,
                // 临时封面同样会过期；转存后交给影策自己的缩略图。
                previewContent: media ? undefined : node.previewContent || undefined,
                prompt: node.prompt,
                model: node.model,
                size: node.size,
                quality: node.quality,
                seconds: node.seconds,
                vquality: node.vquality,
                status: node.status || "idle",
                naturalWidth: media?.width || node.naturalWidth,
                naturalHeight: media?.height || node.naturalHeight,
                durationMs: media?.durationMs || node.durationMs,
                mimeType: media?.mimeType || node.mimeType,
                bytes: media?.bytes,
                importSource: node.metadata,
            },
        };
    });
}
