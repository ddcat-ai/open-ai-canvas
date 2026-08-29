import { describe, expect, test } from "bun:test";

import { normalizeAssetRecord, parseAssetStorageDocument } from "@/lib/asset-storage-revision";
import type { Asset } from "@/stores/use-asset-store";

const legacyAsset = {
    id: "legacy-image",
    kind: "image",
    title: "旧素材",
    coverUrl: "",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    data: { dataUrl: "opaque://legacy", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
} as Asset;

describe("asset storage revision", () => {
    test("normalizes missing and malformed tags on legacy assets", () => {
        expect(normalizeAssetRecord(legacyAsset).tags).toEqual([]);
        expect(normalizeAssetRecord({ ...legacyAsset, tags: ["角色", 1, null] } as unknown as Asset).tags).toEqual(["角色"]);
    });

    test("normalizes legacy assets while parsing persisted storage", () => {
        const document = parseAssetStorageDocument(JSON.stringify({
            state: { assets: [legacyAsset] },
            version: 1,
            storageRevision: 3,
            tombstones: { assets: {} },
        }));

        expect(document.state.assets[0]?.tags).toEqual([]);
        expect(() => document.state.assets[0]?.tags.join(" ")).not.toThrow();
    });
});
