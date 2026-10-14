import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import type { CreationMode } from "@/lib/creation-mode";
import type { CreationReferenceLimits } from "./creation-references";
import { creationAttachmentFromAsset, creationAttachmentFromAudioAsset, creationAttachmentFromExternalAsset, creationAttachmentFromVideoAsset, type CreationAttachment } from "./creation-assets";

export function creationLibraryDisabledReason(mode: CreationMode, kind: string | undefined, videoLimits?: CreationReferenceLimits) {
    if (kind !== "image" && kind !== "video" && kind !== "audio") return "此类型素材暂不支持作为创作参考";
    if (mode === "image") return kind === "image" ? undefined : "图片创作仅支持参考图";
    if (mode !== "video") return undefined;

    const maximum = kind === "image" ? videoLimits?.maxImages : kind === "video" ? videoLimits?.maxVideos : videoLimits?.maxAudios;
    if ((maximum || 0) > 0) return undefined;
    const label = kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
    return `当前视频模型不支持参考${label}`;
}

export function creationLibrarySelectionToAttachments(ids: string[], items: AssetLibraryPickerItem[], mode: CreationMode, videoLimits?: CreationReferenceLimits): CreationAttachment[] {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return ids.map((id) => {
        const item = itemsById.get(id);
        if (!item) throw new Error("所选素材已不存在，请重新选择");
        const kind = item.external?.item.kind || item.asset?.kind;
        const disabledReason = item.disabledReason || creationLibraryDisabledReason(mode, kind, videoLimits);
        if (disabledReason) throw new Error(`“${item.title}”：${disabledReason}`);
        if (item.external) return creationAttachmentFromExternalAsset(item.external);
        const asset = item.asset;
        if (asset?.kind === "image") return creationAttachmentFromAsset(asset);
        if (asset?.kind === "video") return creationAttachmentFromVideoAsset(asset);
        if (asset?.kind === "audio") return creationAttachmentFromAudioAsset(asset);
        throw new Error("所选素材已不存在，请重新选择");
    });
}
