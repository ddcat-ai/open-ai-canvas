import { describe, expect, test } from "bun:test";

import { ensureMediaNodeMinimumSize, fitVideoNodeToSource } from "../src/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function videoNode(overrides: Partial<CanvasNodeData> = {}, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id: "video-1",
        type: CanvasNodeType.Video,
        title: "视频",
        position: { x: 0, y: 0 },
        width: 720,
        height: 405,
        metadata: { content: "https://example.com/a.mp4", status: "success", ...metadata },
        ...overrides,
    };
}

describe("canvas video node sizing", () => {
    test("turns a default 16:9 box into a portrait box for a 9:16 video", () => {
        const fitted = fitVideoNodeToSource(videoNode(), 432, 768);
        expect(fitted.width).toBeLessThan(fitted.height);
        expect(fitted.width / fitted.height).toBeCloseTo(432 / 768, 3);
        // 保持中心点不变。
        expect(fitted.position.x + fitted.width / 2).toBeCloseTo(360, 3);
        expect(fitted.position.y + fitted.height / 2).toBeCloseTo(202.5, 3);
    });

    test("keeps nodes whose ratio already matches, and respects manual, free and locked sizes", () => {
        const node = videoNode();
        expect(fitVideoNodeToSource(node, 1280, 720)).toBe(node);
        for (const flag of ["manualSize", "freeResize", "locked"] as const) {
            const pinned = videoNode({}, { [flag]: true });
            expect(fitVideoNodeToSource(pinned, 432, 768)).toBe(pinned);
        }
        expect(fitVideoNodeToSource(node, 0, 0)).toBe(node);
    });

    test("a small first-frame poster yields the same box as the full video", () => {
        const fromPoster = fitVideoNodeToSource(videoNode(), 225, 400);
        const fromVideo = fitVideoNodeToSource(videoNode(), 1080, 1920);
        expect(fromPoster.width).toBeCloseTo(fromVideo.width, 6);
        expect(fromPoster.height).toBeCloseTo(fromVideo.height, 6);
    });

    test("reload normalisation uses recorded natural size, falling back to the first-frame size", () => {
        const fromNatural = ensureMediaNodeMinimumSize(videoNode({}, { naturalWidth: 768, naturalHeight: 1366 }));
        expect(fromNatural.width).toBeLessThan(fromNatural.height);
        const fromPoster = ensureMediaNodeMinimumSize(videoNode({}, { videoPreview: { content: "p.png", width: 225, height: 400 } }));
        expect(fromPoster.width).toBeLessThan(fromPoster.height);
        const unknown = videoNode();
        expect(ensureMediaNodeMinimumSize(unknown)).toBe(unknown);
    });
});
