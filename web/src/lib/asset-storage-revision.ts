import type { Asset } from "@/stores/use-asset-store";

export type AssetStorageDocument = {
    state: { assets: Asset[] };
    version: number;
    storageRevision: number;
    tombstones: { assets: Record<string, number> };
};

export function normalizeAssetRecord(asset: Asset): Asset {
    if (Array.isArray(asset.tags) && asset.tags.every((tag) => typeof tag === "string")) return asset;
    return {
        ...asset,
        tags: Array.isArray(asset.tags) ? asset.tags.filter((tag): tag is string => typeof tag === "string") : [],
    };
}

function normalizeAssets(assets: Asset[]) {
    return assets.map(normalizeAssetRecord);
}

export function parseAssetStorageDocument(value: string | null, fallback: Asset[] = []): AssetStorageDocument {
    if (!value) {
        return {
            state: { assets: normalizeAssets(fallback) },
            version: 0,
            storageRevision: 0,
            tombstones: { assets: {} },
        };
    }
    const parsed = JSON.parse(value) as {
        state?: { assets?: unknown };
        version?: unknown;
        storageRevision?: unknown;
        tombstones?: { assets?: unknown };
    };
    if (!Array.isArray(parsed.state?.assets)) throw new Error("素材持久状态无效");
    const rawTombstones = parsed.tombstones?.assets;
    const tombstones =
        rawTombstones && typeof rawTombstones === "object" && !Array.isArray(rawTombstones) ? Object.fromEntries(Object.entries(rawTombstones).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) : {};
    return {
        state: { assets: normalizeAssets(parsed.state.assets as Asset[]) },
        version: typeof parsed.version === "number" ? parsed.version : 0,
        storageRevision: typeof parsed.storageRevision === "number" && Number.isFinite(parsed.storageRevision) ? parsed.storageRevision : 0,
        tombstones: { assets: tombstones },
    };
}

export function serializeAssetStorageDocument(document: AssetStorageDocument) {
    return JSON.stringify(document);
}

function deepEqual(left: unknown, right: unknown) {
    if (Object.is(left, right)) return true;
    return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(base: unknown, local: unknown, durable: unknown): unknown {
    if (deepEqual(local, base)) return durable;
    if (deepEqual(durable, base)) return local;
    if (isRecord(base) && isRecord(local) && isRecord(durable)) return mergeRecord(base, local, durable);
    if (!isRecord(base) && isRecord(local) && isRecord(durable)) return mergeRecord({}, local, durable);
    return durable;
}

function mergeRecord(base: Record<string, unknown>, local: Record<string, unknown>, durable: Record<string, unknown>) {
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(durable)])) {
        const baseHas = Object.prototype.hasOwnProperty.call(base, key);
        const localHas = Object.prototype.hasOwnProperty.call(local, key);
        const durableHas = Object.prototype.hasOwnProperty.call(durable, key);
        if (!localHas && baseHas) {
            if (durableHas && !deepEqual(durable[key], base[key])) merged[key] = durable[key];
            continue;
        }
        if (!localHas) {
            if (durableHas) merged[key] = durable[key];
            continue;
        }
        if (!baseHas) {
            merged[key] = durableHas ? mergeValue(undefined, local[key], durable[key]) : local[key];
            continue;
        }
        if (!durableHas) {
            if (!deepEqual(local[key], base[key])) merged[key] = local[key];
            continue;
        }
        merged[key] = mergeValue(base[key], local[key], durable[key]);
    }
    return merged;
}

export function rebaseAssetSnapshot(input: { document: AssetStorageDocument; baseAssets: Asset[]; localAssets: Asset[]; baseRevision: number }) {
    const nextRevision = input.document.storageRevision + 1;
    const tombstones = { assets: { ...input.document.tombstones.assets } };
    const baseById = new Map(input.baseAssets.map((asset) => [asset.id, asset]));
    const localById = new Map(input.localAssets.map((asset) => [asset.id, asset]));
    const durableById = new Map(input.document.state.assets.map((asset) => [asset.id, asset]));
    const assets = [...input.document.state.assets];
    const positions = new Map(assets.map((asset, index) => [asset.id, index]));

    const remove = (id: string) => {
        const index = positions.get(id);
        if (index === undefined) return;
        assets.splice(index, 1);
        positions.clear();
        assets.forEach((asset, position) => positions.set(asset.id, position));
    };
    const set = (asset: Asset) => {
        const index = positions.get(asset.id);
        if (index === undefined) {
            positions.set(asset.id, assets.length);
            assets.push(asset);
        } else {
            assets[index] = asset;
        }
    };

    for (const id of new Set([...baseById.keys(), ...localById.keys()])) {
        const base = baseById.get(id);
        const local = localById.get(id);
        const durable = durableById.get(id);

        if (base && !local) {
            remove(id);
            tombstones.assets[id] = nextRevision;
            continue;
        }
        if (!local || (base && deepEqual(base, local))) continue;
        if (!durable) {
            if (base || (tombstones.assets[id] ?? 0) > input.baseRevision) continue;
            delete tombstones.assets[id];
            set(local);
            continue;
        }
        delete tombstones.assets[id];
        set(mergeRecord((base || {}) as unknown as Record<string, unknown>, local as unknown as Record<string, unknown>, durable as unknown as Record<string, unknown>) as unknown as Asset);
    }

    return {
        state: { assets },
        version: input.document.version,
        storageRevision: nextRevision,
        tombstones,
    } satisfies AssetStorageDocument;
}
