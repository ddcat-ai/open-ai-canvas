import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("canvas connection preview", () => {
    test("keeps pointer movement out of the React render loop", () => {
        const controller = source("../src/pages/canvas/use-canvas-connection-controller.ts");
        const flush = controller.slice(controller.indexOf("const flushPointerMove"), controller.indexOf("const handlePointerMove"));
        const graphics = source("../src/components/canvas/canvas-leafer-graphics-layer.tsx");

        expect(flush).toContain("applyCanvasConnectionPreview");
        expect(flush).not.toContain("setMouseWorld(screenToCanvas(event.clientX, event.clientY))");
        expect(graphics).toContain("subscribeCanvasConnectionPreview");
        expect(graphics).toContain("syncConnectionDraft(overlay, propsRef.current, preview)");
    });
});
