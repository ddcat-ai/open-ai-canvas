import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { normalizeAssetRecord } from "./asset-storage-revision.ts";

test("缺失图片尺寸的历史素材会补齐可渲染数据", () => {
    const asset = normalizeAssetRecord({
        id: "legacy-image",
        kind: "image",
        title: "历史图片",
        coverUrl: "https://example.com/image.png",
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: undefined,
    } as never);

    assert.equal(asset.kind, "image");
    assert.equal(asset.data.width, 0);
    assert.equal(asset.data.height, 0);
    assert.equal(asset.data.dataUrl, "https://example.com/image.png");
});
