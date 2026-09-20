import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

describe("image angle editor", () => {
    test("anchors the 3D angle editor to the selected node and follows drag", () => {
        const dialog = source.slice(source.indexOf("{angleNode?.metadata?.content"), source.indexOf("{lightingNode?.metadata?.content"));
        expect(dialog).toContain("CanvasNodePanelOverlay");
        expect(dialog).toContain("CanvasNodeAnglePanel");
        expect(dialog).toContain("dragOffset={dragPreview");
        expect(dialog).toContain("isDragging={isNodeDragging");
        expect(dialog).toContain("onClose={() => setAngleNodeId(null)}");
        expect(dialog).toContain("generateAngleNode(angleNode, params)");
        expect(dialog).not.toContain("<Modal");
        expect(dialog).not.toContain("AppModal");
        expect(dialog).not.toContain("destroyOnHidden");
    });
});
