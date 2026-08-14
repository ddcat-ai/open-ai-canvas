import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { compileCharacterReferencePrompt } from "@/lib/canvas/canvas-character-reference";
import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const categoryLabels: Record<string, string> = { all: "全部资产", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };
type ProjectPickerItem = { id: string; category: string; character?: ProjectAsset; media?: Asset };

export function CanvasProjectAssetModal({ open, detail, initialCategory = "all", onClose, onInsert }: { open: boolean; detail?: ProjectDetail; initialCategory?: string; onClose: () => void; onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void }) {
    const mediaAssets = useAssetStore((state) => state.assets);
    const items = useMemo<ProjectPickerItem[]>(() => {
        const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
        const projectItems = (detail?.assets || []).flatMap((asset): ProjectPickerItem[] => {
            if (asset.category === "character" && asset.character) return [{ id: asset.id, category: "character", character: asset }];
            const media = mediaById.get(asset.id);
            return media && media.kind !== "model" && media.kind !== "entity" ? [{ id: asset.id, category: asset.category || media.category || "other", media }] : [];
        });
        if (projectItems.length) return projectItems;
        // 自由画布（未关联短剧项目）或项目资产为空/后端未返回时，回退到本地素材库，避免弹窗空白
        return mediaAssets
            .filter((asset) => asset.kind !== "model" && asset.kind !== "entity")
            .map((media): ProjectPickerItem => ({ id: media.id, category: media.category || "other", media }));
    }, [detail?.assets, mediaAssets]);
    const pickerItems = useMemo<AssetLibraryPickerItem[]>(() => items.map((item) => {
        const character = item.character;
        const media = item.media;
        const coverRepresentation = character?.character?.representations.find((representation) => representation.role === "turnaround_sheet") || character?.character?.representations.find((representation) => representation.role === "primary") || character?.character?.representations.find((representation) => representation.role === "front");
        return {
            id: item.id,
            title: character?.title || media?.title || "未命名资产",
            category: item.category,
            kindLabel: character ? "角色卡" : media?.kind === "video" ? "视频" : media?.kind === "audio" ? "音频" : media?.kind === "text" ? "文本" : "图片",
            asset: media,
            imageUrl: coverRepresentation ? resourceFileUrl(coverRepresentation.resourceId) : undefined,
            imageFit: character ? "contain" : "cover",
            description: character ? `${character.character?.visualStatus === "ready" ? "形象就绪" : "形象待完善"} · ${character.character?.voiceStatus === "ready" ? "声音已绑定" : "声音未绑定"}` : undefined,
            searchText: media?.tags.join(" "),
        };
    }), [items]);

    return (
        <AssetLibraryPickerModal
            open={open}
            items={pickerItems}
            categoryLabels={categoryLabels}
            initialCategory={initialCategory}
            title="项目资产"
            confirmLabel={(count) => `引入已选资产${count ? `（${count}）` : ""}`}
            emptyTitle="此分类没有可引用资产"
            emptyDescription={detail ? "先在项目角色与资产中完成角色确认或素材关联。" : "当前为自由画布，可先在素材库添加内容。"}
            footerNote="角色引用会在生成时解析当前角色版本"
            onClose={onClose}
            onConfirm={async (ids) => {
                const payloads = items.filter((item) => ids.includes(item.id)).map(toInsertPayload);
                if (!payloads.length) return;
                await onInsert(payloads);
                onClose();
            }}
        />
    );
}

function toInsertPayload(item: ProjectPickerItem): InsertAssetPayload {
    if (item.character?.character) {
        return projectCharacterToInsertPayload(item.character);
    }
    const asset = item.media;
    if (!asset) throw new Error("项目资产不可用");
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "image") return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id };
    throw new Error("当前项目资产不能直接插入画布");
}

export function projectCharacterToInsertPayload(asset: ProjectAsset): InsertAssetPayload {
    if (!asset.character) throw new Error("项目角色信息不完整");
    const card = asset.character;
    const definition = card.definition;
    const cover = card.representations.find((representation) => representation.role === "turnaround_sheet") || card.representations.find((representation) => representation.role === "primary") || card.representations.find((representation) => representation.role === "front");
    return {
        kind: "character",
        title: asset.title,
        assetId: asset.id,
        versionId: card.versionId,
        prompt: compileCharacterReferencePrompt(asset.title, definition),
        aliases: Array.isArray(definition.aliases) ? definition.aliases.filter((alias): alias is string => typeof alias === "string") : [],
        definition,
        coverUrl: cover ? resourceFileUrl(cover.resourceId) : undefined,
        visualStatus: card.visualStatus,
        voiceStatus: card.voiceStatus,
        voiceName: card.voice?.profile.name,
        voiceProfile: card.voice ? {
            name: card.voice.profile.name,
            provider: card.voice.profile.provider,
            language: card.voice.profile.language,
            timbre: card.voice.profile.timbre,
        } : undefined,
        voiceInstructions: card.voice?.instructions,
    };
}
