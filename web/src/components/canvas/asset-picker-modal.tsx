import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

type InsertableAsset = Extract<Asset, { kind: "text" | "image" | "video" | "audio" }>;

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string; assetId?: string }
    | { kind: "image"; dataUrl: string; title: string; url?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number; hasAudio?: boolean; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "audio"; url: string; title: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "character"; title: string; assetId: string; versionId: string; prompt: string; aliases: string[]; definition: Record<string, unknown>; coverUrl?: string; visualStatus: string; voiceStatus: string; voiceName?: string; voiceProfile?: { name: string; provider: string; language: string; timbre: string }; voiceInstructions?: string };

type Props = {
    open: boolean;
    multiple?: boolean;
    onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void;
    onClose: () => void;
};

const categoryLabels: Record<string, string> = { all: "全部素材", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };

export function AssetPickerModal({ open, multiple = true, onInsert, onClose }: Props) {
    const assets = useAssetStore((state) => state.assets);
    const externalAssetSources = useExternalAssetSources(open);
    const insertableAssets = useMemo(() => assets.filter((asset): asset is InsertableAsset => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"), [assets]);
    const items = useMemo<AssetLibraryPickerItem[]>(() => [
        ...insertableAssets.map((asset) => ({
            id: asset.id,
            title: asset.title,
            category: asset.category || "other",
            kindLabel: asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "文本",
            asset,
            searchText: (asset.tags || []).join(" "),
        })),
        ...externalAssetSources.items,
    ], [externalAssetSources.items, insertableAssets]);

    return (
        <AssetLibraryPickerModal
            open={open}
            items={items}
            categoryLabels={{ ...categoryLabels, ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            footerNote={externalAssetSources.error || undefined}
            multiple={multiple}
            confirmLabel={(count) => `插入已选素材${count ? `（${count}）` : ""}`}
            emptyDescription="先在素材库中添加图片、视频、音频或文本。"
            onClose={onClose}
            onConfirm={async (ids) => {
                await onInsert(assetPickerItemsToInsertPayloads(ids, items));
                onClose();
            }}
        />
    );
}

export function assetPickerItemsToInsertPayloads(ids: string[], items: AssetLibraryPickerItem[]): InsertAssetPayload[] {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return ids.map((id) => {
        const pickerItem = itemsById.get(id);
        if (!pickerItem) throw new Error("所选素材已不存在，请重新选择");
        if (pickerItem.external) return externalAssetToInsertPayload(pickerItem.external);
        const asset = pickerItem.asset;
        if (!asset || (asset.kind !== "text" && asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")) {
            throw new Error(`“${pickerItem.title}”不是可插入画布的素材`);
        }
        return localAssetToInsertPayload(asset);
    });
}

function localAssetToInsertPayload(asset: InsertableAsset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, durationMs: asset.data.durationMs, hasAudio: asset.data.hasAudio, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
}

export function externalAssetToInsertPayload(reference: ExternalAssetPickerReference): InsertAssetPayload {
    const item = reference.item;
    const url = item.fileUrl || "";
    if (!url) throw new Error(`“${item.title}”暂时无法读取，请先在 Eagle 中确认文件可用`);
    const assetId = `external:${reference.sourceId}:${item.id}`;
    if (item.kind === "image") return { kind: "image", dataUrl: url, url, title: item.title || "素材图片", width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "video") return { kind: "video", url, title: item.title, width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "audio") return { kind: "audio", url, title: item.title, bytes: item.bytes, mimeType: item.mimeType, assetId };
    throw new Error(`“${item.title}”不是可插入画布的媒体文件`);
}
