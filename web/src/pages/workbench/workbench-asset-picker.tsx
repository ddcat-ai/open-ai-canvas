import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const CATEGORY_LABELS: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

export type PickedWorkbenchAsset = { resourceId: string; kind: "image" | "video" | "audio"; name: string };

type MediaKind = PickedWorkbenchAsset["kind"];

function disabledReason(asset: Asset, accept: readonly MediaKind[]) {
    if ((asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") && accept.includes(asset.kind)) return undefined;
    return `这里只能使用${accept.map((kind) => (kind === "image" ? "图片" : kind === "video" ? "视频" : "音频")).join("、")}`;
}

/**
 * 选中素材对应的服务端资源。已同步的素材直接复用资源 ID；只在本机的图片先上传，
 * 没有真正落到服务端时报错，不把本机缓存当成可提交的参考素材。视频、音频必须已同步。
 */
async function pickedResource(item: AssetLibraryPickerItem): Promise<PickedWorkbenchAsset> {
    const asset = item.asset;
    if (!asset || (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")) throw new Error(`“${item.title}”不能作为参考素材`);
    const direct = resourceIdFromStorageKey(asset.data.storageKey);
    if (direct) return { resourceId: direct, kind: asset.kind, name: item.title };
    if (asset.kind !== "image") throw new Error(`“${item.title}”还没有同步到服务器，请稍后再试`);
    const blob = asset.data.storageKey ? await getImageBlob(asset.data.storageKey) : null;
    const source = blob || asset.data.dataUrl || asset.coverUrl;
    if (!source) throw new Error(`“${item.title}”的图片文件已不存在`);
    const uploaded = await uploadImage(source);
    const id = resourceIdFromStorageKey(uploaded.storageKey);
    if (uploaded.pendingRemoteUpload || !id) throw new Error(`“${item.title}”没能上传到服务器${uploaded.remoteUploadError ? `：${uploaded.remoteUploadError}` : ""}，请稍后重试`);
    return { resourceId: id, kind: "image", name: item.title };
}

export function WorkbenchAssetPicker({ open, accept, maxCount, slotName, onClose, onPick }: { open: boolean; accept: readonly MediaKind[]; maxCount: number; slotName?: string; onClose: () => void; onPick: (assets: PickedWorkbenchAsset[]) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const items = useMemo<AssetLibraryPickerItem[]>(
        () =>
            assets
                .filter((asset) => asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: normalizeAssetCategory(asset.category),
                    archived: asset.status === "archived",
                    kindLabel: asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片",
                    asset,
                    searchText: (asset.tags || []).join(" "),
                    disabledReason: disabledReason(asset, accept),
                })),
        [accept, assets],
    );
    const onlyImages = accept.length === 1 && accept[0] === "image";
    return (
        <AssetLibraryPickerModal
            remoteLibrary
            acceptRemoteItems
            remoteKind={onlyImages ? "image" : undefined}
            remoteItemDisabledReason={(asset) => disabledReason(asset, accept)}
            mediaKinds={[...accept]}
            multiple={maxCount > 1}
            open={open}
            items={items}
            categoryLabels={CATEGORY_LABELS}
            title={slotName ? `从素材库选择「${slotName}」` : "从素材库选择参考素材"}
            eyebrow="商品素材"
            confirmLabel={(count) => (count ? `使用 ${count} 个素材` : "使用所选素材")}
            emptyDescription="先在素材库中上传商品图，之后可以在这里直接选用。"
            footerNote={maxCount > 1 ? `最多再选 ${maxCount} 个，超出部分不会添加` : "选择一个素材"}
            onClose={onClose}
            onConfirm={async (ids, pickedItems) => {
                const pool = new Map([...items, ...(pickedItems || [])].map((item) => [item.id, item]));
                const chosen = ids
                    .map((id) => pool.get(id))
                    .filter((item): item is AssetLibraryPickerItem => Boolean(item))
                    .slice(0, Math.max(1, maxCount));
                if (!chosen.length) throw new Error("请选择素材");
                const resolved = await Promise.all(chosen.map(pickedResource));
                onPick(resolved);
                onClose();
            }}
        />
    );
}
