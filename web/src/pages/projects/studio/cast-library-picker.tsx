import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import type { DramaCast } from "@/services/api/drama";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

import { CAST_KIND_LABEL } from "../drama-shared";

const CATEGORY_LABELS: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

/** 素材里能当设定参考图的：图片；角色设定还可以用角色卡的当前形象。 */
function pickableReason(asset: Asset, character: boolean) {
    if (asset.kind === "image") return undefined;
    if (asset.kind === "entity" && character) return asset.data.coverStorageKey ? undefined : "这个角色卡还没有形象图";
    return character ? "只能使用图片或角色卡" : "只能使用图片";
}

/**
 * 选中素材对应的服务端图片资源。已在服务端的素材直接复用同一资源；只存在本机的素材先上传，
 * 上传没有真正落到服务端时报错，不把本机缓存当成已保存。
 */
async function pickedImageResourceId(item: AssetLibraryPickerItem) {
    if (item.external) {
        const url = item.external.item.fileUrl;
        if (item.external.item.kind !== "image" || !url) throw new Error(`“${item.title}”不是可读取的图片`);
        return uploadedResourceId(await uploadImage(url));
    }
    const asset = item.asset;
    if (asset?.kind === "entity") {
        const id = resourceIdFromStorageKey(asset.data.coverStorageKey);
        if (!id) throw new Error(`角色卡“${item.title}”还没有已保存的形象图`);
        return id;
    }
    if (asset?.kind !== "image") throw new Error(`“${item.title}”不是图片`);
    const direct = resourceIdFromStorageKey(asset.data.storageKey);
    if (direct) return direct;
    const blob = asset.data.storageKey ? await getImageBlob(asset.data.storageKey) : null;
    const source = blob || asset.data.dataUrl || asset.coverUrl;
    if (!source) throw new Error(`“${item.title}”的图片文件已不存在`);
    return uploadedResourceId(await uploadImage(source));
}

function uploadedResourceId(uploaded: Awaited<ReturnType<typeof uploadImage>>) {
    const id = resourceIdFromStorageKey(uploaded.storageKey);
    if (uploaded.pendingRemoteUpload || !id) throw new Error(`图片没能上传到服务器${uploaded.remoteUploadError ? `：${uploaded.remoteUploadError}` : ""}，请稍后重试`);
    return id;
}

/** 从素材库挑一张图作为设定参考图；选中后与上传形象图一样直接替换并锁定。 */
export function CastLibraryPicker({ open, cast, onClose, onPick }: { open: boolean; cast: DramaCast; onClose: () => void; onPick: (resourceId: string) => Promise<unknown> }) {
    const assets = useAssetStore((state) => state.assets);
    const externalAssetSources = useExternalAssetSources(open);
    const character = cast.kind === "character";
    const items = useMemo<AssetLibraryPickerItem[]>(
        () => [
            ...assets
                .filter((asset) => asset.kind === "image" || (character && asset.kind === "entity"))
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: normalizeAssetCategory(asset.category),
                    archived: asset.status === "archived",
                    kindLabel: asset.kind === "entity" ? "角色卡" : "图片",
                    mediaKind: "image" as const,
                    asset,
                    searchText: (asset.tags || []).join(" "),
                    disabledReason: pickableReason(asset, character),
                })),
            ...externalAssetSources.items.map((item) => ({ ...item, disabledReason: item.external?.item.kind === "image" ? item.disabledReason : "只能使用图片" })),
        ],
        [assets, character, externalAssetSources.items],
    );
    return (
        <AssetLibraryPickerModal
            remoteLibrary
            acceptRemoteItems
            allowCharacters={character}
            remoteKind={character ? undefined : "image"}
            remoteItemDisabledReason={(asset) => pickableReason(asset, character)}
            mediaKinds={["image"]}
            multiple={false}
            open={open}
            items={items}
            categoryLabels={{ ...CATEGORY_LABELS, ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            title={`选择「${cast.name}」的${CAST_KIND_LABEL[cast.kind]}参考图`}
            eyebrow="短剧设定"
            confirmLabel={() => "用作参考图并锁定"}
            emptyDescription={character ? "先在素材库中添加图片或角色卡。" : "先在素材库中添加图片。"}
            footerNote={externalAssetSources.error || "选中的图片会替换当前参考图并锁定，之后不会被重新生成覆盖"}
            onClose={onClose}
            onConfirm={async (ids, pickedItems) => {
                const pool = new Map([...items, ...(pickedItems || [])].map((item) => [item.id, item]));
                const item = ids[0] ? pool.get(ids[0]) : undefined;
                if (!item) throw new Error("请选择一张图片");
                await onPick(await pickedImageResourceId(item));
                onClose();
            }}
        />
    );
}
