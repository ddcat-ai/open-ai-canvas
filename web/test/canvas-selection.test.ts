import { describe, expect, test } from "bun:test";

import { applyCanvasSelectionStrategy, canvasSelectionHitsBounds, createCanvasSelectionBounds, createCanvasSelectionSpatialIndexCache, resolveCanvasPointerIntent, resolveCanvasSelectionHitMode, resolveCanvasSelectionPreviewDelta, resolveCanvasSelectionStrategy } from "@/lib/canvas/canvas-selection";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas selection semantics", () => {
    test("maps modifiers to replace, add, toggle, and subtract strategies", () => {
        expect(resolveCanvasSelectionStrategy({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe("replace");
        expect(resolveCanvasSelectionStrategy({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: true })).toBe("add");
        expect(resolveCanvasSelectionStrategy({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe("toggle");
        expect(resolveCanvasSelectionStrategy({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false })).toBe("toggle");
        expect(resolveCanvasSelectionStrategy({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe("subtract");
    });

    test("uses containment from left to right and intersection from right to left", () => {
        expect(resolveCanvasSelectionHitMode(0, 100)).toBe("contain");
        expect(resolveCanvasSelectionHitMode(100, 0)).toBe("intersect");
        expect(createCanvasSelectionBounds(100, 80, 0, 20)).toEqual({ left: 0, top: 20, right: 100, bottom: 80 });
    });

    test("distinguishes fully contained nodes from partially intersecting nodes", () => {
        const selection = { left: 0, top: 0, right: 100, bottom: 100 };
        const contained = { left: 10, top: 10, right: 90, bottom: 90 };
        const partial = { left: 80, top: 80, right: 120, bottom: 120 };

        expect(canvasSelectionHitsBounds(selection, contained, "contain")).toBe(true);
        expect(canvasSelectionHitsBounds(selection, partial, "contain")).toBe(false);
        expect(canvasSelectionHitsBounds(selection, partial, "intersect")).toBe(true);
    });

    test("applies all four selection strategies against the gesture-start snapshot", () => {
        const initial = ["a", "b"];
        const hits = ["b", "c"];

        expect([...applyCanvasSelectionStrategy(initial, hits, "replace")]).toEqual(["b", "c"]);
        expect([...applyCanvasSelectionStrategy(initial, hits, "add")]).toEqual(["a", "b", "c"]);
        expect([...applyCanvasSelectionStrategy(initial, hits, "toggle")]).toEqual(["a", "c"]);
        expect([...applyCanvasSelectionStrategy(initial, hits, "subtract")]).toEqual(["a"]);
    });

    test("derives transient include/remove markers without cloning the full selection", () => {
        const initial = new Set(["a", "b"]);
        const hits = new Set(["b", "c"]);

        expect(resolveCanvasSelectionPreviewDelta(initial, hits, "replace")).toEqual({ includeNodeIds: new Set(["c"]), removeNodeIds: new Set(["a"]) });
        expect(resolveCanvasSelectionPreviewDelta(initial, hits, "add")).toEqual({ includeNodeIds: new Set(["c"]), removeNodeIds: new Set() });
        expect(resolveCanvasSelectionPreviewDelta(initial, hits, "toggle")).toEqual({ includeNodeIds: new Set(["c"]), removeNodeIds: new Set(["b"]) });
        expect(resolveCanvasSelectionPreviewDelta(initial, hits, "subtract")).toEqual({ includeNodeIds: new Set(), removeNodeIds: new Set(["b"]) });
    });

    test("routes default mouse selection without stealing trackpad or temporary hand gestures", () => {
        const pointer = { altKey: false, background: true, boxSelectEnabled: true, button: 0, ctrlKey: false, metaKey: false, pointerType: "mouse", shiftKey: false, spacePressed: false };
        expect(resolveCanvasPointerIntent(pointer)).toBe("select");
        expect(resolveCanvasPointerIntent({ ...pointer, spacePressed: true })).toBe("pan");
        expect(resolveCanvasPointerIntent({ ...pointer, button: 1 })).toBe("pan");
        expect(resolveCanvasPointerIntent({ ...pointer, pointerType: "touch" })).toBe("pan");
        expect(resolveCanvasPointerIntent({ ...pointer, background: false })).toBe("ignore");
        expect(resolveCanvasPointerIntent({ ...pointer, background: false, spacePressed: true })).toBe("pan");
        expect(resolveCanvasPointerIntent({ ...pointer, background: false, button: 1 })).toBe("pan");
        expect(resolveCanvasPointerIntent({ ...pointer, boxSelectEnabled: false })).toBe("pan");
        expect(resolveCanvasPointerIntent({ ...pointer, boxSelectEnabled: false, shiftKey: true })).toBe("select");
    });

    test("reuses the selectable-node spatial index until the node array changes", () => {
        const nodes: CanvasNodeData[] = [
            node("batch-root", 0, 0, { isBatchRoot: true, imageBatchExpanded: false }),
            node("batch-child", 20, 20, { batchRootId: "batch-root" }),
            { ...node("frame", 300, 0), type: CanvasNodeType.Frame, metadata: { frame: { collapsed: true, expandedWidth: 160, expandedHeight: 90 } } },
            { ...node("frame-child", 320, 20), parentId: "frame" },
            node("visible", 600, 0),
        ];
        const cache = createCanvasSelectionSpatialIndexCache();
        const first = cache.get(nodes);

        expect(cache.get(nodes)).toBe(first);
        expect(first.query({ left: -10, top: -10, right: 1000, bottom: 300 }).map((item) => item.id)).toEqual(["batch-root", "frame", "visible"]);
        expect(cache.get([...nodes])).not.toBe(first);
    });

    test("uses region selection as the page default and commits selection outside pointer-move", async () => {
        const projectSource = await Bun.file(new URL("../src/pages/canvas/project.tsx", import.meta.url)).text();
        const controllerSource = await Bun.file(new URL("../src/pages/canvas/use-canvas-selection-controller.ts", import.meta.url)).text();
        const canvasSource = await Bun.file(new URL("../src/components/canvas/infinite-canvas.tsx", import.meta.url)).text();
        const graphicsSource = await Bun.file(new URL("../src/components/canvas/canvas-leafer-graphics-layer.tsx", import.meta.url)).text();
        const globalStyles = await Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text();

        expect(projectSource).toContain('useState<CanvasToolMode>("box-select")');
        const pointerMoveBody = controllerSource.slice(controllerSource.indexOf("const handlePointerMove"), controllerSource.indexOf("const finishSelection"));
        expect(pointerMoveBody).not.toContain("setSelectedNodeIds(");
        expect(controllerSource).toContain("updateSelectionPreview(screenToCanvas(clientX, clientY), true)");
        expect(canvasSource).toContain('"canvas-cursor-select"');
        expect(canvasSource).not.toContain('"cursor-crosshair"');
        expect(graphicsSource).toContain('fill: "transparent"');
        expect(graphicsSource).toContain('dashPattern: [4 / scale, 4 / scale]');
        expect(globalStyles).toContain(".canvas-cursor-select");
        expect(globalStyles).not.toContain("filter='drop-shadow");
    });
});

function node(id: string, x: number, y: number, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x, y },
        width: 160,
        height: 90,
        metadata,
    };
}
