import { describe, expect, it } from "vitest";

import { drawingEngineForNode } from "../src/lib/canvas/canvas-drawing-engine";
import { summarizeCanvasDrawing } from "../src/lib/canvas/canvas-drawing-storage";

describe("canvas drawing engines", () => {
    it("treats drawings without an engine as legacy tldraw documents", () => {
        expect(drawingEngineForNode({ metadata: {} } as never)).toBe("tldraw");
        expect(drawingEngineForNode({ metadata: { drawingEngine: "excalidraw" } } as never)).toBe("excalidraw");
    });

    it("summarizes Excalidraw elements without deleted records", () => {
        expect(summarizeCanvasDrawing("excalidraw", {
            elements: [{ id: "visible", isDeleted: false }, { id: "deleted", isDeleted: true }],
        })).toEqual({ shapeCount: 1, pageCount: 1 });
    });

    it("keeps the legacy tldraw snapshot summary", () => {
        expect(summarizeCanvasDrawing("tldraw", {
            store: { "page:1": { typeName: "page" }, "shape:1": { typeName: "shape" } },
        })).toEqual({ shapeCount: 1, pageCount: 1 });
    });
});
