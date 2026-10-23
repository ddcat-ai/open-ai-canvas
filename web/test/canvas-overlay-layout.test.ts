import { describe, expect, test } from "bun:test";
import { canvasOverlayBounds, canvasToolbarLayoutLevel, placeCanvasNodePanel, placeCanvasNodeToolbar } from "@/lib/canvas/canvas-overlay-layout";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const image: CanvasNodeData = { id: "image", title: "Image", type: CanvasNodeType.Image, position: { x: 20, y: 500 }, width: 180, height: 160 };

describe("canvas floating overlay layout", () => {
    test("bottom-edge editor stays below its node instead of sticking to the viewport", () => {
        const bounds = canvasOverlayBounds({ width: 1024, height: 720 }, { left: 76, top: 64, bottom: 626 });
        const position = placeCanvasNodePanel(image, { x: 0, y: 0, k: 1 }, bounds, { width: 680, height: 238 });
        expect(position).toEqual({ left: -230, top: 670, placement: "below" });
        expect(placeCanvasNodeToolbar(image, { x: 0, y: 0, k: 1 })).toEqual({ left: 110, top: 470 });
    });

    test("narrow viewport limits editor width without changing its node anchor", () => {
        const bounds = canvasOverlayBounds({ width: 320, height: 320 }, { left: 76, top: 64, bottom: 244 });
        const position = placeCanvasNodePanel(image, { x: -200, y: 100, k: 2 }, bounds, { width: 680, height: 540 });
        expect(position).toEqual({ left: -96, top: 1430, placement: "below" });
        expect(bounds.right - bounds.left).toBe(232);
    });

    test("roomy viewport keeps the below-node anchor and follows live drag and zoom", () => {
        const bounds = canvasOverlayBounds({ width: 1920, height: 1080 });
        const source = { ...image, position: { x: 400, y: 100 } };
        const viewport = { x: 40, y: 20, k: 1.5 };
        const drag = { x: 20, y: 10 };
        expect(placeCanvasNodePanel(source, viewport, bounds, { width: 680, height: 238 }, drag)).toEqual({ left: 465, top: 435, placement: "below" });
        expect(placeCanvasNodeToolbar(source, viewport, drag)).toEqual({ left: 805, top: 155 });
    });

    for (const k of [0.25, 1, 2]) {
        for (const offset of [
            { x: -3000, y: 0 },
            { x: 3000, y: 0 },
            { x: 0, y: -3000 },
            { x: 0, y: 3000 },
        ]) {
            test(`controls follow pan and drag beyond the viewport at zoom ${k}: ${offset.x}, ${offset.y}`, () => {
                const bounds = canvasOverlayBounds({ width: 1024, height: 720 });
                const viewport = { x: 0, y: 0, k };
                const size = { width: 680, height: 238 };
                const panel = placeCanvasNodePanel(image, viewport, bounds, size);
                const toolbar = placeCanvasNodeToolbar(image, viewport);
                const movedViewport = { ...offset, k };
                const drag = { x: offset.x / k, y: offset.y / k };
                const expectedPanel = { ...panel, left: panel.left + offset.x, top: panel.top + offset.y };
                const expectedToolbar = { left: toolbar.left + offset.x, top: toolbar.top + offset.y };
                expect(placeCanvasNodePanel(image, movedViewport, bounds, size)).toEqual(expectedPanel);
                expect(placeCanvasNodePanel(image, viewport, bounds, size, drag)).toEqual(expectedPanel);
                expect(placeCanvasNodeToolbar(image, movedViewport)).toEqual(expectedToolbar);
                expect(placeCanvasNodeToolbar(image, viewport, drag)).toEqual(expectedToolbar);
            });
        }
    }

    test("toolbar folds against actual available width and unfolds only when measured content fits", () => {
        expect(canvasToolbarLayoutLevel(936, [918, 0, 0], 0)).toBe(0);
        expect(canvasToolbarLayoutLevel(840, [918, 0, 0], 0)).toBe(1);
        expect(canvasToolbarLayoutLevel(450, [918, 520, 0], 1)).toBe(2);
        expect(canvasToolbarLayoutLevel(232, [918, 520, 180], 2)).toBe(2);
        expect(canvasToolbarLayoutLevel(600, [918, 520, 180], 2)).toBe(1);
        expect(canvasToolbarLayoutLevel(936, [918, 520, 180], 1)).toBe(0);
    });
});
