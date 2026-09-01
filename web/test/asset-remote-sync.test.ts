import { describe, expect, test } from "bun:test";

import { assetForRemoteSync } from "@/lib/asset-remote-sync";
import type { Asset } from "@/stores/use-asset-store";

function imageAsset(primaryVersionId?: string): Asset {
    return {
        id: "asset-1",
        kind: "image",
        title: "测试素材",
        coverUrl: "opaque://asset",
        tags: [],
        primaryVersionId,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        data: { dataUrl: "opaque://asset", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
    };
}

describe("asset remote sync", () => {
    test("removes an invalid historical primary version id only from the remote payload", () => {
        const source = imageAsset("generation-result:" + "x".repeat(40));

        const remote = assetForRemoteSync(source);

        expect(remote.primaryVersionId).toBeUndefined();
        expect(source.primaryVersionId).toBe("generation-result:" + "x".repeat(40));
        expect(remote).not.toBe(source);
    });

    test("preserves a valid backend version uuid", () => {
        const source = imageAsset("123e4567-e89b-12d3-a456-426614174000");

        expect(assetForRemoteSync(source)).toBe(source);
        expect(source.primaryVersionId).toBe("123e4567-e89b-12d3-a456-426614174000");
    });
});
