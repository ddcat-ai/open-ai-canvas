// 用户数据同步前的媒体上行：把本地存储键、内联 data URL 上传成资源引用，再写入远端。
//
// 同一份内联数据按内容摘要去重上传；上传失败时整批同步失败并进入重试，不写入半成品。

import { getResourceBlob, isResourceUrl, resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";

export function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

export const LOCAL_STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;

export function collectLocalMediaKeys(value: unknown, set = new Set<string>()): string[] {
    if (!value || typeof value !== "object") return [...set];
    if (Array.isArray(value)) {
        for (const item of value) collectLocalMediaKeys(item, set);
        return [...set];
    }
    const record = value as Record<string, unknown>;
    const storageKey = typeof record.storageKey === "string" ? record.storageKey : "";
    if (isLocalStorageKey(storageKey) && !resourceIdFromStorageKey(storageKey)) {
        set.add(storageKey);
    } else {
        const inline = inlineMediaDataUrl(record);
        if (inline) set.add(`${inline.length}:${inline.slice(0, 64)}:${inline.slice(-64)}`);
    }
    for (const child of Object.values(record)) {
        collectLocalMediaKeys(child, set);
    }
    return [...set];
}

/**
 * 修复早期版本已经把文本正文保存成资源 URL 的画布数据。
 * 上传文本时 prompt 与正文相同，优先使用 prompt，避免一次额外的资源下载；
 * 其他旧数据再从同一 storageKey 读取原始文件。
 */
export async function restoreRemoteTextNodeContents<T>(value: T, readText: (storageKey: string) => Promise<string | null> = readRemoteTextResource): Promise<T> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.nodes)) return value;
    const nodes = await Promise.all(
        record.nodes.map(async (item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return item;
            const node = item as Record<string, unknown>;
            if (node.type !== "text" && node.type !== "markdown") return item;
            const metadata = node.metadata;
            if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return item;
            const nextMetadata = { ...(metadata as Record<string, unknown>) };
            const storageKey = typeof nextMetadata.storageKey === "string" ? nextMetadata.storageKey : "";
            const content = typeof nextMetadata.content === "string" ? nextMetadata.content : "";
            if (!resourceIdFromStorageKey(storageKey) || !isResourceUrl(content)) return item;
            const prompt = typeof nextMetadata.prompt === "string" ? nextMetadata.prompt : "";
            const restored = prompt && !isResourceUrl(prompt) ? prompt : await readText(storageKey);
            if (!restored) return item;
            return { ...node, metadata: { ...nextMetadata, content: restored, ...(prompt && !isResourceUrl(prompt) ? {} : { prompt: restored }) } };
        }),
    );
    return { ...record, nodes } as T;
}

async function readRemoteTextResource(storageKey: string) {
    try {
        return (await getResourceBlob(storageKey))?.text() || null;
    } catch {
        return null;
    }
}

export async function ensureRemoteResourceReferences<T>(value: T, uploaded = new Map<string, string>(), onUploaded?: () => void, preserveTextContent = false): Promise<T> {
    if (!value || typeof value !== "object") return value;
    // 文本节点也会携带 file 资源的 storageKey。这个 key 用于素材归属和
    // Agent 读取文件，不能因此把节点正文替换成 /api/resources/.../file。
    const currentPreserveTextContent = preserveTextContent || (typeof (value as { type?: unknown }).type === "string" && (value as unknown as { type: string }).type === "text");
    if (Array.isArray(value)) {
        const result: unknown[] = [];
        for (const item of value) result.push(await ensureRemoteResourceReferences(item, uploaded, onUploaded, currentPreserveTextContent));
        return result as T;
    }

    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        next[key] = await ensureRemoteResourceReferences(child, uploaded, onUploaded, currentPreserveTextContent);
    }

    const storageKey = typeof next.storageKey === "string" ? next.storageKey : "";
    const remoteResourceId = resourceIdFromStorageKey(storageKey);
    if (remoteResourceId) return applyResourceReference(next, storageKey, currentPreserveTextContent) as T;

    if (!isLocalStorageKey(storageKey)) {
        const inline = inlineMediaDataUrl(next);
        if (!inline) return next as T;
        const identity = await inlineMediaUploadIdentity(inline);
        const cached = uploaded.get(identity);
        if (cached) return applyResourceReference(next, cached, currentPreserveTextContent) as T;
        const resourceStorage = await uploadInlineDataUrl(inline, identity);
        uploaded.set(identity, resourceStorage);
        onUploaded?.();
        return applyResourceReference(next, resourceStorage, currentPreserveTextContent) as T;
    }

    const cached = uploaded.get(storageKey);
    if (cached) return applyResourceReference(next, cached, currentPreserveTextContent) as T;
    const resourceStorage = await uploadLocalStorageKey(storageKey, next);
    uploaded.set(storageKey, resourceStorage);
    onUploaded?.();
    return applyResourceReference(next, resourceStorage, currentPreserveTextContent) as T;
}

export function applyResourceReference(payload: Record<string, unknown>, storageKey: string, preserveTextContent = false) {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) {
        throw new Error(`远端资源引用无效：${storageKey}`);
    }
    const url = resourceFileUrl(resourceId);
    payload.storageKey = storageKey;
    for (const key of preserveTextContent ? [] : ["content", "dataUrl", "url", "coverUrl"]) {
        if (typeof payload[key] === "string") payload[key] = url;
    }
    return payload;
}

export function inlineMediaDataUrl(payload: Record<string, unknown>) {
    for (const key of ["dataUrl", "content", "url", "coverUrl"]) {
        const value = payload[key];
        if (typeof value === "string" && /^data:(image|video|audio)\//i.test(value)) return value;
    }
    return "";
}

export async function uploadInlineDataUrl(dataUrl: string, identity: string) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("内嵌媒体读取失败");
    const blob = await response.blob();
    const kind: "image" | "video" | "audio" | "file" = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind, { idempotencyKey: identity });
    return resourceStorageKey(resource.id);
}

export async function inlineMediaUploadIdentity(dataUrl: string) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
    return `inline:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function uploadLocalStorageKey(storageKey: string, payload: Record<string, unknown>) {
    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob) throw new Error(`本地媒体不存在，无法同步：${storageKey}`);
    const kind = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind, {
        width: numberValue(payload.naturalWidth) || numberValue(payload.width),
        height: numberValue(payload.naturalHeight) || numberValue(payload.height),
        durationMs: numberValue(payload.durationMs),
        idempotencyKey: storageKey,
    });
    return resourceStorageKey(resource.id);
}

export function isLocalStorageKey(value: string) {
    return LOCAL_STORAGE_KEY_PATTERN.test(value) && !resourceIdFromStorageKey(value);
}
