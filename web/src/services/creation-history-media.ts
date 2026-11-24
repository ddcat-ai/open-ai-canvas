import type { CreationMessage } from "@/pages/create/creation-types";
import { getImageBlob } from "./image-storage";
import { getMediaBlob } from "./file-storage";
import { resourceFileUrl, resourceIdFromStorageKey, uploadResourceFile } from "./api/resources";
import { historyMessagePayload } from "./creation-history-payload";

export function creationHistoryMedia(scope: string, signal: AbortSignal, active: () => boolean) {
    const uploaded = new Map<string, string>();
    const assertActive = () => {
        if (signal.aborted || !active()) throw new DOMException("账号已切换", "AbortError");
    };
    async function remoteKey(key = "", fallback = "", type = "") {
        assertActive();
        if (resourceIdFromStorageKey(key)) return key;
        const path = fallback.match(/^\/api\/resources\/([a-zA-Z0-9_:-]+)\/file(?:[?#].*)?$/);
        if (path) return `resource:${path[1]}`;
        const identity = key || fallback;
        if (uploaded.has(identity)) return uploaded.get(identity)!;
        let blob: Blob | null | undefined;
        if (key) blob = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
        if (!blob && /^(blob:|data:)/.test(fallback)) {
            const response = await fetch(fallback, { signal });
            if (!response.ok) throw new Error("本地历史媒体读取失败");
            blob = await response.blob();
        }
        assertActive();
        if (!blob) throw new Error("历史媒体缺少可迁移的本地文件或稳定资源引用，本机原记录已保留");
        const kind = (blob.type || type).startsWith("video/") ? "video" : (blob.type || type).startsWith("audio/") ? "audio" : (blob.type || type).startsWith("image/") ? "image" : "file";
        // Original local keys make retries idempotent across page reloads; inline data uses a digest.
        const digest = key || Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (n) => n.toString(16).padStart(2, "0")).join("");
        assertActive();
        const result = await uploadResourceFile(blob, kind, { idempotencyKey: `creation-history:${digest}`, expectedUserId: scope, signal });
        assertActive();
        const next = `resource:${result.id}`;
        uploaded.set(identity, next);
        return next;
    }
    return async (message: CreationMessage) => {
        assertActive();
        const payload = historyMessagePayload(message);
        if (message.attachments) {
            payload.attachments = await Promise.all(
                message.attachments.map(async (attachment, index) => ({
                    ...(payload.attachments as Record<string, unknown>[])[index],
                    storageKey: await remoteKey(attachment.storageKey, attachment.url || ("dataUrl" in attachment ? attachment.dataUrl : ""), attachment.type),
                })),
            );
        }
        if (message.references) {
            payload.references = [];
            for (let index = 0; index < message.references.length; index++) {
                const reference = message.references[index];
                const value = historyMessagePayload(message).references as Record<string, unknown>[];
                const next = { ...value[index] };
                const attachment = (payload.attachments as Record<string, unknown>[] | undefined)?.find((item) => item.id === reference.attachmentId);
                if (attachment) next.storageKey = attachment.storageKey;
                else if (reference.storageKey) next.storageKey = await remoteKey(reference.storageKey, reference.mediaUrl || reference.previewUrl);
                if (reference.previewStorageKey) next.previewStorageKey = await remoteKey(reference.previewStorageKey, reference.previewUrl, "image/png");
                (payload.references as Record<string, unknown>[]).push(next);
            }
        }
        const keys = message.resultStorageKeys || [];
        const urls = message.resultUrls || [];
        if (keys.length || urls.length) {
            payload.resultStorageKeys = [];
            for (let i = 0; i < (keys.length || urls.length); i++) (payload.resultStorageKeys as string[]).push(await remoteKey(keys[i], urls[i], message.mode === "video" ? "video/mp4" : "image/png"));
        }
        assertActive();
        return payload;
    };
}

/** Only reconstruct authenticated canonical paths; actual access URLs remain ephemeral. */
export function restoreHistoryMedia(message: CreationMessage): CreationMessage {
    const urlFor = (key?: string) => (resourceIdFromStorageKey(key) ? resourceFileUrl(resourceIdFromStorageKey(key)) : "");
    return {
        ...message,
        ...(message.attachments
            ? {
                  attachments: message.attachments.map((item) =>
                      !resourceIdFromStorageKey(item.storageKey) ? item : { ...item, url: urlFor(item.storageKey), previewUrl: urlFor(item.storageKey), ...(item.type.startsWith("image/") ? { dataUrl: urlFor(item.storageKey) } : {}) },
                  ),
              }
            : {}),
        ...(message.references
            ? {
                  references: message.references.map((item) => ({
                      ...item,
                      ...(urlFor(item.previewStorageKey || item.storageKey) ? { previewUrl: urlFor(item.previewStorageKey || item.storageKey) } : {}),
                      ...(urlFor(item.storageKey) ? { mediaUrl: urlFor(item.storageKey) } : {}),
                  })),
              }
            : {}),
    };
}
