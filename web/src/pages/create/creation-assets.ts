import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import type { Asset, ImageAsset, NewAsset } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

export type CreationAttachment = ReferenceImage & { previewUrl: string };

export type CreationAssetIdentity = {
    taskId?: string;
    messageId?: string;
    resultIndex?: number;
};

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
