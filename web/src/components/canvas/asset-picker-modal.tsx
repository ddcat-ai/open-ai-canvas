import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type InsertableAsset = Extract<Asset, { kind: "text" | "image" | "video" | "audio" }>;

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string; assetId?: string }
    | { kind: "image"; dataUrl: string; title: string; url?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "audio"; url: string; title: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; assetId?: string }
    | {
          kind: "character";
          title: string;
          assetId: string;
          versionId: string;
          prompt: string;
          aliases: string[];
          definition: Record<string, unknown>;
          coverUrl?: string;
          visualStatus: string;
          voiceStatus: string;
          voiceName?: string;
          voiceProfile?: { name: string; provider: string; language: string; timbre: string };
          voiceInstructions?: string;
      };

type Props = {
    open: boolean;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

const categoryLabels = (): Record<string, string> => ({
    all: t("canvas:all-assets"),
    character: t("canvas:characters"),
    environment: t("canvas:scenes"),
    wardrobe: t("canvas:costumes"),
    prop: t("canvas:props"),
    weapon: t("canvas:weapons"),
    style: t("canvas:styles"),
    other: t("canvas:other"),
});

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const { t } = useTranslation("canvas");
    const assets = useAssetStore((state) => state.assets);
    const externalAssetSources = useExternalAssetSources(open);
    const insertableAssets = useMemo(() => assets.filter((asset): asset is InsertableAsset => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"), [assets]);
    const items = useMemo<AssetLibraryPickerItem[]>(
        () => [
            ...insertableAssets.map((asset) => ({
                id: asset.id,
                title: asset.title,
                category: asset.category || "other",
                kindLabel: asset.kind === "image" ? t("canvas:images-3") : asset.kind === "video" ? t("canvas:videos-4") : asset.kind === "audio" ? t("canvas:audio-3") : t("canvas:texts-2"),
                asset,
                searchText: asset.tags.join(" "),
            })),
            ...externalAssetSources.items,
        ],
        [externalAssetSources.items, insertableAssets],
    );

    const insert = (id: string) => {
        const pickerItem = items.find((item) => item.id === id);
        if (pickerItem?.external) {
            onInsert(externalAssetToInsertPayload(pickerItem.external));
            onClose();
            return;
        }
        const asset = insertableAssets.find((item) => item.id === id);
        if (!asset) throw new Error(t("canvas:the-selected-assets-no-longer-exist-please-choose-again"));
        if (asset.kind === "text") onInsert({ kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id });
        else if (asset.kind === "audio") onInsert({ kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id });
        else if (asset.kind === "video")
            onInsert({
                kind: "video",
                url: asset.data.url,
                storageKey: asset.data.storageKey,
                title: asset.title,
                width: asset.data.width,
                height: asset.data.height,
                durationMs: asset.data.durationMs,
                bytes: asset.data.bytes,
                mimeType: asset.data.mimeType,
                assetId: asset.id,
            });
        else onInsert({ kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id });
        onClose();
    };

    return (
        <AssetLibraryPickerModal
            open={open}
            items={items}
            categoryLabels={{ ...categoryLabels(), ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            footerNote={externalAssetSources.error || undefined}
            multiple={false}
            confirmLabel={() => t("domain:insert-selected-assets")}
            emptyDescription={t("domain:add-images-videos-audio-or-text-to-the-library-first")}
            onClose={onClose}
            onConfirm={(ids) => insert(ids[0])}
        />
    );
}

export function externalAssetToInsertPayload(reference: ExternalAssetPickerReference): InsertAssetPayload {
    const { t } = useTranslation("canvas");
    const item = reference.item;
    const url = item.fileUrl || "";
    if (!url) throw new Error(t("domain:param-cannot-be-read-right-now-confirm-it-is-available-in-eagle-first", { title: item.title }));
    const assetId = `external:${reference.sourceId}:${item.id}`;
    if (item.kind === "image") return { kind: "image", dataUrl: url, url, title: item.title || t("canvas:asset-image"), width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "video") return { kind: "video", url, title: item.title, width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "audio") return { kind: "audio", url, title: item.title, bytes: item.bytes, mimeType: item.mimeType, assetId };
    throw new Error(t("domain:param-is-not-a-media-file-that-can-be-inserted-into-the-canvas", { title: item.title }));
}
