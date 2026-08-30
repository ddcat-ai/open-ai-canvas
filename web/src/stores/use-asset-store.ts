import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { normalizeAssetRecord, parseAssetStorageDocument, rebaseAssetSnapshot, serializeAssetStorageDocument, type AssetStorageDocument } from "@/lib/asset-storage-revision";
import { parseCanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { cleanupUnusedImages, collectImageStorageKeys, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, collectMediaStorageKeys, resolveMediaUrl } from "@/services/file-storage";
import { flushGenerationAssetStorageLocks, insertOrReturnGenerationAsset, withGenerationArtifactCommitLock, withGenerationAssetStorageLock } from "@/services/generation-asset-repository";
import { CANVAS_STORE_KEY, commitPendingCanvasStorePersistenceLocked, pendingCanvasStorePersistence, withCanvasStorePersistenceLock } from "@/stores/canvas/use-canvas-store";

export type AssetKind = "text" | "image" | "video" | "audio" | "model" | "entity";
export type AssetCategory = "character" | "environment" | "wardrobe" | "prop" | "weapon" | "style" | "other";
export type AssetStatus = "draft" | "review" | "confirmed" | "archived";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; durationMs?: number; hasAudio?: boolean; bytes: number; mimeType: string } };
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
    addGenerationAsset: (effectKey: string, asset: NewAsset, signal?: AbortSignal) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => Promise<void>;
};

export const ASSET_STORE_KEY = "infinite-canvas:asset_store";

type PersistedAssetState = Pick<AssetStore, "assets">;
type ObservedAssetPersist = {
    assets: Asset[];
    revision: number;
};

type QueuedAssetPersist = {
    name: string;
    scope: string;
    baseAssets: Asset[];
    baseRevision: number;
    assets: Asset[];
    token: number;
};

let suppressAssetStorePersistence = 0;
const assetMemoryStates = new Map<string, PersistedAssetState>();
const observedAssetPersists = new Map<string, ObservedAssetPersist>();
const queuedAssetPersists = new Map<string, QueuedAssetPersist>();
const assetPersistTokens = new Map<string, number>();
const assetOperations = new Set<Promise<unknown>>();
const generationAssetFailures = new Map<string, unknown>();

function recordAssetStorageDocument(scope: string, document: AssetStorageDocument) {
    observedAssetPersists.set(scope, {
        assets: document.state.assets,
        revision: document.storageRevision,
    });
}

function withAssetStorePersistenceSuppressed<T>(operation: () => T) {
    suppressAssetStorePersistence += 1;
    try {
        return operation();
    } finally {
        suppressAssetStorePersistence -= 1;
    }
}

async function commitPendingAssetStorePersistenceLocked(scope: string) {
    const storage = localForageStorageForScope(scope);
    let committed: AssetStorageDocument | null = null;

    while (true) {
        const queued = queuedAssetPersists.get(scope);
        if (!queued) return committed;

        const durable = parseAssetStorageDocument(await storage.getItem(queued.name), queued.baseAssets);
        const rebased = rebaseAssetSnapshot({
            document: durable,
            baseAssets: queued.baseAssets,
            localAssets: queued.assets,
            baseRevision: queued.baseRevision,
        });
        await storage.setItem(queued.name, serializeAssetStorageDocument(rebased));
        committed = rebased;
        recordAssetStorageDocument(scope, rebased);

        const latest = queuedAssetPersists.get(scope);
        if (!latest || latest.token === queued.token) {
            if (latest?.token === queued.token) queuedAssetPersists.delete(scope);
            return committed;
        }

        latest.baseAssets = queued.assets;
        latest.baseRevision = rebased.storageRevision;
    }
}

async function writeQueuedAssetPersist(scope: string, _token: number) {
    await withGenerationAssetStorageLock(scope, () => commitPendingAssetStorePersistenceLocked(scope));
}

async function readPersistedAssetDocumentForScope(scope: string) {
    return parseAssetStorageDocument(await localForageStorageForScope(scope).getItem(ASSET_STORE_KEY));
}

function trackAssetOperation<T>(operation: Promise<T>) {
    assetOperations.add(operation);
    void operation.finally(() => assetOperations.delete(operation)).catch(() => undefined);
    return operation;
}

function persistAssetState(name: string, value: StorageValue<AssetStore>) {
    const scope = getActiveUserScope();
    const nextAssets = value.state.assets.map(normalizeAssetRecord);
    const queued = queuedAssetPersists.get(scope);
    const observed = observedAssetPersists.get(scope);
    const baseAssets = assetMemoryStates.get(scope)?.assets ?? observed?.assets ?? [];
    assetMemoryStates.set(scope, { assets: nextAssets });
    if (suppressAssetStorePersistence) return;

    const token = (assetPersistTokens.get(scope) ?? 0) + 1;
    assetPersistTokens.set(scope, token);
    queuedAssetPersists.set(scope, {
        name,
        scope,
        baseAssets: queued?.baseAssets ?? baseAssets,
        baseRevision: queued?.baseRevision ?? observed?.revision ?? 0,
        assets: nextAssets,
        token,
    });
    return trackAssetOperation(writeQueuedAssetPersist(scope, token));
}

function generationAssetFailureKey(scope: string, effectKey: string) {
    return `${scope}\0${effectKey}`;
}

function trackGenerationAssetOperation<T>(scope: string, effectKey: string, operation: Promise<T>) {
    const failureKey = generationAssetFailureKey(scope, effectKey);
    return trackAssetOperation(
        operation.then(
            (value) => {
                generationAssetFailures.delete(failureKey);
                return value;
            },
            (error) => {
                throw error;
            },
        ),
    );
}

export async function flushAssetStorePersistence() {
    while (true) {
        if (assetOperations.size) {
            await Promise.all([...assetOperations]);
            continue;
        }

        const writes = [...queuedAssetPersists.values()].map(({ scope, token }) => writeQueuedAssetPersist(scope, token));
        if (writes.length) {
            await Promise.all(writes);
            continue;
        }

        await flushGenerationAssetStorageLocks();
        if (!assetOperations.size && !queuedAssetPersists.size) break;
    }

    const failure = generationAssetFailures.values().next();
    if (!failure.done) throw failure.value;
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const scope = getActiveUserScope();
        const value = await localForageStorageForScope(scope).getItem(name);
        if (!value) {
            assetMemoryStates.set(scope, { assets: [] });
            observedAssetPersists.set(scope, { assets: [], revision: 0 });
            return null;
        }
        const document = parseAssetStorageDocument(value);
        // 持久化恢复只恢复结构化记录，不能为每个 resource: key 逐条读取资源元数据或 Blob。
        // 远程资源直接使用受鉴权的 file URL；本地 legacy key 仍恢复为 Blob URL，避免兼容性回归。
        const assets = await Promise.all(document.state.assets.map((asset) => normalizePersistedAsset(asset)));
        const hydratedDocument = { ...document, state: { assets } };
        assetMemoryStates.set(scope, { assets });
        recordAssetStorageDocument(scope, hydratedDocument);
        return hydratedDocument as unknown as StorageValue<AssetStore>;
    },
    setItem: persistAssetState,
    removeItem: (name) => {
        const scope = getActiveUserScope();
        return localForageStorageForScope(scope).removeItem(name);
    },
};

async function normalizePersistedAsset(asset: Asset): Promise<Asset> {
    asset = normalizeAssetRecord(asset);
    const storageKey = "data" in asset && asset.data && "storageKey" in asset.data ? asset.data.storageKey : undefined;
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (resourceId) {
        const url = resourceFileUrl(resourceId);
        if (asset.kind === "video" || asset.kind === "audio" || asset.kind === "model") return { ...asset, data: { ...asset.data, url } } as Asset;
        if (asset.kind === "image") return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, dataUrl: url } };
    }

    // 非 resource: key 是早期本地存储格式，必须继续从 localForage 恢复，
    // 但只在确有本地 key 时读取，不让远程资源重新走逐条网络查询。
    if (asset.kind === "video" && storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(storageKey, asset.data.url) } };
    if (asset.kind === "audio" && storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(storageKey, asset.data.url) } };
    if (asset.kind === "model" && storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(storageKey, asset.data.url) } };
    if (asset.kind !== "image") return asset;
    if (storageKey) {
        return {
            ...asset,
            coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(storageKey, asset.coverUrl) : asset.coverUrl,
            data: { ...asset.data, dataUrl: await resolveImageUrl(storageKey, asset.data.dataUrl) },
        };
    }
    if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
    const image = await uploadImage(asset.data.dataUrl);
    return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
}

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
                set((state) => ({ assets: [normalizeAssetRecord({ ...asset, id, createdAt: now, updatedAt: now } as Asset), ...state.assets] }));
                return id;
            },
            addGenerationAsset: (effectKey, asset, signal) => {
                const scope = getActiveUserScope();
                const publicationBase = observedAssetPersists.get(scope) ?? { assets: get().assets, revision: 0 };
                return trackGenerationAssetOperation(
                    scope,
                    effectKey,
                    (async () => {
                        const id = await generationAssetId(effectKey);
                        let persistedDocument: AssetStorageDocument | null = null;
                        return insertOrReturnGenerationAsset<Asset>({
                            storageScope: scope,
                            effectKey,
                            assetId: id,
                            createAsset: () => {
                                const now = new Date().toISOString();
                                return normalizeAssetRecord({
                                    ...asset,
                                    id,
                                    createdAt: now,
                                    updatedAt: now,
                                    metadata: { ...asset.metadata, generationEffectKey: effectKey },
                                } as Asset);
                            },
                            updateAssets: (updater) => {
                                withAssetStorePersistenceSuppressed(() => {
                                    set((state) => {
                                        if (!persistedDocument) return { assets: updater(state.assets) };
                                        const liveDocument = rebaseAssetSnapshot({
                                            document: persistedDocument,
                                            baseAssets: publicationBase.assets,
                                            localAssets: state.assets,
                                            baseRevision: publicationBase.revision,
                                        });
                                        const generationAssets = updater(persistedDocument.state.assets);
                                        const published = rebaseAssetSnapshot({
                                            document: liveDocument,
                                            baseAssets: persistedDocument.state.assets,
                                            localAssets: generationAssets,
                                            baseRevision: persistedDocument.storageRevision,
                                        });
                                        return { assets: published.state.assets };
                                    });
                                });
                            },
                            readAssets: () => get().assets,
                            readPersistedAssets: async () => {
                                try {
                                    await commitPendingAssetStorePersistenceLocked(scope);
                                    persistedDocument = await readPersistedAssetDocumentForScope(scope);
                                    recordAssetStorageDocument(scope, persistedDocument);
                                    return persistedDocument.state.assets;
                                } catch (error) {
                                    generationAssetFailures.set(generationAssetFailureKey(scope, effectKey), error);
                                    throw error;
                                }
                            },
                            isAssetDeleted: () => Boolean(persistedDocument?.tombstones.assets[id]),
                            requireCrossRealmLock: true,
                            signal,
                            persistAssets: async (assets) => {
                                const durable = persistedDocument ?? (await readPersistedAssetDocumentForScope(scope));
                                const nextDocument: AssetStorageDocument = {
                                    ...durable,
                                    state: { assets },
                                    storageRevision: durable.storageRevision + 1,
                                };
                                try {
                                    await localForageStorageForScope(scope).setItem(ASSET_STORE_KEY, serializeAssetStorageDocument(nextDocument));
                                } catch (error) {
                                    generationAssetFailures.set(generationAssetFailureKey(scope, effectKey), error);
                                    throw error;
                                }
                                persistedDocument = nextDocument;
                                recordAssetStorageDocument(scope, nextDocument);
                            },
                        });
                    })(),
                );
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? normalizeAssetRecord({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: async (id) => {
                let remainingAssets: Asset[] = [];
                let removedAsset: Asset | undefined;
                set((state) => {
                    removedAsset = state.assets.find((asset) => asset.id === id);
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    remainingAssets = assets;
                    return { assets };
                });
                // 没有本地媒体定位时没有需要由该删除动作回收的 Blob；跳过全库扫描，
                // 避免纯文本/远程资源删除依赖浏览器 IndexedDB 驱动。
                if (!removedAsset || (!collectImageStorageKeys(removedAsset).size && !collectMediaStorageKeys(removedAsset).size)) return;
                await get().cleanupImages({ assets: remainingAssets });
            },
            replaceAssets: (assets) => set({ assets: assets.map(normalizeAssetRecord) }),
            cleanupImages: async (extra) => {
                const scope = getActiveUserScope();
                const frozenExtraImageKeys = collectImageStorageKeys(extra);
                const frozenExtraMediaKeys = collectMediaStorageKeys(extra);
                await new Promise<void>((resolve, reject) => {
                    window.setTimeout(() =>
                        withGenerationArtifactCommitLock(scope, async () => {
                            // 固定锁序：artifact -> Canvas（释放）-> Asset，避免跨 store 锁重入。
                            const canvasProjects = await withCanvasStorePersistenceLock(scope, async () => {
                                await commitPendingCanvasStorePersistenceLocked(scope);
                                const durableCanvas = parseCanvasStorageDocument(await localForageStorageForScope(scope).getItem(CANVAS_STORE_KEY));
                                return pendingCanvasStorePersistence(scope)?.projects ?? durableCanvas.state.projects;
                            });
                            await withGenerationAssetStorageLock(scope, async () => {
                                await commitPendingAssetStorePersistenceLocked(scope);
                                const durableAssets = (await readPersistedAssetDocumentForScope(scope)).state.assets;
                                const references = { projects: canvasProjects, assets: durableAssets };
                                const imageKeys = new Set([...frozenExtraImageKeys, ...collectImageStorageKeys(references)]);
                                const mediaKeys = new Set([...frozenExtraMediaKeys, ...collectMediaStorageKeys(references)]);
                                await cleanupUnusedImages(
                                    [...imageKeys].map((storageKey) => ({ storageKey })),
                                    scope,
                                );
                                await cleanupUnusedMedia(
                                    [...mediaKeys].map((storageKey) => ({ storageKey })),
                                    scope,
                                );
                            });
                        }).then(resolve, reject),
                    );
                });
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
