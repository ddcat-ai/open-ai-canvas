export type GenerationAssetRecord = {
    id: string;
    metadata?: Record<string, unknown>;
};

type AsyncStorageLock = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

type GenerationStorageLockOptions = {
    requireCrossRealmLock?: boolean;
};

const ASSET_STORAGE_LOCK_PREFIX = "infinite-canvas:generation-asset-storage-lock:";
const ARTIFACT_COMMIT_LOCK_PREFIX = "infinite-canvas:generation-artifact-commit-lock:";
const assetStorageTails = new Map<string, Promise<void>>();
const artifactCommitTails = new Map<string, Promise<void>>();

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

function isBlobUrl(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("blob:");
}

function preserveHydratedPreview<TAsset extends GenerationAssetRecord>(persisted: TAsset, hydrated?: TAsset): TAsset {
    if (!hydrated) return persisted;
    const durable = persisted as TAsset & { coverUrl?: unknown; data?: Record<string, unknown> };
    const current = hydrated as TAsset & { coverUrl?: unknown; data?: Record<string, unknown> };
    const durableStorageKey = durable.data?.storageKey;
    if (typeof durableStorageKey !== "string" || durableStorageKey !== current.data?.storageKey) return persisted;

    const hydratedDataUrl = current.data?.dataUrl;
    const hydratedUrl = current.data?.url;
    const nextData = durable.data && (isBlobUrl(hydratedDataUrl) || isBlobUrl(hydratedUrl)) ? { ...durable.data } : durable.data;
    if (nextData && isBlobUrl(hydratedDataUrl)) nextData.dataUrl = hydratedDataUrl;
    if (nextData && isBlobUrl(hydratedUrl)) nextData.url = hydratedUrl;

    const hydratedCoverUrl = current.coverUrl;
    if (!isBlobUrl(hydratedCoverUrl) && nextData === durable.data) return persisted;
    return {
        ...persisted,
        ...(isBlobUrl(hydratedCoverUrl) ? { coverUrl: hydratedCoverUrl } : {}),
        ...(nextData !== durable.data ? { data: nextData } : {}),
    } as TAsset;
}

function runWithBrowserStorageLock<T>(scope: string, operation: () => Promise<T>, options: GenerationStorageLockOptions) {
    const locks = typeof window !== "undefined" && typeof navigator !== "undefined" ? (navigator.locks as AsyncStorageLock | undefined) : undefined;
    if (locks) return locks.request(`${ASSET_STORAGE_LOCK_PREFIX}${scope}`, operation);
    if (options.requireCrossRealmLock && typeof window !== "undefined" && typeof document !== "undefined") {
        throw new Error("当前浏览器不支持跨标签存储锁，已停止生成素材持久化");
    }
    return operation();
}

export function withGenerationAssetStorageLock<T>(scope: string, operation: () => Promise<T>, options: GenerationStorageLockOptions = {}): Promise<T> {
    const previous = assetStorageTails.get(scope) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => runWithBrowserStorageLock(scope, operation, options));
    const tail = pending.then(
        () => undefined,
        () => undefined,
    );
    assetStorageTails.set(scope, tail);
    void tail.finally(() => {
        if (assetStorageTails.get(scope) === tail) assetStorageTails.delete(scope);
    });
    return pending;
}

export function withGenerationArtifactCommitLock<T>(scope: string, operation: () => Promise<T>, options: GenerationStorageLockOptions = {}): Promise<T> {
    const previous = artifactCommitTails.get(scope) ?? Promise.resolve();
    const pending = previous
        .catch(() => undefined)
        .then(() => {
            const locks = typeof window !== "undefined" && typeof navigator !== "undefined" ? (navigator.locks as AsyncStorageLock | undefined) : undefined;
            if (locks) return locks.request(`${ARTIFACT_COMMIT_LOCK_PREFIX}${scope}`, operation);
            if (options.requireCrossRealmLock && typeof window !== "undefined" && typeof document !== "undefined") {
                throw new Error("当前浏览器不支持跨标签存储锁，已停止生成文件提交");
            }
            return operation();
        });
    const tail = pending.then(
        () => undefined,
        () => undefined,
    );
    artifactCommitTails.set(scope, tail);
    void tail.finally(() => {
        if (artifactCommitTails.get(scope) === tail) artifactCommitTails.delete(scope);
    });
    return pending;
}

export async function flushGenerationAssetStorageLocks() {
    while (assetStorageTails.size || artifactCommitTails.size) await Promise.all([...assetStorageTails.values(), ...artifactCommitTails.values()]);
}

export async function insertOrReturnGenerationAsset<TAsset extends GenerationAssetRecord>(dependencies: {
    storageScope: string;
    effectKey: string;
    assetId: string;
    createAsset: () => TAsset;
    updateAssets: (updater: (assets: TAsset[]) => TAsset[]) => void;
    readAssets: () => TAsset[];
    readPersistedAssets: () => Promise<TAsset[]>;
    isAssetDeleted?: () => boolean;
    persistAssets: (assets: TAsset[]) => Promise<void>;
    requireCrossRealmLock?: boolean;
    signal?: AbortSignal;
}): Promise<string> {
    return withGenerationAssetStorageLock(
        dependencies.storageScope,
        async () => {
            throwIfAborted(dependencies.signal);
            const persistedAssets = await dependencies.readPersistedAssets();
            throwIfAborted(dependencies.signal);
            if (dependencies.isAssetDeleted?.()) throw new Error("生成素材已被用户删除");
            const existing = persistedAssets.find((asset) => asset.metadata?.generationEffectKey === dependencies.effectKey);
            if (existing) {
                const hydratedExisting = dependencies.readAssets().find((asset) => asset.id === existing.id && asset.metadata?.generationEffectKey === dependencies.effectKey);
                dependencies.updateAssets(() => persistedAssets.map((asset) => (asset.id === existing.id ? preserveHydratedPreview(asset, hydratedExisting) : asset)));
                return existing.id;
            }
            if (persistedAssets.some((asset) => asset.id === dependencies.assetId)) {
                throw new Error("生成素材幂等键冲突");
            }
            const assets = [dependencies.createAsset(), ...persistedAssets];
            throwIfAborted(dependencies.signal);
            dependencies.updateAssets(() => assets);
            throwIfAborted(dependencies.signal);
            await dependencies.persistAssets(assets);
            throwIfAborted(dependencies.signal);
            return dependencies.assetId;
        },
        { requireCrossRealmLock: dependencies.requireCrossRealmLock },
    );
}
