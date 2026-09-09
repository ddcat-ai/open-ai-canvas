import { nanoid } from "nanoid";
import { createLazyLocalForage } from "@/lib/localforage-storage";
import { readImageMeta } from "@/lib/image-utils";
import { getActiveUserScope } from "@/lib/user-scope";
import { getResourceDirectUrl, getResourceStorageMode, importResourceFromUrl, isResourceUrl, resourceFallbackUrl, resourceFileUrl, resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { cacheResourceObjectUrl, getCachedResourceBlob, getCachedResourceObjectUrl, primeResourceBlobCache } from "@/services/resource-blob-cache";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const getStore = createLazyLocalForage({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    // 本地模式下直传失败可暂存 IndexedDB，并由云端数据同步再次提交。
    // 提前生成本地 key，确保两条路径向后端发送相同的幂等标识。
    const storageKey = `image:${getActiveUserScope()}:${nanoid()}`;
    const storageMode = await getResourceStorageMode();
    if (typeof input === "string" && shouldImportRemoteImage(input)) {
        try {
            const resource = await importResourceFromUrl(input, "image", { idempotencyKey: storageKey });
            return {
                url: resource.publicUrl || resourceFileUrl(resource.id),
                storageKey: resourceStorageKey(resource.id),
                width: resource.width || 1024,
                height: resource.height || 1024,
                bytes: resource.size || 0,
                mimeType: resource.mimeType || "image/png",
            };
        } catch {
            // A browser-readable URL can still be uploaded as a Blob; the final
            // persistence path remains governed by the effective storage mode.
        }
    }
    const blob = typeof input === "string" ? await fetchImageBlob(input) : input;
    const previewUrl = URL.createObjectURL(blob);
    let meta: Awaited<ReturnType<typeof readImageMeta>>;
    try {
        meta = await readImageMeta(previewUrl);
    } catch (error) {
        URL.revokeObjectURL(previewUrl);
        throw error;
    }
    try {
        const resource = await uploadResourceFile(blob, "image", { width: meta.width, height: meta.height, fileName: input instanceof File ? input.name : undefined, idempotencyKey: storageKey });
        await primeResourceBlobCache(resourceStorageKey(resource.id), blob).catch(() => "");
        URL.revokeObjectURL(previewUrl);
        return {
            url: resource.publicUrl || resourceFileUrl(resource.id),
            storageKey: resourceStorageKey(resource.id),
            width: resource.width || meta.width,
            height: resource.height || meta.height,
            bytes: resource.size || blob.size,
            mimeType: resource.mimeType || blob.type || meta.mimeType,
        };
    } catch (error) {
        if (storageMode === "oss") {
            URL.revokeObjectURL(previewUrl);
            throw new Error(error instanceof Error ? `对象存储上传失败：${error.message}` : "对象存储上传失败，请重试");
        }
    }
    await getStore().setItem(storageKey, blob);
    const url = previewUrl;
    objectUrls.set(storageKey, url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

function shouldImportRemoteImage(input: string) {
    return /^https?:\/\//i.test(input) && !isResourceUrl(input);
}

export async function resolveImageUrl(storageKey?: string, fallback = "", options?: { cacheMiss?: boolean; preferDirect?: boolean; proxyFallback?: boolean; forceRefresh?: boolean }) {
    const resourceId = resourceIdFromStorageKey(storageKey) || resourceIdFromFileUrl(fallback);
    if (resourceId) {
        const remoteStorageKey = resourceStorageKey(resourceId);
        const cached = await getCachedResourceObjectUrl(remoteStorageKey).catch(() => "");
        if (cached) return cached;
        // 普通预览应直接挂载签名地址。对未开启 CORS 的 OSS，先 fetch
        // 再回退到 /file 会额外产生一次应用服务器到 OSS 的传输。
        if (options?.cacheMiss && !options?.preferDirect) {
            const populated = await cacheResourceObjectUrl(remoteStorageKey, { proxyFallback: options?.proxyFallback }).catch(() => "");
            if (populated) return populated;
        }
        // Even the normal image fallback should skip /file. The API proxy is
        // retained only when signing fails or the provider is unavailable.
        return await getResourceDirectUrl(remoteStorageKey, { forceRefresh: options?.forceRefresh }).catch(() => resourceFallbackUrl(resourceId, fallback));
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

export async function getImageBlob(storageKey: string) {
    if (resourceIdFromStorageKey(storageKey)) return getCachedResourceBlob(storageKey);
    return getStore().getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (resourceIdFromStorageKey(storageKey)) return primeResourceBlobCache(storageKey, blob);
    await getStore().setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string; name?: string; type?: string; mimeType?: string }) {
    if (image.storageKey) {
        const blob = await getImageBlob(image.storageKey);
        if (blob) return blobToDataUrl(await normalizeImageBlob(blob, image.name || image.url));
    }
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url) return url;
    if (url.startsWith("data:image/")) return url;
    if (url.startsWith("data:")) return blobToDataUrl(await normalizeImageBlob(await fetchImageBlob(url), image.name));
    const blob = await fetchImageBlob(url);
    return blobToDataUrl(await normalizeImageBlob(blob, image.name || url));
}

export async function deleteStoredImages(keys: Iterable<string>) {
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

export function clearImageStorageObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

export async function cleanupUnusedImages(usedData: unknown, scope = getActiveUserScope()) {
    const usedKeys = collectImageStorageKeys(usedData);
    const currentPrefixes = [`image:${scope}:`, `generation-image:${scope}:`];
    const unused: string[] = [];
    await getStore().iterate((_value, key) => {
        if (currentPrefixes.some((prefix) => key.startsWith(prefix)) && !usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.startsWith("image:") || value.storageKey.startsWith("generation-image:") || resourceIdFromStorageKey(value.storageKey))) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

async function fetchImageBlob(url: string) {
    const response = await fetch(url, { credentials: isResourceUrl(url) ? "include" : "same-origin" });
    if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`);
    return response.blob();
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function normalizeImageBlob(blob: Blob, sourceName = "") {
    if (blob.type.startsWith("image/")) return blob;
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const mimeType = detectImageMimeType(bytes) || imageMimeTypeFromName(sourceName);
    if (!mimeType) throw new Error("无法识别参考图片格式，请重新上传 PNG、JPEG、WebP 或 GIF 图片");
    return blob.slice(0, blob.size, mimeType);
}

function detectImageMimeType(bytes: Uint8Array) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    return "";
}

function imageMimeTypeFromName(value: string) {
    const path = value.toLowerCase().split(/[?#]/)[0];
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".gif")) return "image/gif";
    if (path.endsWith(".bmp")) return "image/bmp";
    return "";
}
