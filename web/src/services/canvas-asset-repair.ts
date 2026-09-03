import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { TimelineDirectMedia } from "@/types/timeline";

export type CanvasAssetRepairResult = {
    createdAssets: number;
    updatedProjects: number;
};

export function repairMissingCanvasAssets(): CanvasAssetRepairResult {
    const assetStore = useAssetStore.getState();
    const canvasStore = useCanvasStore.getState();
    const assetIdByStorageKey = new Map<string, string>();
    const storageKeyByAssetId = new Map<string, string>();
    const knownAssetIds = new Set<string>();
    for (const asset of assetStore.assets) {
        knownAssetIds.add(asset.id);
        const storageKey = assetStorageKey(asset);
        if (storageKey) {
            storageKeyByAssetId.set(asset.id, storageKey);
            if (!assetIdByStorageKey.has(storageKey)) assetIdByStorageKey.set(storageKey, asset.id);
        }
    }

    let createdAssets = 0;
    let updatedProjects = 0;
    for (const project of canvasStore.projects) {
        const repaired = repairProject(project, knownAssetIds, assetIdByStorageKey, storageKeyByAssetId, (node) => {
            const input = canvasNodeToAsset(node, { canvasId: project.id, source: "canvas-upload" });
            if (!input) return undefined;
            const assetId = useAssetStore.getState().addAsset(input);
            knownAssetIds.add(assetId);
            const storageKey = node.metadata?.storageKey;
            if (storageKey) {
                assetIdByStorageKey.set(storageKey, assetId);
                storageKeyByAssetId.set(assetId, storageKey);
            }
            createdAssets += 1;
            return assetId;
        });
        if (!repaired) continue;
        canvasStore.updateProject(project.id, repaired);
        updatedProjects += 1;
    }
    return { createdAssets, updatedProjects };
}

function repairProject(
    project: CanvasProject,
    knownAssetIds: Set<string>,
    assetIdByStorageKey: Map<string, string>,
    storageKeyByAssetId: Map<string, string>,
    createAsset: (node: CanvasNodeData) => string | undefined,
): Pick<CanvasProject, "nodes" | "timeline"> | null {
    let changed = false;
    const nodes = project.nodes.map((node) => {
        if (!isDurableMediaNode(node)) return node;
        const assetId = matchingAssetId(node.metadata?.assetId, node.metadata?.storageKey, knownAssetIds, assetIdByStorageKey, storageKeyByAssetId) || createAsset(node);
        if (!assetId || node.metadata?.assetId === assetId) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, assetId } };
    });
    const timeline = project.timeline
        ? {
              ...project.timeline,
              clips: project.timeline.clips.map((clip) => {
                  const media = clip.directMedia;
                  if (!media || media.kind === "text" || !mediaContent(media)) return clip;
                  const assetId = matchingAssetId(media.assetId, media.storageKey, knownAssetIds, assetIdByStorageKey, storageKeyByAssetId) || createAsset(timelineMediaNode(media));
                  if (!assetId || media.assetId === assetId) return clip;
                  changed = true;
                  return { ...clip, directMedia: { ...media, assetId } };
              }),
          }
        : project.timeline;
    return changed ? { nodes, timeline } : null;
}

function matchingAssetId(explicitId: string | undefined, storageKey: string | undefined, knownAssetIds: Set<string>, assetIdByStorageKey: Map<string, string>, storageKeyByAssetId: Map<string, string>) {
    if (explicitId && knownAssetIds.has(explicitId) && (!storageKey || storageKeyByAssetId.get(explicitId) === storageKey)) return explicitId;
    return storageKey ? assetIdByStorageKey.get(storageKey) : undefined;
}

function isDurableMediaNode(node: CanvasNodeData) {
    const isMedia = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
    return isMedia && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

function timelineMediaNode(media: TimelineDirectMedia): CanvasNodeData {
    const type = media.kind === "audio" ? CanvasNodeType.Audio : media.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
    return {
        id: media.id,
        type,
        title: media.title,
        position: { x: 0, y: 0 },
        width: media.width || 320,
        height: media.height || (type === CanvasNodeType.Audio ? 120 : 240),
        metadata: {
            content: mediaContent(media),
            storageKey: media.storageKey,
            naturalWidth: media.width,
            naturalHeight: media.height,
            durationMs: media.durationMs,
            bytes: media.bytes,
            mimeType: media.mimeType,
        },
    };
}

function mediaContent(media: TimelineDirectMedia) {
    return media.url || media.dataUrl || media.content || "";
}

function assetStorageKey(asset: Asset) {
    return asset.kind === "text" || asset.kind === "entity" ? undefined : asset.data.storageKey;
}
