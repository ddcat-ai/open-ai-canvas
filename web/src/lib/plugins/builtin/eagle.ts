import { nanoid } from "nanoid";

import { t } from "@/i18n";

import { addEagleItem, createEagleFolder, downloadEagleItem, eagleItemFileUrl, eagleItemThumbnailUrl, getEagleLibrary, listEagleItems, type EagleFolder, type EagleItem } from "@/services/api/eagle";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import { registerPlugin } from "../plugin-registry";
import type { AssetSourceProvider, ExternalAssetItem, PluginHostContext, RegisteredPlugin } from "../plugin-types";
import { eaglePluginDocumentation } from "./eagle-documentation";

export const EAGLE_PLUGIN_ID = "eagle-asset-connector";
export const EAGLE_DEFAULT_BASE_URL = "http://127.0.0.1:41595";

export const eagleAssetPlugin: RegisteredPlugin = {
    manifest: {
        id: EAGLE_PLUGIN_ID,
        name: t("lib:eagle-library"),
        version: "0.3.0",
        publishedAt: "2026-08-21",
        updatedAt: "2026-08-22",
        apiVersion: "1",
        category: "asset-source",
        description: t("lib:use-eagle-as-an-external-asset-source-for-yingce-browse-original-folders"),
        documentation: eaglePluginDocumentation,
        author: t("lib:yingce-community"),
        surfaces: ["asset-source"],
        permissions: ["asset.read", "asset.search", "asset.upload", "external.open"],
        trusted: true,
        configuration: { fields: ["baseUrl", "autoUploadGenerated", "generatedFolderId"] },
    },
    createAssetSource: ({ config }: PluginHostContext) => {
        const configuredBaseUrl = config.baseUrl;
        return createEagleAssetSource(typeof configuredBaseUrl === "string" && configuredBaseUrl.trim() ? configuredBaseUrl.trim() : undefined);
    },
};

export function createEagleAssetSource(baseUrl = EAGLE_DEFAULT_BASE_URL): AssetSourceProvider {
    let folderCache: EagleFolder[] | null = null;

    const getFolders = async (signal?: AbortSignal) => {
        if (signal?.aborted) throw new DOMException(t("lib:request-cancelled-2"), "AbortError");
        if (!folderCache) folderCache = (await getEagleLibrary(baseUrl)).library.folders;
        return folderCache;
    };

    return {
        listFolders: async (signal) => (await getFolders(signal)).map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId })),
        list: async (query) => {
            const [result, folders] = await Promise.all([listEagleItems({ baseUrl, folderId: query.folderId, keyword: query.keyword, limit: query.limit, offset: query.offset }), getFolders(query.signal)]);
            const pathMap = buildFolderPathMap(folders);
            return result.items.map((item) => toExternalItem(item, baseUrl, pathMap));
        },
        importAsset: (item, signal) => importEagleAsset(item, baseUrl, signal),
        uploadAsset: (asset, signal) => uploadEagleAsset(asset, baseUrl, undefined, signal),
        uploadAssetToFolder: (asset, folderId, signal) => uploadEagleAsset(asset, baseUrl, folderId, signal),
        uploadFile: (file, folderId, signal) => uploadEagleFile(file, baseUrl, folderId, signal),
        createFolder: async (name, parentId) => {
            await createEagleFolder(baseUrl, { name, parentId });
            folderCache = null;
        },
    };
}

async function importEagleAsset(item: ExternalAssetItem, baseUrl: string, signal?: AbortSignal): Promise<Asset> {
    const kind = item.kind;
    if (kind === "text" || kind === "entity") throw new Error(t("lib:eagle-import-does-not-support-text-or-entity-assets-yet"));
    const blob = await downloadEagleItem(item.id, baseUrl, signal);
    const now = new Date().toISOString();
    const metadata = {
        source: "eagle",
        eagle: {
            itemId: item.id,
            baseUrl,
            folderId: item.folderId,
            folderIds: item.folderIds || [],
            folderPath: item.folderPath || [],
            extension: item.metadata?.extension,
        },
    };
    if (kind === "image") {
        const uploaded = await uploadImage(blob);
        return {
            id: nanoid(), kind, title: item.title, coverUrl: uploaded.url, tags: item.tags || [], source: t("lib:eagle-library"), createdAt: now, updatedAt: now, metadata,
            data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: item.width || uploaded.width, height: item.height || uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    const uploaded = await uploadMediaFile(blob, `eagle-${kind}`);
    if (kind === "video") {
        return {
            id: nanoid(), kind, title: item.title, coverUrl: "", tags: item.tags || [], source: t("lib:eagle-library"), createdAt: now, updatedAt: now, metadata,
            data: { url: uploaded.url, storageKey: uploaded.storageKey, width: item.width || uploaded.width || 1280, height: item.height || uploaded.height || 720, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    if (kind === "audio") {
        return {
            id: nanoid(), kind, title: item.title, coverUrl: "", tags: item.tags || [], source: t("lib:eagle-library"), createdAt: now, updatedAt: now, metadata,
            data: { url: uploaded.url, storageKey: uploaded.storageKey, durationMs: uploaded.durationMs, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    return {
        id: nanoid(), kind: "model", title: item.title, coverUrl: "", tags: item.tags || [], source: t("lib:eagle-library"), createdAt: now, updatedAt: now, metadata,
        data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: item.title },
    };
}

type EagleWritableAsset = Extract<Asset, { kind: "image" | "video" | "audio" }>;

async function uploadEagleAsset(asset: Asset, baseUrl: string, folderId?: string, signal?: AbortSignal): Promise<ExternalAssetItem> {
    if (!isEagleWritableAsset(asset)) throw new Error(t("lib:only-images-videos-or-audio-can-currently-be-written-back-to-eagle"));
    const dataUrl = await assetToDataUrl(asset, signal);
    const result = await addEagleItem(baseUrl, {
        url: dataUrl,
        name: eagleAssetName(asset),
        folderId,
        tags: asset.tags,
        annotation: asset.note,
        website: typeof asset.metadata?.eagle === "object" && asset.metadata.eagle && "url" in asset.metadata.eagle ? String(asset.metadata.eagle.url || "") : undefined,
    });
    return { id: result.item.id || "eagle:" + asset.id, title: eagleAssetName(asset), kind: asset.kind, tags: asset.tags, mimeType: asset.data.mimeType };
}

function isEagleWritableAsset(asset: Asset): asset is EagleWritableAsset {
    return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
}

async function assetToDataUrl(asset: EagleWritableAsset, signal?: AbortSignal) {
    if (asset.kind === "image") {
        return imageToDataUrl({ dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, url: asset.data.dataUrl, name: asset.title, mimeType: asset.data.mimeType });
    }
    const stored = asset.data.storageKey ? await getMediaBlob(asset.data.storageKey) : null;
    if (stored) return fileToDataUrl(withMimeType(stored, asset.data.mimeType), signal);
    const url = asset.data.url;
    if (!url) throw new Error(t("lib:the-generation-result-has-no-media-address-writable-to-eagle"));
    if (url.startsWith("data:")) return url;
    const response = await fetch(url, { credentials: "include", signal });
    if (!response.ok) throw new Error(t("lib:failed-to-read-the-generated-media-cannot-write-to-eagle"));
    return fileToDataUrl(withMimeType(await response.blob(), asset.data.mimeType), signal);
}

function eagleAssetName(asset: EagleWritableAsset) {
    const title = asset.title.trim() || (asset.kind === "image" ? t("lib:generate-image") : asset.kind === "video" ? t("lib:generate-video") : t("lib:generate-audio"));
    if (/\.[a-z0-9]{2,8}$/i.test(title)) return title;
    const extension = asset.kind === "image" ? extensionFromMime(asset.data.mimeType, "png") : asset.kind === "video" ? extensionFromMime(asset.data.mimeType, "mp4") : extensionFromMime(asset.data.mimeType, "mp3");
    return title + "." + extension;
}

function extensionFromMime(mimeType: string, fallback: string) {
    const value = mimeType.toLowerCase();
    if (value.includes("png")) return "png";
    if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
    if (value.includes("webm")) return "webm";
    if (value.includes("quicktime")) return "mov";
    if (value.includes("wav")) return "wav";
    if (value.includes("ogg")) return "ogg";
    if (value.includes("mp4")) return "mp4";
    if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
    return fallback;
}

function withMimeType(blob: Blob, mimeType: string) {
    return mimeType && blob.type !== mimeType ? blob.slice(0, blob.size, mimeType) : blob;
}
async function uploadEagleFile(file: File, baseUrl: string, folderId?: string, signal?: AbortSignal): Promise<ExternalAssetItem> {
    if (file.size > 96 * 1024 * 1024) throw new Error(t("lib:a-single-file-cannot-exceed-96-mb"));
    if (!isEagleMediaType(file.type)) throw new Error(t("lib:eagle-write-back-currently-supports-image-video-and-audio-files"));
    const dataUrl = await fileToDataUrl(file, signal);
    const result = await addEagleItem(baseUrl, {
        url: dataUrl,
        name: file.name,
        folderId,
    });
    const itemId = result.item.id || "eagle:" + nanoid();
    const extension = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
    return {
        id: itemId,
        title: file.name,
        kind: kindFromExtension(extension),
        thumbnailUrl: result.item.id ? eagleItemThumbnailUrl(result.item.id, baseUrl) : undefined,
        fileUrl: result.item.id ? eagleItemFileUrl(result.item.id, baseUrl) : undefined,
        mimeType: file.type || mimeTypeFromExtension(extension),
        bytes: file.size,
        folderId,
        folderIds: folderId ? [folderId] : [],
        metadata: { extension },
    };
}

function isEagleMediaType(mimeType: string) {
    const value = mimeType.toLowerCase();
    return value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/");
}
function fileToDataUrl(file: Blob, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const abort = () => {
            reader.abort();
            cleanup();
            reject(new DOMException(t("lib:request-cancelled-2"), "AbortError"));
        };
        reader.onload = () => {
            cleanup();
            if (typeof reader.result !== "string") {
                reject(new Error(t("lib:unable-to-read-the-files-to-write-2")));
                return;
            }
            resolve(reader.result);
        };
        reader.onerror = () => {
            cleanup();
            reject(new Error(t("lib:unable-to-read-the-files-to-write-2")));
        };
        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        reader.readAsDataURL(file);
    });
}

function toExternalItem(item: EagleItem, baseUrl: string, pathMap: Map<string, string[]>) {
    const kind = kindFromExtension(item.extension);
    return {
        id: item.id,
        title: item.name,
        kind,
        thumbnailUrl: eagleItemThumbnailUrl(item.id, baseUrl),
        fileUrl: eagleItemFileUrl(item.id, baseUrl),
        mimeType: mimeTypeFromExtension(item.extension),
        width: item.width,
        height: item.height,
        bytes: item.size,
        tags: item.tags,
        folderId: item.folderIds[0],
        folderIds: item.folderIds,
        folderPath: item.folderIds[0] ? pathMap.get(item.folderIds[0]) : [],
        description: item.annotation,
        metadata: { extension: item.extension, modificationTime: item.modificationTime, url: item.url, deleted: item.deleted },
    } satisfies ExternalAssetItem;
}

function buildFolderPathMap(folders: EagleFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result = new Map<string, string[]>();
    for (const folder of folders) {
        const path: string[] = [];
        const seen = new Set<string>();
        let current: EagleFolder | undefined = folder;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            path.unshift(current.name);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        result.set(folder.id, path);
    }
    return result;
}

function kindFromExtension(extension: string): Asset["kind"] {
    const value = extension.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"].includes(value)) return "image";
    if (["mp4", "mov", "webm", "mkv", "avi"].includes(value)) return "video";
    if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(value)) return "audio";
    if (["glb", "gltf", "obj", "fbx", "usdz", "blend"].includes(value)) return "model";
    return "model";
}

function mimeTypeFromExtension(extension: string) {
    const value = extension.toLowerCase();
    if (["jpg", "jpeg"].includes(value)) return "image/jpeg";
    if (value === "png") return "image/png";
    if (value === "webp") return "image/webp";
    if (value === "gif") return "image/gif";
    if (value === "svg") return "image/svg+xml";
    if (value === "mp4") return "video/mp4";
    if (value === "webm") return "video/webm";
    if (value === "mp3") return "audio/mpeg";
    if (value === "wav") return "audio/wav";
    if (value === "glb") return "model/gltf-binary";
    return "application/octet-stream";
}


registerPlugin(eagleAssetPlugin);
