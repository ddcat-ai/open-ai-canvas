import assert from "node:assert/strict";
import { test } from "node:test";

import { insertOrReturnGenerationAsset, type GenerationAssetRecord } from "../src/services/generation-asset-repository";
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

test("generation artifact sink recovers after ack crash without a second materialization", async () => {
    const durable = new Map<string, { storageKey: string }>();
    const effectKey = "materialize:task-ack-crash:0";
    const storageKey = generationArtifactStorageKey(effectKey, "image", "test-scope");
    let materializations = 0;
    const run = () => loadOrStoreGenerationArtifact({
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
