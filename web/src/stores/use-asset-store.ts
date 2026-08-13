import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage, localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { insertOrReturnGenerationAsset } from "@/services/generation-asset-repository";

export type AssetKind = "text" | "image" | "video" | "audio" | "model" | "entity";
export type AssetCategory = "character" | "environment" | "wardrobe" | "prop" | "weapon" | "style" | "other";
export type AssetStatus = "draft" | "review" | "confirmed" | "archived";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; durationMs?: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; durationMs?: number; bytes: number; mimeType: string } };
export type ModelAsset = AssetBase<"model"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string; fileName: string } };
export type EntityAsset = AssetBase<"entity"> & { data: { definition: Record<string, unknown> } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset | ModelAsset | EntityAsset;
export type NewAsset =
    | Omit<TextAsset, "id" | "createdAt" | "updatedAt">
    | Omit<ImageAsset, "id" | "createdAt" | "updatedAt">
    | Omit<VideoAsset, "id" | "createdAt" | "updatedAt">
    | Omit<AudioAsset, "id" | "createdAt" | "updatedAt">
    | Omit<ModelAsset, "id" | "createdAt" | "updatedAt">
    | Omit<EntityAsset, "id" | "createdAt" | "updatedAt">;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    category?: AssetCategory;
    status?: AssetStatus;
    primaryVersionId?: string;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: NewAsset) => string;
    addGenerationAsset: (effectKey: string, asset: NewAsset) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

export const ASSET_STORE_KEY = "infinite-canvas:asset_store";

let assetPersistenceTail = Promise.resolve();
let assetWriteScopeOverride: string | undefined;
const assetOperations = new Set<Promise<unknown>>();

function persistAssetStateForScope(name: string, value: StorageValue<AssetStore>, scope: string) {
    // scope 在入队时冻结；排队期间账号切换不能把旧账号快照写入新账号命名空间。
    const storage = localForageStorageForScope(scope);
    const pending = assetPersistenceTail.then(async () => {
        await storage.setItem(name, JSON.stringify(value));
    });
    assetPersistenceTail = pending.catch(() => undefined);
    return pending;
}

function persistAssetState(name: string, value: StorageValue<AssetStore>) {
    return persistAssetStateForScope(name, value, assetWriteScopeOverride ?? getActiveUserScope());
}

function trackAssetOperation<T>(operation: Promise<T>) {
    assetOperations.add(operation);
    void operation.finally(() => assetOperations.delete(operation)).catch(() => undefined);
    return operation;
}

export async function flushAssetStorePersistence() {
    while (assetOperations.size) await Promise.all([...assetOperations]);
    await assetPersistenceTail;
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                // 视频和音频的数据结构不同，分别缩窄以保持 Asset 判别联合关系。
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "model" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey)
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: persistAssetState,
    removeItem: (name) => localForageStorage.removeItem(name),
};

async function generationAssetId(effectKey: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(effectKey));
    return `generation_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            addGenerationAsset: (effectKey, asset) => {
                const scope = getActiveUserScope();
                return trackAssetOperation((async () => {
                    const id = await generationAssetId(effectKey);
                    return insertOrReturnGenerationAsset<Asset>({
                        effectKey,
                        assetId: id,
                        createAsset: () => {
                            const now = new Date().toISOString();
                            return {
                                ...asset,
                                id,
                                createdAt: now,
                                updatedAt: now,
                                metadata: { ...asset.metadata, generationEffectKey: effectKey },
                            } as Asset;
                        },
                        updateAssets: (updater) => {
                            const previousScope = assetWriteScopeOverride;
                            assetWriteScopeOverride = scope;
                            try {
                                set((state) => ({ assets: updater(state.assets) }));
                            } finally {
                                assetWriteScopeOverride = previousScope;
                            }
                        },
                        readAssets: () => get().assets,
                        persistAssets: (assets) => persistAssetStateForScope(ASSET_STORE_KEY, {
                            state: { assets } as StorageValue<AssetStore>["state"],
                            version: 0,
                        }, scope),
                    });
                })());
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
