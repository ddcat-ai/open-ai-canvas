import { nanoid } from "nanoid";

import { createLazyLocalForage } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { captureVideoPoster, detectVideoAudioTrackFromBlob } from "@/lib/video-poster";
import { getResourceDirectUrl, getResourceStorageMode, isResourceUrl, resourceFallbackUrl, resourceFileUrl, resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { uploadImage, type UploadedImage } from "@/services/image-storage";
import { getCachedResourceBlob, getCachedResourceObjectUrl, primeResourceBlobCache } from "@/services/resource-blob-cache";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; hasAudio?: boolean; preview?: UploadedImage };

const getStore = createLazyLocalForage({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file", onProgress?: (uploadedBytes: number, totalBytes: number) => void): Promise<UploadedFile> {
    // 直传和失败后的本地同步必须复用同一上传身份，避免响应丢失后创建第二个对象。
    const storageKey = `${prefix}:${getActiveUserScope()}:${nanoid()}`;
    const storageMode = await getResourceStorageMode();
    const blob = typeof input === "string" ? await fetchMediaBlob(input) : input;
    const previewUrl = URL.createObjectURL(blob);
    let keepPreviewUrl = false;
    try {
        const captured = blob.type.startsWith("video/") ? await captureVideoPoster(previewUrl).catch(() => undefined) : undefined;
        // Browser track probes can report a false negative for MP4/MOV files.
        // Re-check only when capture did not positively confirm an audio track so
        // normal uploads avoid an extra full-blob parse.
        const parsedHasAudio = blob.type.startsWith("video/") && captured?.hasAudio !== true ? await detectVideoAudioTrackFromBlob(blob) : undefined;
        const resolvedHasAudio = parsedHasAudio ?? (captured?.hasAudio === false ? undefined : captured?.hasAudio);
        const meta: { width?: number; height?: number; durationMs?: number; hasAudio?: boolean } = captured
            ? { width: captured.width, height: captured.height, durationMs: captured.durationMs, hasAudio: resolvedHasAudio }
            : blob.type.startsWith("audio/")
              ? await readAudioMeta(previewUrl)
              : { hasAudio: resolvedHasAudio };
        let poster: UploadedImage | undefined;
        if (captured?.poster) {
            try {
                poster = await uploadImage(captured.poster);
            } catch (error) {
                if (storageMode === "oss") throw error;
            }
        }
        try {
            const kind = blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
            const resource = await uploadResourceFile(blob, kind, { ...meta, fileName: input instanceof File ? input.name : undefined, idempotencyKey: storageKey });
            // 图片由 image-storage 负责 Blob 缓存；视频/音频/通用文件保留
            // 资源地址，让浏览器按 Range/HTTP 缓存播放或按需下载。
            return {
                url: resource.publicUrl || resourceFileUrl(resource.id),
                storageKey: resourceStorageKey(resource.id),
                bytes: resource.size || blob.size,
                mimeType: resource.mimeType || blob.type || "application/octet-stream",
                width: resource.width || meta.width,
                height: resource.height || meta.height,
                durationMs: resource.durationMs || meta.durationMs,
                hasAudio: meta.hasAudio,
                preview: poster,
            };
        } catch (error) {
            if (storageMode === "oss") throw new Error(error instanceof Error ? `对象存储上传失败：${error.message}` : "对象存储上传失败，请重试");
        }
        await getStore().setItem(storageKey, blob);
        keepPreviewUrl = true;
        objectUrls.set(storageKey, previewUrl);
        return { url: previewUrl, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, preview: poster };
    } finally {
        if (!keepPreviewUrl) URL.revokeObjectURL(previewUrl);
    }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "", options?: { forceRefresh?: boolean }) {
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(fallback);
    if (resourceId) {
        const remoteStorageKey = resourceStorageKey(resourceId);
        const cached = await getCachedResourceObjectUrl(remoteStorageKey).catch(() => "");
        if (cached) return cached;
        // Media elements can consume a signed provider URL without requiring
        // CORS. Resolve it before mounting so playback does not first request
        // /api/resources/:id/file and wait for an application-server redirect.
        return await getResourceDirectUrl(remoteStorageKey, options).catch(() => resourceFallbackUrl(resourceId, fallback));
    }
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await getStore().getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (resourceIdFromStorageKey(storageKey)) return getCachedResourceBlob(storageKey);
    return getStore().getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (resourceIdFromStorageKey(storageKey)) return primeResourceBlobCache(storageKey, blob);
    await getStore().setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            if (resourceIdFromStorageKey(key)) return;
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await getStore().removeItem(key);
        }),
    );
}

export function clearFileStorageObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

export async function cleanupUnusedMedia(usedData: unknown, scope = getActiveUserScope()) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const currentScope = scope;
    const unused: string[] = [];
    await getStore().iterate((_value, key) => {
        const parts = key.split(":");
        if (parts.length >= 3 && parts[1] === currentScope && !usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => getStore().removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.includes(":") || resourceIdFromStorageKey(value.storageKey))) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

async function fetchMediaBlob(url: string) {
    const response = await fetch(url, { credentials: isResourceUrl(url) ? "include" : "same-origin" });
    if (!response.ok) throw new Error(`读取媒体失败（HTTP ${response.status}）`);
    return response.blob();
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        let settled = false;
        const cleanup = () => {
            window.clearTimeout(timeoutId);
            audio.onloadedmetadata = null;
            audio.onerror = null;
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
        };
        const done = () => {
            if (settled) return;
            settled = true;
            const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
            cleanup();
            resolve({ durationMs });
        };
        const timeoutId = window.setTimeout(done, 10_000);
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
