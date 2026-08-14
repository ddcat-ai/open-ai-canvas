import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

type InsertableAsset = Extract<Asset, { kind: "text" | "image" | "video" | "audio" }>;

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string; assetId?: string }
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string; assetId?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "audio"; url: string; title: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "character"; title: string; assetId: string; versionId: string; prompt: string; aliases: string[]; definition: Record<string, unknown>; coverUrl?: string; visualStatus: string; voiceStatus: string; voiceName?: string; voiceProfile?: { name: string; provider: string; language: string; timbre: string }; voiceInstructions?: string };

type Props = {
    open: boolean;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

const categoryLabels: Record<string, string> = { all: "全部素材", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const assets = useAssetStore((state) => state.assets);
    const insertableAssets = useMemo(() => assets.filter((asset): asset is InsertableAsset => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"), [assets]);
    const items = useMemo<AssetLibraryPickerItem[]>(() => insertableAssets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        category: asset.category || "other",
        kindLabel: asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "文本",
        asset,
        searchText: asset.tags.join(" "),
    })), [insertableAssets]);

    const insert = (id: string) => {
        const asset = insertableAssets.find((item) => item.id === id);
        if (!asset) throw new Error("所选素材已不存在，请重新选择");
        if (asset.kind === "text") onInsert({ kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id });
        else if (asset.kind === "audio") onInsert({ kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id });
        else if (asset.kind === "video") onInsert({ kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id });
        else onInsert({ kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id });
        onClose();
    };

    return (
        <AssetLibraryPickerModal
            open={open}
            items={items}
            categoryLabels={categoryLabels}
            multiple={false}
            confirmLabel={() => "插入所选素材"}
            emptyDescription="先在素材库中添加图片、视频、音频或文本。"
            onClose={onClose}
            onConfirm={(ids) => insert(ids[0])}
        />
    );
}
