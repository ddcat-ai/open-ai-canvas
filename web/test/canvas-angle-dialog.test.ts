import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

describe("image angle editor (#432)", () => {
    test("uses a centered dismissible modal instead of a node-anchored overlay", () => {
        const dialog = source.slice(source.indexOf("{angleNode?.metadata?.content"), source.indexOf("{emotionNode?.metadata?.content"));
        expect(dialog).toContain("<Modal");
        expect(dialog).toContain("centered");
        expect(dialog).toContain("onCancel={() => setAngleNodeId(null)}");
        expect(dialog).toContain("onClose={() => setAngleNodeId(null)}");
        expect(dialog).toContain("destroyOnHidden");
        expect(dialog).not.toContain("CanvasNodePanelOverlay");
        expect(dialog).not.toContain("isCanvasNodeMoving");
        expect(dialog).toContain("generateAngleNode(angleNode, params)");
    });
});
