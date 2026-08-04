import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import type { ImageAsset, NewAsset } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

export type CreationAttachment = ReferenceImage & { previewUrl: string };

export function creationAttachmentFromImage(file: File, uploaded: UploadedImage): CreationAttachment {
    return {
        id: `upload:${file.name}:${uploaded.storageKey}`,
        name: file.name,
        type: uploaded.mimeType || file.type || "image/png",
        dataUrl: uploaded.url,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        previewUrl: uploaded.url,
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
        previewUrl: url,
    };
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
