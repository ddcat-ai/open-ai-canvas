import { describe, expect, test } from "bun:test";
import { avoidCanvasNodePanels, canvasNodePanelBounds, canvasOverlayBounds, canvasToolbarLayoutLevel, placeCanvasNodePanel, subscribeCanvasNodePanelBounds, updateCanvasNodePanelBounds } from "@/lib/canvas/canvas-overlay-layout";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const image: CanvasNodeData = { id: "image", title: "Image", type: CanvasNodeType.Image, position: { x: 20, y: 500 }, width: 180, height: 160 };

describe("canvas floating overlay layout", () => {
    test("late composer layout moves the toolbar above its measured 1366px viewport bounds", () => {
        const bounds = canvasOverlayBounds({ width: 1366, height: 768 }, { left: 76, top: 64, bottom: 704 });
        const panel = { left: 247.514, top: 349.538, right: 927.514, bottom: 587.538 };
        const position = avoidCanvasNodePanels({ left: 587.514, top: 567.538 }, { width: 918, height: 44 }, bounds, [panel]);
        expect(position.top).toBeCloseTo(341.538);
        expect(position.top).toBeLessThan(panel.top);
        expect(position.top - 44).toBeGreaterThanOrEqual(bounds.top);
    });

    test("panel resize and removal notify subscribers without repeated identical layouts", () => {
        const container = new EventTarget() as HTMLElement;
        const panel = {} as HTMLElement;
        const anchor = { left: 587.514, top: 567.538 };
        const safeArea = canvasOverlayBounds({ width: 1366, height: 768 }, { left: 76, top: 64, bottom: 704 });
        let calls = 0;
        let toolbar = anchor;
        const unsubscribe = subscribeCanvasNodePanelBounds(container, () => {
            calls++;
            toolbar = avoidCanvasNodePanels(anchor, { width: 918, height: 44 }, safeArea, canvasNodePanelBounds(container));
        });
        const first = { left: 247.514, top: 397.538, right: 927.514, bottom: 587.538 };
        updateCanvasNodePanelBounds(container, panel, first);
        updateCanvasNodePanelBounds(container, panel, { ...first });
        expect(calls).toBe(1);
        expect(toolbar.top).toBeCloseTo(389.538);
        updateCanvasNodePanelBounds(container, panel, { ...first, top: 349.538 });
        expect(calls).toBe(2);
        expect(toolbar.top).toBeCloseTo(341.538);
        updateCanvasNodePanelBounds(container, panel, null);
        expect(calls).toBe(3);
        expect(toolbar).toEqual(anchor);
        expect(canvasNodePanelBounds(container)).toEqual([]);
        unsubscribe();
        updateCanvasNodePanelBounds(container, panel, first);
        expect(calls).toBe(3);
        updateCanvasNodePanelBounds(container, panel, null);
    });

    test("bottom-edge image editor stays above the dock and outside the workspace rail", () => {
        const bounds = canvasOverlayBounds({ width: 1024, height: 720 }, { left: 76, top: 64, bottom: 626 });
        const position = placeCanvasNodePanel(image, { x: 0, y: 0, k: 1 }, bounds, { width: 680, height: 238 });
        expect(position.placement).toBe("above");
        expect(position.left).toBeGreaterThanOrEqual(76);
        expect(position.left + 680).toBeLessThanOrEqual(1012);
        expect(position.top).toBeGreaterThanOrEqual(64);
        expect(position.top + 238).toBeLessThanOrEqual(626);
    });

    test("oversized editor is anchored to the usable area in a narrow short viewport", () => {
        const bounds = canvasOverlayBounds({ width: 320, height: 320 }, { left: 76, top: 64, bottom: 244 });
        const position = placeCanvasNodePanel(image, { x: -200, y: 100, k: 2 }, bounds, { width: 680, height: 540 });
        expect(position.left).toBe(76);
        expect(position.top).toBe(64);
        expect(bounds.right - bounds.left).toBe(232);
        expect(bounds.bottom - bounds.top).toBe(180);
    });

    test("roomy viewport keeps the below-node anchor and follows live drag and zoom", () => {
        const bounds = canvasOverlayBounds({ width: 1920, height: 1080 });
        const source = { ...image, position: { x: 400, y: 100 } };
        const position = placeCanvasNodePanel(source, { x: 40, y: 20, k: 1.5 }, bounds, { width: 680, height: 238 }, { x: 20, y: 10 });
        expect(position).toEqual({ left: 465, top: 435, placement: "below" });
    });

    test("toolbar folds against actual available width and unfolds only when measured content fits", () => {
        expect(canvasToolbarLayoutLevel(936, [918, 0, 0], 0)).toBe(0);
        expect(canvasToolbarLayoutLevel(840, [918, 0, 0], 0)).toBe(1);
        expect(canvasToolbarLayoutLevel(450, [918, 520, 0], 1)).toBe(2);
        expect(canvasToolbarLayoutLevel(232, [918, 520, 180], 2)).toBe(2);
        expect(canvasToolbarLayoutLevel(600, [918, 520, 180], 2)).toBe(1);
        expect(canvasToolbarLayoutLevel(936, [918, 520, 180], 1)).toBe(0);
    });
});
