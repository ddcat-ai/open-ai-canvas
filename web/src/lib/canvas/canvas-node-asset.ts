import { getDataUrlByteSize } from "@/lib/image-utils";
import { canvasNodeVideoPreviewUrl } from "@/lib/canvas/canvas-media-preview";
import type { Asset, AssetCategory, NewAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId } from "@/types/canvas";

export type CanvasAssetSource = "canvas-generation" | "canvas-upload" | "canvas-manual";

type CanvasNodeAssetOptions = {
    canvasId: string;
    source: CanvasAssetSource;
    taskId?: string;
};

export function canvasNodeToAsset(node: CanvasNodeData, options: CanvasNodeAssetOptions): NewAsset | null {
    const content = node.metadata?.content?.trim() || "";
    const storageKey = node.metadata?.storageKey?.trim() || undefined;
    const isMedia = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;

    // 文本素材必须直接携带正文；媒体则允许只有持久 storageKey。后者常见于页面重载后：
    // blob/object URL 已失效，但资源定位符仍可从后端重新换取可访问地址，不能因此丢掉素材记录。
    if (node.type === CanvasNodeType.Text && !content) return null;
    if (isMedia && !content && !storageKey) return null;
    if (!isMedia && node.type !== CanvasNodeType.Text) return null;
    const title = node.metadata?.prompt?.slice(0, 24) || node.title || canvasAssetFallbackTitle(node.type);
    const metadata = {
        source: options.source,
        canvasId: options.canvasId,
        nodeId: node.id,
        taskId: options.taskId || node.metadata?.taskId,
        prompt: node.metadata?.prompt,
        resourceKey: storageKey,
    };
    const base = {
        title,
        coverUrl: node.type === CanvasNodeType.Image ? content : node.type === CanvasNodeType.Video ? canvasNodeVideoPreviewUrl(node) : "",
        tags: node.metadata?.assetTags || [],
        category: canvasNodeAssetCategory(node),
        status: "confirmed" as const,
        source: "Canvas",
        metadata,
    };

    if (node.type === CanvasNodeType.Text) {
        return { ...base, kind: "text", data: { content } };
    }
    if (node.type === CanvasNodeType.Image) {
        const dataUrl = storageKey ? "" : content;
        return {
            ...base,
            kind: "image",
            data: {
                dataUrl,
                storageKey,
                width: node.metadata?.naturalWidth || node.width,
                height: node.metadata?.naturalHeight || node.height,
                bytes: node.metadata?.bytes || getDataUrlByteSize(dataUrl),
                mimeType: concreteMimeType(node.metadata?.mimeType, "image/png", "image"),
            },
        };
    }
    if (node.type === CanvasNodeType.Video) {
        return {
            ...base,
            kind: "video",
            data: {
                url: content,
                storageKey,
                width: node.metadata?.naturalWidth || node.width,
                height: node.metadata?.naturalHeight || node.height,
                durationMs: node.metadata?.durationMs,
                hasAudio: node.metadata?.hasAudio,
                bytes: node.metadata?.bytes || 0,
                mimeType: concreteMimeType(node.metadata?.mimeType, "video/mp4", "video"),
            },
        };
    }
    if (node.type === CanvasNodeType.Audio) {
        return {
            ...base,
            kind: "audio",
            data: {
                url: content,
                storageKey,
                durationMs: node.metadata?.durationMs,
                bytes: node.metadata?.bytes || 0,
                mimeType: concreteMimeType(node.metadata?.mimeType, "audio/mpeg", "audio"),
            },
        };
    }
    return null;
}

function concreteMimeType(value: unknown, fallback: string, kind: string) {
    const mimeType = typeof value === "string" ? value.trim().toLowerCase() : "";
    return !mimeType || mimeType === kind || !mimeType.includes("/") ? fallback : mimeType;
}

export function findCanvasNodeAsset(assets: Asset[], node: CanvasNodeData, canvasId: string, taskId?: string) {
    const explicitId = node.metadata?.assetId;
    if (explicitId) {
        const explicit = assets.find((asset) => asset.id === explicitId);
        if (explicit && sameAssetResource(explicit, node)) return explicit;
    }
    const generationTaskId = taskId || node.metadata?.taskId;
    return assets.find((asset) => {
        if (generationTaskId && asset.metadata?.taskId === generationTaskId && asset.metadata?.nodeId === node.id) return true;
        if (asset.metadata?.nodeId !== node.id) return false;
        const sourceCanvasId = asset.metadata?.canvasId;
        if (sourceCanvasId !== canvasId && (sourceCanvasId || asset.metadata?.source !== "canvas-generation")) return false;
        const nodeResourceKey = node.metadata?.storageKey;
        const assetResourceKey = typeof asset.metadata?.resourceKey === "string" ? asset.metadata.resourceKey : assetStorageKey(asset);
        return !nodeResourceKey || !assetResourceKey || nodeResourceKey === assetResourceKey;
    });
}

function sameAssetResource(asset: Asset, node: CanvasNodeData) {
    const nodeResourceKey = node.metadata?.storageKey;
    const assetResourceKey = typeof asset.metadata?.resourceKey === "string" ? asset.metadata.resourceKey : assetStorageKey(asset);
    return !nodeResourceKey || !assetResourceKey || nodeResourceKey === assetResourceKey;
}

function assetStorageKey(asset: Asset) {
    if (asset.kind === "text" || asset.kind === "entity") return undefined;
    return asset.data.storageKey;
}

export function declaredCanvasNodeAssetCategory(node: CanvasNodeData): AssetCategory | undefined {
    if (node.metadata?.assetCategory) return node.metadata.assetCategory;
    if (node.metadata?.workflowKind === "character") return "character";
    if (node.metadata?.workflowKind === "scene") return "environment";
    if (node.metadata?.workflowKind === "styleboard") return "material";
    return undefined;
}

export function canvasNodeAssetCategory(node: CanvasNodeData): AssetCategory {
    const declared = declaredCanvasNodeAssetCategory(node);
    if (declared) return declared;
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) return "material";
    return "other";
}

function canvasAssetFallbackTitle(type: CanvasNodeTypeId) {
    if (type === CanvasNodeType.Image) return "画布图片";
    if (type === CanvasNodeType.Video) return "画布视频";
    if (type === CanvasNodeType.Audio) return "画布音频";
    return "画布文本";
}
