import { describe, expect, test } from "bun:test";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType } from "@/types/canvas";
import { ensureMediaNodeMinimumSize, fitImageNodeSize, fitNodeSize, IMAGE_NODE_MAX_SIZE, IMAGE_NODE_MIN_SIZE, MEDIA_NODE_MIN_SIZE, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";

describe("canvas image node sizing", () => {
    test("uses the TapNow-sized image default", () => {
        expect(NODE_DEFAULT_SIZE[CanvasNodeType.Image]).toMatchObject({ width: 250, height: 250 });
        expect(NODE_DEFAULT_SIZE[CanvasNodeType.Text]).toMatchObject({ width: 250, height: 250 });
        expect(NODE_DEFAULT_SIZE[CanvasNodeType.Video]).toMatchObject({ width: 444, height: 250 });
        expect(NODE_DEFAULT_SIZE[CanvasNodeType.Audio]).toMatchObject({ width: 444, height: 250 });
    });

    test("fits a landscape image inside the compact image bounds", () => {
        const size = fitImageNodeSize(1920, 1080);
        expect(size.width).toBeCloseTo(IMAGE_NODE_MAX_SIZE.width);
        expect(size.height).toBe(250);
        expect(size.width).toBeLessThan(580);
    });

    test("keeps a portrait image visible without restoring the old oversized minimum", () => {
        const size = fitImageNodeSize(1080, 1920);
        expect(size.width).toBeGreaterThanOrEqual(IMAGE_NODE_MIN_SIZE.width);
        expect(size.height).toBeGreaterThanOrEqual(IMAGE_NODE_MIN_SIZE.height);
        expect(size.width).toBe(IMAGE_NODE_MIN_SIZE.width);
    });

    test("fits video output inside the compact media bounds", () => {
        const size = fitNodeSize(1920, 1080, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
        expect(size.width).toBeCloseTo(VIDEO_NODE_MAX_SIZE.width);
        expect(size.height).toBe(250);
        expect(MEDIA_NODE_MIN_SIZE).toMatchObject({ width: 250, height: 250 });
    });

    test("compacts legacy image defaults while preserving manual layouts", () => {
        const legacy = { id: "legacy", type: CanvasNodeType.Image, title: "图片", position: { x: 100, y: 200 }, width: 720, height: 405, metadata: { content: "image", naturalWidth: 1920, naturalHeight: 1080 } };
        const compacted = ensureMediaNodeMinimumSize(legacy);
        expect(compacted.width).toBeCloseTo(IMAGE_NODE_MAX_SIZE.width);
        expect(compacted.height).toBe(250);

        const manual = { ...legacy, id: "manual", metadata: { ...legacy.metadata, manualSize: true } };
        expect(ensureMediaNodeMinimumSize(manual)).toEqual(manual);
    });
});
