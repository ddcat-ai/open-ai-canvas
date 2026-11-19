import { creationResultStorageKeys } from "@/lib/canvas/canvas-asset-handoff";
import { resolveResourceUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { Asset } from "@/stores/use-asset-store";
import { creationAttachmentFromAsset, type CreationAttachment } from "./creation-assets";
import type { CreationMessage } from "./creation-types";

export const CREATION_IMAGE_DRAG_TYPE = "application/x-yingce-creation-image";
export type CreationImageDrag = { messageId: string; resultKey: string };
export type CreationReferenceDrop = { kind: "files"; files: File[] } | { kind: "result"; image: CreationImageDrag };

export function hasCreationReferenceDrop(transfer: Pick<DataTransfer, "types">) {
    return Array.from(transfer.types).some((type) => type === CREATION_IMAGE_DRAG_TYPE || type === "Files");
}

export function readCreationReferenceDrop(transfer: Pick<DataTransfer, "types" | "getData" | "files">): CreationReferenceDrop | null {
    if (Array.from(transfer.types).includes(CREATION_IMAGE_DRAG_TYPE)) {
        try {
            const value: unknown = JSON.parse(transfer.getData(CREATION_IMAGE_DRAG_TYPE));
            if (!value || typeof value !== "object" || !("messageId" in value) || !("resultKey" in value)) return null;
            if (typeof value.messageId !== "string" || !value.messageId || typeof value.resultKey !== "string" || !value.resultKey) return null;
            return { kind: "result", image: { messageId: value.messageId, resultKey: value.resultKey } };
        } catch {
            return null;
        }
    }
    const files = Array.from(transfer.files);
    return files.length ? { kind: "files", files } : null;
}

// 拖拽只传身份；地址与资源归属从当前账号已加载的消息和素材中解析。
export async function creationAttachmentFromResult(
    image: CreationImageDrag,
    messages: CreationMessage[],
    assets: Asset[],
    resolveLocalImage: (key: string) => Promise<string> = async (key) => (await import("@/services/image-storage")).resolveImageUrl(key),
): Promise<CreationAttachment> {
    const message = messages.find((item) => item.id === image.messageId && item.role === "assistant" && item.mode === "image" && item.status === "done");
    if (!message) throw new Error("生成图片已不可用，请刷新结果后重试");
    const urls = message.resultUrls || [];
    const keys = message.resultStorageKeys?.length ? message.resultStorageKeys : creationResultStorageKeys(assets, { messageId: message.id, taskIds: message.taskIds || [], resultUrls: urls });
    const index = (keys.length ? keys : urls).indexOf(image.resultKey);
    if (index < 0) throw new Error("未找到这张生成图片，请刷新结果后重试");
    const storageKey = keys[index];
    const asset = assets.find((item) => item.kind === "image" && (storageKey ? item.data.storageKey === storageKey : item.data.dataUrl === urls[index]));
    const fromAsset = asset?.kind === "image" ? creationAttachmentFromAsset(asset) : undefined;
    // 刷新后的本机历史不能沿用旧 blob URL；与结果预览一样从存储键重新解析。
    const url = storageKey && !resourceIdFromStorageKey(storageKey) ? await resolveLocalImage(storageKey) : resolveResourceUrl(storageKey, fromAsset?.previewUrl || urls[index]);
    if (!url) throw new Error("生成图片尚未保存完成，请稍后重试");
    if (fromAsset) return { ...fromAsset, dataUrl: url, url, previewUrl: url };
    return { id: `result:${message.id}:${image.resultKey}`, name: `生成图片 ${index + 1}`, type: "image/png", storageKey, dataUrl: url, url, previewUrl: url };
}

export function appendCreationReference(current: CreationAttachment[], next: CreationAttachment, maxImages: number, maxAttachments = Infinity): CreationAttachment[] {
    const duplicate = current.some((item) => item.id === next.id || (item.storageKey && next.storageKey && item.storageKey === next.storageKey) || (!item.storageKey && !next.storageKey && item.previewUrl && item.previewUrl === next.previewUrl));
    if (duplicate) return current;
    if (current.length >= maxAttachments) throw new Error(`当前模型最多支持 ${maxAttachments} 个参考内容`);
    if (current.filter((item) => item.type.startsWith("image/")).length >= maxImages) throw new Error(`当前模型最多支持 ${maxImages} 张参考图`);
    return [...current, next];
}
