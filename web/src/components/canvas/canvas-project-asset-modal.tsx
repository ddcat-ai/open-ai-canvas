import { useMemo } from "react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { externalAssetToInsertPayload, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { compileCharacterReferencePrompt } from "@/lib/canvas/canvas-character-reference";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { getRemoteAsset } from "@/services/api/user-data";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

const categoryLabels = (): Record<string, string> => ({
    all: t("canvas:all-assets-2"),
    character: t("canvas:characters"),
    environment: t("canvas:scenes"),
    wardrobe: t("canvas:costumes"),
    prop: t("canvas:props"),
    weapon: t("canvas:weapons"),
    style: t("canvas:styles"),
    other: t("canvas:other"),
});
type ProjectPickerItem = { id: string; category: string; folderId?: string; project?: ProjectAsset; character?: ProjectAsset; media?: Asset };

export function CanvasProjectAssetModal({
    open,
    detail,
    initialCategory = "all",
    initialFolderId = "all",
    onClose,
    onInsert,
    onInsertFolder,
}: {
    open: boolean;
    detail?: ProjectDetail;
    initialCategory?: string;
    initialFolderId?: string;
    onClose: () => void;
    onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void;
    onInsertFolder?: (folderId: string) => Promise<void> | void;
}) {
    const { t } = useTranslation("canvas");
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
        return mediaAssets.filter((asset) => asset.kind !== "model" && asset.kind !== "entity").map((media): ProjectPickerItem => ({ id: media.id, category: media.category || "other", media }));
    }, [detail?.assets, mediaAssets]);
    const localPickerItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            items.map((item) => {
                const character = item.character;
                const project = item.project;
                const media = item.media;
                const coverRepresentation =
                    character?.character?.representations.find((representation) => representation.role === "turnaround_sheet") ||
                    character?.character?.representations.find((representation) => representation.role === "primary") ||
                    character?.character?.representations.find((representation) => representation.role === "front");
                const remoteResourceId = resourceIdFromStorageKey(project?.storageKey);
                return {
                    id: item.id,
                    title: character?.title || project?.title || media?.title || t("canvas:unnamed-asset"),
                    category: item.category,
                    folderId: item.folderId,
                    kindLabel: character
                        ? t("canvas:character-card")
                        : (media?.kind || project?.mediaType) === "video"
                          ? t("canvas:videos-4")
                          : (media?.kind || project?.mediaType) === "audio"
                            ? t("canvas:audio-3")
                            : (media?.kind || project?.mediaType) === "text"
                              ? t("canvas:texts-2")
                              : t("canvas:images-3"),
                    asset: media,
                    imageUrl: coverRepresentation ? resourceFileUrl(coverRepresentation.resourceId) : project?.mediaType === "image" && remoteResourceId ? resourceFileUrl(remoteResourceId) : undefined,
                    imageStorageKey: coverRepresentation ? `resource:${coverRepresentation.resourceId}` : undefined,
                    imageFit: character ? "contain" : "cover",
                    description: character
                        ? `${character.character?.visualStatus === "ready" ? t("domain:look-ready") : t("domain:look-incomplete")} · ${character.character?.voiceStatus === "ready" ? t("domain:voice-bound") : t("canvas:no-voice-bound")}`
                        : project?.previewText,
                    searchText: [media?.tags.join(" ") || "", project?.previewText || ""].join(" "),
                };
            }),
        [items],
    );
    const pickerItems = useMemo<AssetLibraryPickerItem[]>(() => [...localPickerItems, ...externalAssetSources.items], [externalAssetSources.items, localPickerItems]);

    return (
        <AssetLibraryPickerModal
            open={open}
            items={pickerItems}
            categoryLabels={{ ...categoryLabels(), ...externalAssetSources.categoryLabels }}
            initialCategory={initialCategory}
            initialFolderId={initialFolderId}
            folders={externalAssetSources.folders}
            folderActionSource="local"
            title={t("canvas:project-assets-7")}
            confirmLabel={(count) => `${t("domain:insert-selected-assets")}${count ? `（${count}）` : ""}`}
            emptyTitle={t("domain:no-referenceable-assets-in-this-category")}
            emptyDescription={detail ? t("domain:finish-character-confirmation-or-asset-linking-under-project-characters") : t("domain:this-is-a-standalone-canvas-add-content-from-the-asset-library-first")}
            footerNote={externalAssetSources.error || t("domain:character-references-resolve-to-the-current-character-version-at-generat")}
            onFolderAction={
                onInsertFolder
                    ? async (folderId) => {
                          await onInsertFolder(folderId);
                          onClose();
                      }
                    : undefined
            }
            onClose={onClose}
            onConfirm={async (ids) => {
                const payloads = await Promise.all(
                    ids.map(async (id) => {
                        const external = externalAssetSources.items.find((item) => item.id === id)?.external;
                        if (external) return externalAssetToInsertPayload(external);
                        const item = items.find((candidate) => candidate.id === id);
                        if (!item) throw new Error(t("domain:the-selected-asset-no-longer-exists-please-choose-again"));
                        if (item.media || item.character || !item.project) return toInsertPayload(item);
                        const { asset } = await getRemoteAsset(item.project.id);
                        return toInsertPayload({ ...item, media: asset });
                    }),
                );
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
        throw new Error(t("domain:param-has-no-readable-content", { title: project.title }));
    }
    if (!asset) throw new Error(t("domain:project-asset-unavailable"));
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "video")
        return {
            kind: "video",
            url: projectAssetMediaUrl(asset.data.storageKey, asset.data.url),
            storageKey: asset.data.storageKey,
            title: asset.title,
            width: asset.data.width,
            height: asset.data.height,
            durationMs: asset.data.durationMs,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
            assetId: asset.id,
        };
    if (asset.kind === "audio")
        return {
            kind: "audio",
            url: projectAssetMediaUrl(asset.data.storageKey, asset.data.url),
            storageKey: asset.data.storageKey,
            title: asset.title,
            durationMs: asset.data.durationMs,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
            assetId: asset.id,
        };
    if (asset.kind === "image") return { kind: "image", dataUrl: projectAssetMediaUrl(asset.data.storageKey, asset.data.dataUrl), storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id };
    throw new Error(t("domain:this-project-asset-cannot-be-inserted-into-the-canvas-directly"));
}

function projectAssetMediaUrl(storageKey?: string, fallback = "") {
    const resourceId = resourceIdFromStorageKey(storageKey);
    return resourceId ? resourceFileUrl(resourceId) : fallback;
}

export function projectCharacterToInsertPayload(asset: ProjectAsset): InsertAssetPayload {
    if (!asset.character) throw new Error(t("domain:character-info-for-the-project-is-incomplete"));
    const card = asset.character;
    const definition = card.definition;
    const cover =
        card.representations.find((representation) => representation.role === "turnaround_sheet") ||
        card.representations.find((representation) => representation.role === "primary") ||
        card.representations.find((representation) => representation.role === "front");
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
        voiceProfile: card.voice
            ? {
                  name: card.voice.profile.name,
                  provider: card.voice.profile.provider,
                  language: card.voice.profile.language,
                  timbre: card.voice.profile.timbre,
              }
            : undefined,
        voiceInstructions: card.voice?.instructions,
    };
}
