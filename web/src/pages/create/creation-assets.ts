import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import type { Asset, AudioAsset, ImageAsset, NewAsset } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type CreationDocumentAttachment = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey: string;
    bytes: number;
    previewUrl: string;
};
export type CreationAttachment = ((ReferenceImage | ReferenceVideo | ReferenceAudio) & { previewUrl: string }) | CreationDocumentAttachment;
export type CreationMode = "text" | "image" | "video";
export type CreationAttachmentKind = "image" | "video" | "audio" | "file";

const textDocumentExtensions = [".pdf", ".txt", ".md", ".csv", ".json", ".html", ".xml", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"];

export type CreationAssetIdentity = {
    taskId?: string;
    messageId?: string;
    resultIndex?: number;
};

export function creationUploadAccept(mode: CreationMode) {
    if (mode === "video") return "image/*,video/*,audio/*";
    if (mode === "text") return `image/*,video/*,audio/*,${textDocumentExtensions.join(",")}`;
    return "image/*";
}

export function creationFileAccepted(mode: CreationMode, file: Pick<File, "type" | "name">) {
    if (file.type.startsWith("image/")) return true;
    if (mode === "video") return file.type.startsWith("video/") || file.type.startsWith("audio/");
    if (mode !== "text") return false;
    const name = file.name.toLowerCase();
    return file.type.startsWith("video/") || file.type.startsWith("audio/") || file.type.startsWith("text/") || textDocumentExtensions.some((extension) => name.endsWith(extension));
}

export function creationAttachmentKind(attachment: Pick<CreationAttachment, "type">): CreationAttachmentKind {
    if (attachment.type.startsWith("video/")) return "video";
    if (attachment.type.startsWith("audio/")) return "audio";
    if (attachment.type.startsWith("image/")) return "image";
    return "file";
}

export function splitCreationAttachments(attachments: CreationAttachment[]) {
    return {
        referenceImages: attachments.filter((attachment): attachment is CreationAttachment & ReferenceImage => creationAttachmentKind(attachment) === "image"),
        referenceVideos: attachments.filter((attachment): attachment is CreationAttachment & ReferenceVideo => creationAttachmentKind(attachment) === "video"),
        referenceAudios: attachments.filter((attachment): attachment is CreationAttachment & ReferenceAudio => creationAttachmentKind(attachment) === "audio"),
    };
}

export function creationAttachmentPreview(attachment: CreationAttachment): { kind: CreationAttachmentKind; url: string } {
    const kind = creationAttachmentKind(attachment);
    const url = kind === "image" ? attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "" : attachment.url || attachment.previewUrl;
    return { kind, url };
}

export function creationMediaAspectRatio(value: string | undefined, mode: CreationMode) {
    const fallback = mode === "video" ? "16 / 9" : "1 / 1";
    const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
    if (!match) return fallback;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
    return `${width} / ${height}`;
}

export function removeCreationAttachment<T extends { id: string }>(attachments: T[], id: string) {
    return attachments.filter((attachment) => attachment.id !== id);
}

export function creationAssetKey(identity: CreationAssetIdentity): string | undefined {
    const taskId = identity.taskId?.trim();
    const messageId = identity.messageId?.trim();
    const scope = taskId ? `task:${taskId}` : messageId ? `message:${messageId}` : "";
    if (!scope) return undefined;
    const resultIndex = typeof identity.resultIndex === "number" && Number.isInteger(identity.resultIndex) && identity.resultIndex >= 0 ? identity.resultIndex : 0;
    return `create-generation:${scope}:${resultIndex}`;
}

export function isSameCreationAsset(asset: Pick<Asset, "metadata">, identity: CreationAssetIdentity): boolean {
    const key = creationAssetKey(identity);
    if (!key) return false;
    if (asset.metadata?.creationAssetKey === key) return true;

    // 兼容修复前已经写入的素材：旧记录没有结果序号，只能将同一任务的首个结果视为已处理。
    const isLegacyResult = identity.resultIndex === 0 && typeof identity.taskId === "string";
    return isLegacyResult && asset.metadata?.source === "create-generation" && asset.metadata?.taskId === identity.taskId && asset.metadata?.resultIndex === undefined;
}

export function creationAttachmentFromImage(file: File, uploaded: UploadedImage): CreationAttachment {
    return {
        id: `upload:${file.name}:${uploaded.storageKey}`,
        name: file.name,
        type: uploaded.mimeType || file.type || "image/png",
        dataUrl: uploaded.url,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        width: uploaded.width,
        height: uploaded.height,
        previewUrl: uploaded.url,
    };
}

export function creationAttachmentFromVideo(file: File, uploaded: UploadedFile): CreationAttachment {
    return {
        id: `upload:${file.name}:${uploaded.storageKey}`,
        name: file.name,
        type: uploaded.mimeType || file.type || "video/mp4",
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        width: uploaded.width,
        height: uploaded.height,
        durationMs: uploaded.durationMs,
        previewUrl: uploaded.url,
    };
}

export function creationAttachmentFromAudio(file: File, uploaded: UploadedFile): CreationAttachment {
    return {
        id: `upload:${file.name}:${uploaded.storageKey}`,
        name: file.name,
        type: uploaded.mimeType || file.type || "audio/mpeg",
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        durationMs: uploaded.durationMs,
        previewUrl: uploaded.url,
    };
}

export function creationAttachmentFromDocument(file: File, uploaded: UploadedFile): CreationAttachment {
    return {
        id: `upload:${file.name}:${uploaded.storageKey}`,
        name: file.name,
        type: uploaded.mimeType || file.type || "application/octet-stream",
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        previewUrl: "",
    };
}

export function creationAttachmentFromAsset(asset: ImageAsset): CreationAttachment {
    const url = asset.data.dataUrl || asset.coverUrl;
    return {
        id: `asset:${asset.id}`,
        name: asset.title || "素材图片",
        type: asset.data.mimeType || "image/png",
        dataUrl: url,
        url,
        storageKey: asset.data.storageKey,
        bytes: asset.data.bytes,
        width: asset.data.width,
        height: asset.data.height,
        previewUrl: url,
    };
}

export function creationAttachmentFromVideoAsset(asset: Extract<Asset, { kind: "video" }>): CreationAttachment {
    return {
        id: `asset:${asset.id}`,
        name: asset.title || "素材视频",
        type: asset.data.mimeType || "video/mp4",
        url: asset.data.url,
        storageKey: asset.data.storageKey,
        bytes: asset.data.bytes,
        width: asset.data.width,
        height: asset.data.height,
        durationMs: asset.data.durationMs,
        previewUrl: asset.coverUrl || asset.data.url,
    };
}

export function creationAttachmentFromAudioAsset(asset: AudioAsset): CreationAttachment {
    return {
        id: `asset:${asset.id}`,
        name: asset.title || "素材音频",
        type: asset.data.mimeType || "audio/mpeg",
        url: asset.data.url,
        storageKey: asset.data.storageKey,
        bytes: asset.data.bytes,
        durationMs: asset.data.durationMs,
        previewUrl: asset.data.url,
    };
}

export function creationAttachmentFromExternalAsset(reference: ExternalAssetPickerReference): CreationAttachment {
    const item = reference.item;
    const url = item.fileUrl || "";
    if (!url) throw new Error("“" + item.title + "”暂时无法读取，请先在 Eagle 中确认文件可用");
    const id = "external:" + reference.sourceId + ":" + item.id;
    const type = item.mimeType || (item.kind === "image" ? "image/png" : item.kind === "video" ? "video/mp4" : "audio/mpeg");
    if (item.kind === "image") {
        return {
            id,
            name: item.title || "素材图片",
            type,
            dataUrl: url,
            url,
            bytes: item.bytes,
            width: item.width,
            height: item.height,
            previewUrl: item.thumbnailUrl || url,
        };
    }
    if (item.kind === "video") {
        return {
            id,
            name: item.title || "素材视频",
            type,
            url,
            bytes: item.bytes,
            width: item.width,
            height: item.height,
            previewUrl: item.thumbnailUrl || url,
        };
    }
    if (item.kind === "audio") {
        return {
            id,
            name: item.title || "素材音频",
            type,
            url,
            bytes: item.bytes,
            previewUrl: item.thumbnailUrl || url,
        };
    }
    throw new Error("“" + item.title + "”不是可用于创作参考的媒体文件");
}
export function creationImageAsset({ title, uploaded, metadata }: { title: string; uploaded: UploadedImage; metadata?: Record<string, unknown> }): NewAsset {
    return {
        kind: "image",
        title: title.trim() || "创作图片",
        coverUrl: uploaded.url,
        tags: ["创作"],
        status: "confirmed",
        source: "创作页",
        metadata: { source: "create-page", ...metadata },
        data: {
            dataUrl: uploaded.url,
            storageKey: uploaded.storageKey,
            width: uploaded.width,
            height: uploaded.height,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType || "image/png",
        },
    };
}

export function creationAudioAsset({ title, uploaded, metadata }: { title: string; uploaded: UploadedFile; metadata?: Record<string, unknown> }): NewAsset {
    return {
        kind: "audio",
        title: title.trim() || "创作音频",
        coverUrl: "",
        tags: ["创作"],
        status: "confirmed",
        source: "创作页",
        metadata: { source: "create-page", ...metadata },
        data: {
            url: uploaded.url,
            storageKey: uploaded.storageKey,
            durationMs: uploaded.durationMs,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType || "audio/mpeg",
        },
    };
}

export function creationVideoAsset({ title, uploaded, metadata }: { title: string; uploaded: UploadedFile; metadata?: Record<string, unknown> }): NewAsset {
    return {
        kind: "video",
        title: title.trim() || "创作视频",
        coverUrl: uploaded.url,
        tags: ["创作"],
        status: "confirmed",
        source: "创作页",
        metadata: { source: "create-page", ...metadata },
        data: {
            url: uploaded.url,
            storageKey: uploaded.storageKey,
            width: uploaded.width || 0,
            height: uploaded.height || 0,
            durationMs: uploaded.durationMs,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType || "video/mp4",
        },
    };
}
