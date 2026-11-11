import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { projectCharacterToInsertPayload } from "@/components/canvas/canvas-project-asset-modal";
import { getCharacter } from "@/services/api/projects";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { translate } from "@/i18n";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

type InsertableAsset = Extract<Asset, { kind: "text" | "image" | "video" | "audio" }>;

export type InsertAssetPayload = { originalFileName?: string } & (
    | { kind: "text"; content: string; title: string; assetId?: string }
    | { kind: "image"; dataUrl: string; title: string; url?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number; hasAudio?: boolean; bytes?: number; mimeType?: string; assetId?: string }
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
      }
);

type Props = {
    open: boolean;
    multiple?: boolean;
    onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void;
    onClose: () => void;
};

export function AssetPickerModal({ open, multiple = true, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const externalAssetSources = useExternalAssetSources(open);
    const insertableAssets = useMemo(() => assets.filter((asset): asset is InsertableAsset => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"), [assets]);
    const items = useMemo<AssetLibraryPickerItem[]>(
        () => [
            ...insertableAssets.map((asset) => ({
                id: asset.id,
                title: asset.title,
                category: normalizeAssetCategory(asset.category),
                archived: asset.status === "archived",
                kindLabel: t(asset.kind === "image" ? "canvasA.media.image" : asset.kind === "video" ? "canvasA.media.video" : asset.kind === "audio" ? "canvasA.media.audio" : "canvasA.media.text"),
                mediaKind: asset.kind,
                asset,
                searchText: (asset.tags || []).join(" "),
            })),
            ...externalAssetSources.items,
        ],
        [externalAssetSources.items, insertableAssets, t],
    );

    const categoryLabels: Record<string, string> = { all: t("canvasA.assetPicker.allAssets"), ...ASSET_CATEGORY_LABELS, archived: t("canvasA.assetPicker.trash") };

    return (
        <AssetLibraryPickerModal
            remoteLibrary
            allowCharacters
            acceptRemoteItems
            open={open}
            mediaKinds={["image", "video", "audio", "text"]}
            items={items}
            categoryLabels={{ ...categoryLabels, ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            footerNote={externalAssetSources.error || undefined}
            multiple={multiple}
            confirmLabel={(count) => (count ? t("canvasA.assetPicker.insertSelectedCount", { count }) : t("canvasA.assetPicker.insertSelected"))}
            emptyDescription={t("canvasA.assetPicker.emptyDescription")}
            onClose={onClose}
            onConfirm={async (ids, pickedItems) => {
                await onInsert(await assetPickerSelectionToInsertPayloads(ids, pickedItems || items));
                onClose();
            }}
        />
    );
}

/** 选择结果转画布插入：角色卡需要读一次当前版本（形象、声音、设定），其它素材同步转换。 */
export async function assetPickerSelectionToInsertPayloads(ids: string[], items: AssetLibraryPickerItem[]): Promise<InsertAssetPayload[]> {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return Promise.all(
        ids.map(async (id) => {
            const item = itemsById.get(id);
            if (item?.asset?.kind === "entity") {
                const detail = await getCharacter(item.asset.id);
                return projectCharacterToInsertPayload({ ...detail.asset, character: detail.character });
            }
            return assetPickerItemsToInsertPayloads([id], items)[0];
        }),
    );
}

export function assetPickerItemsToInsertPayloads(ids: string[], items: AssetLibraryPickerItem[]): InsertAssetPayload[] {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return ids.map((id) => {
        const pickerItem = itemsById.get(id);
        if (!pickerItem) throw new Error(translate("canvasA.assetPicker.missing"));
        if (pickerItem.external) return externalAssetToInsertPayload(pickerItem.external);
        const asset = pickerItem.asset;
        if (!asset || (asset.kind !== "text" && asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")) {
            throw new Error(translate("canvasA.assetPicker.notInsertable", { title: pickerItem.title }));
        }
        return { ...localAssetToInsertPayload(asset), originalFileName: typeof asset.metadata?.originalFileName === "string" ? asset.metadata.originalFileName : undefined };
    });
}

function localAssetToInsertPayload(asset: InsertableAsset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "video")
        return {
            kind: "video",
            url: asset.data.url,
            storageKey: asset.data.storageKey,
            title: asset.title,
            width: asset.data.width,
            height: asset.data.height,
            durationMs: asset.data.durationMs,
            hasAudio: asset.data.hasAudio,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
            assetId: asset.id,
        };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
}

export function externalAssetToInsertPayload(reference: ExternalAssetPickerReference): InsertAssetPayload {
    const item = reference.item;
    const url = item.fileUrl || "";
    if (!url) throw new Error(translate("canvasA.assetPicker.externalUnreadable", { title: item.title }));
    const assetId = `external:${reference.sourceId}:${item.id}`;
    if (item.kind === "image") return { kind: "image", dataUrl: url, url, title: item.title || translate("canvasA.assetPicker.defaultImageTitle"), width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "video") return { kind: "video", url, title: item.title, width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "audio") return { kind: "audio", url, title: item.title, bytes: item.bytes, mimeType: item.mimeType, assetId };
    throw new Error(translate("canvasA.assetPicker.notInsertableMedia", { title: item.title }));
}
