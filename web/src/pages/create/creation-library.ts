import { translate } from "@/i18n";
import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import type { CreationMode } from "@/lib/creation-mode";
import type { CreationReferenceLimits } from "./creation-references";
import { creationAttachmentFromAsset, creationAttachmentFromAudioAsset, creationAttachmentFromExternalAsset, creationAttachmentFromVideoAsset, type CreationAttachment } from "./creation-assets";

export function creationLibraryDisabledReason(mode: CreationMode, kind: string | undefined, videoLimits?: CreationReferenceLimits) {
    if (kind !== "image" && kind !== "video" && kind !== "audio") return translate("create.library.unsupportedKind");
    if (mode === "image") return kind === "image" ? undefined : translate("create.library.imageOnly");
    if (mode !== "video") return undefined;

    const maximum = kind === "image" ? videoLimits?.maxImages : kind === "video" ? videoLimits?.maxVideos : videoLimits?.maxAudios;
    if ((maximum || 0) > 0) return undefined;
    return kind === "video" ? translate("create.library.videoModelNoVideo") : kind === "audio" ? translate("create.library.videoModelNoAudio") : translate("create.library.videoModelNoImage");
}

export function creationLibrarySelectionToAttachments(ids: string[], items: AssetLibraryPickerItem[], mode: CreationMode, videoLimits?: CreationReferenceLimits): CreationAttachment[] {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return ids.map((id) => {
        const item = itemsById.get(id);
        if (!item) throw new Error(translate("create.library.selectionMissing"));
        const kind = item.external?.item.kind || item.asset?.kind;
        const disabledReason = item.disabledReason || creationLibraryDisabledReason(mode, kind, videoLimits);
        if (disabledReason) throw new Error(translate("create.library.itemDisabled", { title: item.title, reason: disabledReason }));
        if (item.external) return creationAttachmentFromExternalAsset(item.external);
        const asset = item.asset;
        if (asset?.kind === "image") return creationAttachmentFromAsset(asset);
        if (asset?.kind === "video") return creationAttachmentFromVideoAsset(asset);
        if (asset?.kind === "audio") return creationAttachmentFromAudioAsset(asset);
        throw new Error(translate("create.library.selectionMissing"));
    });
}
