import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import type { AssetCategory } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

export type ShotAssetReferenceContext = {
    mentionReferences: CanvasResourceReference[];
    referenceImages: ReferenceImage[];
};

const assetCategories = new Set<AssetCategory>(["character", "environment", "wardrobe", "prop", "weapon", "style", "other"]);

export function buildShotAssetReferenceContext(detail: ProjectDetail, shotId: string): ShotAssetReferenceContext {
    const assetByVersionId = new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset]));
    const seenAssetIds = new Set<string>();
    const entries = (detail.shotReferences || []).flatMap((reference) => {
        if (reference.shotId !== shotId || reference.status !== "linked") return [];
        const asset = assetByVersionId.get(reference.assetVersionId);
        if (!asset || seenAssetIds.has(asset.id)) return [];
        const image = projectAssetReferenceImage(asset);
        if (!image) return [];
        seenAssetIds.add(asset.id);
        return [{ asset, image }];
    });

    return {
        mentionReferences: entries.map(({ asset, image }) => ({
            id: `project-asset:${asset.id}`,
            nodeId: "",
            assetId: asset.id,
            kind: asset.character ? "character" : "image",
            label: asset.title,
            title: asset.title,
            previewUrl: image.url,
            storageKey: image.storageKey,
            active: true,
            category: projectAssetCategory(asset.category),
        })),
        referenceImages: entries.map(({ image }) => image),
    };
}

export function resolveShotAssetMentionPrompt(prompt: string, context: ShotAssetReferenceContext) {
    const imageLabelByAssetId = new Map(context.mentionReferences.map((reference, index) => [reference.assetId, `图片${index + 1}`]));
    const unresolved = new Set<string>();
    const resolved = prompt.replace(/@\[asset:([^\]]+)\]/g, (token, assetId: string) => {
        const label = imageLabelByAssetId.get(assetId);
        if (!label) {
            unresolved.add(token);
            return token;
        }
        return label;
    });
    if (unresolved.size) throw new Error(`提示词中的 ${Array.from(unresolved).join("、")} 未绑定到当前镜头，请重新选择资产或删除引用`);
    return resolved;
}

function projectAssetReferenceImage(asset: ProjectAsset): ReferenceImage | undefined {
    const representation = asset.character
        ? asset.character.representations.find((item) => item.role === "turnaround_sheet")
            || asset.character.representations.find((item) => item.role === "primary")
            || asset.character.representations.find((item) => item.role === "front")
        : undefined;
    if (representation) {
        return {
            id: asset.id,
            name: asset.title,
            type: "image/*",
            dataUrl: "",
            url: resourceFileUrl(representation.resourceId),
            storageKey: resourceStorageKey(representation.resourceId),
        };
    }
    if (asset.mediaType !== "image" || !asset.storageKey) return undefined;
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return {
        id: asset.id,
        name: asset.title,
        type: "image/*",
        dataUrl: "",
        ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}),
        storageKey: asset.storageKey,
    };
}

function projectAssetCategory(value: string): AssetCategory {
    return assetCategories.has(value as AssetCategory) ? value as AssetCategory : "other";
}
