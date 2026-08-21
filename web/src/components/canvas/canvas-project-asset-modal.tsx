import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { externalAssetToInsertPayload, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { compileCharacterReferencePrompt } from "@/lib/canvas/canvas-character-reference";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { getRemoteAsset } from "@/services/api/user-data";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const categoryLabels: Record<string, string> = { all: "全部资产", character: "角色", environment: "场景", wardrobe: "服饰", prop: "道具", weapon: "武器", style: "画风", other: "其他" };
type ProjectPickerItem = { id: string; category: string; folderId?: string; project?: ProjectAsset; character?: ProjectAsset; media?: Asset };

export function CanvasProjectAssetModal({ open, detail, initialCategory = "all", initialFolderId = "all", onClose, onInsert, onInsertFolder }: { open: boolean; detail?: ProjectDetail; initialCategory?: string; initialFolderId?: string; onClose: () => void; onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void; onInsertFolder?: (folderId: string) => Promise<void> | void }) {
    const mediaAssets = useAssetStore((state) => state.assets);
    const externalAssetSources = useExternalAssetSources(open);
    const items = useMemo<ProjectPickerItem[]>(() => {
        const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
        const projectItems = (detail?.assets || []).flatMap((asset): ProjectPickerItem[] => {
            if (asset.category === "character" && asset.character) return [{ id: asset.id, category: "character", folderId: asset.folderId, project: asset, character: asset }];
            const media = mediaById.get(asset.id);
            return asset.mediaType === "model" || asset.mediaType === "entity" ? [] : [{ id: asset.id, category: asset.category || media?.category || "other", folderId: asset.folderId, project: asset, media }];
        });
        if (detail) return projectItems;
        // 自由画布未关联项目时回退到个人素材库。
        return mediaAssets
            .filter((asset) => asset.kind !== "model" && asset.kind !== "entity")
            .map((media): ProjectPickerItem => ({ id: media.id, category: media.category || "other", media }));
    }, [detail?.assets, mediaAssets]);
    const localPickerItems = useMemo<AssetLibraryPickerItem[]>(() => items.map((item) => {
        const character = item.character;
        const project = item.project;
        const media = item.media;
        const coverRepresentation = character?.character?.representations.find((representation) => representation.role === "turnaround_sheet") || character?.character?.representations.find((representation) => representation.role === "primary") || character?.character?.representations.find((representation) => representation.role === "front");
        const remoteResourceId = resourceIdFromStorageKey(project?.storageKey);
        return {
            id: item.id,
            title: character?.title || project?.title || media?.title || "未命名资产",
            category: item.category,
            folderId: item.folderId,
            kindLabel: character ? "角色卡" : (media?.kind || project?.mediaType) === "video" ? "视频" : (media?.kind || project?.mediaType) === "audio" ? "音频" : (media?.kind || project?.mediaType) === "text" ? "文本" : "图片",
            asset: media,
            imageUrl: coverRepresentation
                ? resourceFileUrl(coverRepresentation.resourceId)
                : project?.mediaType === "image" && remoteResourceId
                    ? resourceFileUrl(remoteResourceId)
                    : undefined,
            imageStorageKey: coverRepresentation ? `resource:${coverRepresentation.resourceId}` : undefined,
            imageFit: character ? "contain" : "cover",
            description: character ? `${character.character?.visualStatus === "ready" ? "形象就绪" : "形象待完善"} · ${character.character?.voiceStatus === "ready" ? "声音已绑定" : "声音未绑定"}` : project?.previewText,
            searchText: [media?.tags.join(" ") || "", project?.previewText || ""].join(" "),
        };
    }), [items]);
    const pickerItems = useMemo<AssetLibraryPickerItem[]>(() => [...localPickerItems, ...externalAssetSources.items], [externalAssetSources.items, localPickerItems]);

    return (
        <AssetLibraryPickerModal
            open={open}
            items={pickerItems}
            categoryLabels={{ ...categoryLabels, ...externalAssetSources.categoryLabels }}
            initialCategory={initialCategory}
            initialFolderId={initialFolderId}
            folders={externalAssetSources.folders}
            folderActionSource="local"
            title="项目资产"
            confirmLabel={(count) => `引入已选资产${count ? `（${count}）` : ""}`}
            emptyTitle="此分类没有可引用资产"
            emptyDescription={detail ? "先在项目角色与资产中完成角色确认或素材关联。" : "当前为自由画布，可先在素材库添加内容。"}
            footerNote={externalAssetSources.error || "角色引用会在生成时解析当前角色版本"}
            onFolderAction={onInsertFolder ? async (folderId) => { await onInsertFolder(folderId); onClose(); } : undefined}
            onClose={onClose}
            onConfirm={async (ids) => {
                const payloads = await Promise.all(ids.map(async (id) => {
                    const external = externalAssetSources.items.find((item) => item.id === id)?.external;
                    if (external) return externalAssetToInsertPayload(external);
                    const item = items.find((candidate) => candidate.id === id);
                    if (!item) throw new Error("所选资产已不存在，请重新选择");
                    if (item.media || item.character || !item.project) return toInsertPayload(item);
                    const { asset } = await getRemoteAsset(item.project.id);
                    return toInsertPayload({ ...item, media: asset });
                }));
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
    const project = item.project;
    if (!asset && project) {
        const resourceId = resourceIdFromStorageKey(project.storageKey);
        const remoteUrl = resourceId ? resourceFileUrl(resourceId) : "";
        if (project.mediaType === "text" && project.previewText) return { kind: "text", content: project.previewText, title: project.title, assetId: project.id };
        if (project.mediaType === "video" && remoteUrl) return { kind: "video", url: remoteUrl, storageKey: project.storageKey, title: project.title, assetId: project.id };
        if (project.mediaType === "audio" && remoteUrl) return { kind: "audio", url: remoteUrl, storageKey: project.storageKey, title: project.title, assetId: project.id };
        if (project.mediaType === "image" && remoteUrl) return { kind: "image", dataUrl: remoteUrl, storageKey: project.storageKey, title: project.title, assetId: project.id };
        throw new Error(`“${project.title}”缺少可读取的内容`);
    }
    if (!asset) throw new Error("项目资产不可用");
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "video") return { kind: "video", url: projectAssetMediaUrl(asset.data.storageKey, asset.data.url), storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "audio") return { kind: "audio", url: projectAssetMediaUrl(asset.data.storageKey, asset.data.url), storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "image") return { kind: "image", dataUrl: projectAssetMediaUrl(asset.data.storageKey, asset.data.dataUrl), storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id };
    throw new Error("当前项目资产不能直接插入画布");
}

function projectAssetMediaUrl(storageKey?: string, fallback = "") {
    const resourceId = resourceIdFromStorageKey(storageKey);
    return resourceId ? resourceFileUrl(resourceId) : fallback;
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
