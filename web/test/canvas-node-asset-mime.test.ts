import { describe, expect, test } from "bun:test";

import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import { CanvasNodeType } from "@/types/canvas";

describe("canvas node asset MIME normalization", () => {
    test("does not persist media kind labels as MIME types", () => {
        const asset = canvasNodeToAsset({
            id: "image-1",
            type: CanvasNodeType.Image,
            title: "生成图片",
            position: { x: 0, y: 0 },
            width: 1024,
            height: 1024,
            metadata: { content: "data:image/png;base64,YQ==", mimeType: "image", naturalWidth: 1, naturalHeight: 1 },
        }, { canvasId: "canvas-1", source: "canvas-generation" });

        expect(asset?.kind).toBe("image");
        expect(asset && asset.kind === "image" ? asset.data.mimeType : "").toBe("image/png");
    });
});
