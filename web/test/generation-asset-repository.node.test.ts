import assert from "node:assert/strict";
import { test } from "node:test";

import { flushGenerationAssetStorageLocks, insertOrReturnGenerationAsset, withGenerationAssetStorageLock, type GenerationAssetRecord } from "../src/services/generation-asset-repository";
import { generationArtifactStorageKey, loadOrStoreGenerationArtifact } from "../src/services/generation-artifact-sink";

test("generation asset insert waits for persistence and reload returns the same durable row", async () => {
    let assets: GenerationAssetRecord[] = [];
    let durableAssets: GenerationAssetRecord[] = [];
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<void>((resolve) => {
        releasePersistence = resolve;
    });
    let settled = false;

    const inserting = insertOrReturnGenerationAsset({
        storageScope: "test-scope",
        effectKey: "materialize:task-persistence:0",
        assetId: "generation-stable-id",
        createAsset: () => ({
            id: "generation-stable-id",
            metadata: { generationEffectKey: "materialize:task-persistence:0" },
        }),
        updateAssets: (updater) => {
            assets = updater(assets);
        },
        readAssets: () => assets,
        readPersistedAssets: async () => structuredClone(durableAssets),
        persistAssets: async (nextAssets) => {
            await persistenceGate;
            durableAssets = structuredClone(nextAssets);
        },
    }).then((assetId) => {
        settled = true;
        return assetId;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "Agent effect must not complete while persistence is pending");

    releasePersistence();
    const assetId = await inserting;
    assets = structuredClone(durableAssets);

    assert.equal(assets.length, 1);
    assert.equal(assets[0]?.id, assetId);
    assert.equal(assets[0]?.metadata?.generationEffectKey, "materialize:task-persistence:0");
});

test("generation asset insertion does not resurrect a row deleted from durable storage", async () => {
    const deleted = {
        id: "asset-deleted",
        metadata: { title: "stale memory row" },
    } satisfies GenerationAssetRecord;
    let assets: GenerationAssetRecord[] = [deleted];
    let durableAssets: GenerationAssetRecord[] = [];
    let persistenceWrites = 0;

    await insertOrReturnGenerationAsset({
        storageScope: "test-deletion-scope",
        effectKey: "materialize:after-delete:0",
        assetId: "asset-generated",
        createAsset: () => ({
            id: "asset-generated",
            metadata: { generationEffectKey: "materialize:after-delete:0" },
        }),
        updateAssets: (updater) => {
            assets = updater(assets);
        },
        readAssets: () => assets,
        readPersistedAssets: async () => structuredClone(durableAssets),
        persistAssets: async (nextAssets) => {
            persistenceWrites += 1;
            durableAssets = structuredClone(nextAssets);
        },
    });

    assert.deepEqual(
        durableAssets.map((asset) => asset.id),
        ["asset-generated"],
    );
    assert.deepEqual(
        assets.map((asset) => asset.id),
        ["asset-generated"],
    );
    assert.equal(persistenceWrites, 1);
});

test("generation asset replay preserves the hydrated in-memory preview for the same durable row", async () => {
    const effectKey = "materialize:hydrated-preview:0";
    const persisted = {
        id: "asset-hydrated-preview",
        title: "durable title",
        coverUrl: "https://persisted.invalid/preview.png",
        data: { dataUrl: "https://persisted.invalid/preview.png", storageKey: "generation-image:test-scope:hydrated-preview" },
        metadata: { generationEffectKey: effectKey, durableMarker: "durable" },
    } satisfies GenerationAssetRecord & { title: string; coverUrl: string; data: { dataUrl: string; storageKey: string } };
    const hydrated = {
        ...persisted,
        title: "stale hydrated title",
        coverUrl: "blob:hydrated-cover",
        data: { ...persisted.data, dataUrl: "blob:hydrated-preview" },
        metadata: { generationEffectKey: effectKey, durableMarker: "stale" },
    };
    let assets: (typeof hydrated)[] = [hydrated];

    const assetId = await insertOrReturnGenerationAsset({
        storageScope: "test-scope",
        effectKey,
        assetId: persisted.id,
        createAsset: () => {
            throw new Error("existing generation asset must be reused");
        },
        updateAssets: (updater) => {
            assets = updater(assets) as (typeof hydrated)[];
        },
        readAssets: () => assets,
        readPersistedAssets: async () => [persisted],
        persistAssets: async () => {
            throw new Error("existing generation asset must not be rewritten");
        },
    });

    assert.equal(assetId, persisted.id);
    assert.equal(assets[0]?.coverUrl, "blob:hydrated-cover");
    assert.equal(assets[0]?.data.dataUrl, "blob:hydrated-preview");
    assert.equal(assets[0]?.data.storageKey, persisted.data.storageKey);
    assert.equal(assets[0]?.title, "durable title");
    assert.equal(assets[0]?.metadata?.durableMarker, "durable");
});

test("generation asset replay does not carry a blob preview across a changed storage key", async () => {
    const effectKey = "materialize:hydrated-preview-storage-change:0";
    const persisted = {
        id: "asset-hydrated-preview-storage-change",
        coverUrl: "https://persisted.invalid/new-preview.png",
        data: { dataUrl: "https://persisted.invalid/new-preview.png", storageKey: "generation-image:test-scope:new-key" },
        metadata: { generationEffectKey: effectKey },
    } satisfies GenerationAssetRecord & { coverUrl: string; data: { dataUrl: string; storageKey: string } };
    const hydrated = {
        ...persisted,
        coverUrl: "blob:stale-cover",
        data: { dataUrl: "blob:stale-preview", storageKey: "generation-image:test-scope:old-key" },
    };
    let assets: Array<typeof persisted | typeof hydrated> = [hydrated];

    await insertOrReturnGenerationAsset({
        storageScope: "test-scope",
        effectKey,
        assetId: persisted.id,
        createAsset: () => {
            throw new Error("existing generation asset must be reused");
        },
        updateAssets: (updater) => {
            assets = updater(assets as (typeof persisted)[]) as Array<typeof persisted | typeof hydrated>;
        },
        readAssets: () => assets as (typeof persisted)[],
        readPersistedAssets: async () => [persisted],
        persistAssets: async () => {
            throw new Error("existing generation asset must not be rewritten");
        },
    });

    assert.equal(assets[0]?.coverUrl, persisted.coverUrl);
    assert.equal(assets[0]?.data.dataUrl, persisted.data.dataUrl);
    assert.equal(assets[0]?.data.storageKey, persisted.data.storageKey);
});

test("generation asset replay rejects a deterministic row deleted after its base revision", async () => {
    let assets: GenerationAssetRecord[] = [];
    await assert.rejects(
        insertOrReturnGenerationAsset({
            storageScope: "test-tombstone-scope",
            effectKey: "materialize:tombstoned:0",
            assetId: "asset-tombstoned",
            createAsset: () => ({
                id: "asset-tombstoned",
                metadata: { generationEffectKey: "materialize:tombstoned:0" },
            }),
            updateAssets: (updater) => {
                assets = updater(assets);
            },
            readAssets: () => assets,
            readPersistedAssets: async () => [],
            isAssetDeleted: () => true,
            persistAssets: async () => {
                throw new Error("tombstoned generation asset must not be persisted");
            },
        } as Parameters<typeof insertOrReturnGenerationAsset>[0]),
        /the-generated-asset-was-deleted-by-the-user/,
    );
    assert.deepEqual(assets, []);
});

test("concurrent generation asset inserts merge inside a per-scope storage lock", async () => {
    const durableByScope = new Map<string, GenerationAssetRecord[]>();
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
    });
    let firstWriteStartedResolve!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
        firstWriteStartedResolve = resolve;
    });

    const insert = (scope: string, effectKey: string, assetId: string, blockWrite = false) => {
        let assets: GenerationAssetRecord[] = [];
        return insertOrReturnGenerationAsset({
            storageScope: scope,
            effectKey,
            assetId,
            createAsset: () => ({
                id: assetId,
                metadata: { generationEffectKey: effectKey },
            }),
            updateAssets: (updater) => {
                assets = updater(assets);
            },
            readAssets: () => assets,
            readPersistedAssets: async () => structuredClone(durableByScope.get(scope) ?? []),
            persistAssets: async (nextAssets) => {
                if (blockWrite) {
                    firstWriteStartedResolve();
                    await firstWriteGate;
                }
                durableByScope.set(scope, structuredClone(nextAssets));
            },
        });
    };

    const first = insert("account-A", "materialize:concurrent-a:0", "asset-a", true);
    await firstWriteStarted;
    let secondSettled = false;
    const second = insert("account-A", "materialize:concurrent-b:0", "asset-b").then((assetId) => {
        secondSettled = true;
        return assetId;
    });
    let otherScopeSettled = false;
    const otherScope = insert("account-B", "materialize:isolated:0", "asset-other").then(() => {
        otherScopeSettled = true;
    });

    await otherScope;
    assert.equal(otherScopeSettled, true, "another user scope must not wait on account-A's lock");
    assert.equal(secondSettled, false, "same-scope insert must wait for the first write");

    releaseFirstWrite();
    await Promise.all([first, second, otherScope]);

    assert.deepEqual(
        durableByScope
            .get("account-A")
            ?.map((asset) => asset.id)
            .sort(),
        ["asset-a", "asset-b"],
    );
    assert.deepEqual(
        durableByScope.get("account-B")?.map((asset) => asset.id),
        ["asset-other"],
    );
});

test("browser generation asset writes use the storage-level Web Locks boundary", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    const lockNames: string[] = [];
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
            locks: {
                request: async <T>(name: string, callback: () => Promise<T>) => {
                    lockNames.push(name);
                    return callback();
                },
            },
        },
    });

    try {
        await withGenerationAssetStorageLock("account-A", async () => undefined);
        assert.deepEqual(lockNames, ["infinite-canvas:generation-asset-storage-lock:account-A"]);
    } finally {
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        if (originalNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
        else Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
    }
});

test("competing browser generation asset writes fail closed before entering storage without Web Locks", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    let entered = 0;

    try {
        const compete = () =>
            withGenerationAssetStorageLock(
                "account-no-web-locks",
                async () => {
                    entered += 1;
                },
                { requireCrossRealmLock: true },
            );
        await Promise.all([assert.rejects(compete(), /cross-tab-storage-locks/), assert.rejects(compete(), /cross-tab-storage-locks/)]);
        assert.equal(entered, 0, "neither competing generation write may enter the critical section without a cross-tab lock");
    } finally {
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
        else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
        if (originalNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
        else Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
    }
});

test("an aborted generation asset fence prevents the durable catalog write", async () => {
    const controller = new AbortController();
    controller.abort();
    let persistenceWrites = 0;

    await assert.rejects(
        insertOrReturnGenerationAsset({
            storageScope: "aborted-generation-asset",
            effectKey: "materialize:aborted-generation-asset:0",
            assetId: "asset-aborted-generation-asset",
            signal: controller.signal,
            createAsset: () => ({ id: "asset-aborted-generation-asset", metadata: { generationEffectKey: "materialize:aborted-generation-asset:0" } }),
            updateAssets: () => undefined,
            readAssets: () => [],
            readPersistedAssets: async () => [],
            persistAssets: async () => {
                persistenceWrites += 1;
            },
        }),
        (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    assert.equal(persistenceWrites, 0);
});

test("generation asset lock flush drains tails added while the flush is running", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    let firstStartedResolve!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
        firstStartedResolve = resolve;
    });
    const first = withGenerationAssetStorageLock("flush-scope", async () => {
        firstStartedResolve();
        await firstGate;
    });
    await firstStarted;

    let flushSettled = false;
    const flushing = flushGenerationAssetStorageLocks().then(() => {
        flushSettled = true;
    });

    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve;
    });
    let secondStartedResolve!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
        secondStartedResolve = resolve;
    });
    const second = withGenerationAssetStorageLock("flush-scope", async () => {
        secondStartedResolve();
        await secondGate;
    });

    releaseFirst();
    await secondStarted;
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(flushSettled, false, "flush must wait for a tail queued during the active flush");
    } finally {
        releaseSecond();
        await Promise.all([first, second, flushing]);
    }
    assert.equal(flushSettled, true);
});

test("generation artifact sink recovers after ack crash without a second materialization", async () => {
    const durable = new Map<string, { storageKey: string }>();
    const effectKey = "materialize:task-ack-crash:0";
    const storageKey = generationArtifactStorageKey(effectKey, "image", "test-scope");
    let materializations = 0;
    const run = () =>
        loadOrStoreGenerationArtifact({
            effectKey: storageKey,
            read: async (key) => durable.get(key) ?? null,
            materialize: async () => {
                materializations += 1;
                return { storageKey };
            },
            write: async (key, artifact) => {
                durable.set(key, artifact);
            },
        });

    await run();
    // Simulate a process crash after the durable sink succeeded but before the Agent effect ack.
    for (let replay = 0; replay < 3; replay += 1) await run();

    assert.equal(materializations, 1);
    assert.equal(durable.size, 1);
    assert.equal(durable.get(storageKey)?.storageKey, storageKey);
});
