import { describe, expect, test } from "bun:test";

import { canvasThemes } from "../src/lib/canvas-theme";

describe("canvas visual contrast", () => {
    test("keeps the canvas substrate distinct from node surfaces in both themes", () => {
        for (const theme of Object.values(canvasThemes)) {
            expect(theme.canvas.background).not.toBe(theme.node.fill);
            expect(theme.node.panel).not.toBe(theme.canvas.background);
        }
    });

    test("changes only the canvas substrate while retaining original surfaces", () => {
        expect(canvasThemes.light.canvas.background).toBe("#edeeee");
        expect(canvasThemes.light.node.fill).toBe("#ffffff");
        expect(canvasThemes.light.node.edge).toBe("rgba(15,23,42,.16)");
        expect(canvasThemes.light.node.shadow).toBe("0 6px 18px rgba(15,23,42,.08)");
        expect(canvasThemes.light.node.hoverShadow).toBe("0 10px 24px rgba(15,23,42,.12)");
        expect(canvasThemes.light.toolbar.panel).toBe("rgba(255,255,255,.94)");
        expect(canvasThemes.light.spatial.elevated).toBe("rgba(255,255,255,.94)");

        expect(canvasThemes.dark.canvas.background).toBe("#262626");
        expect(canvasThemes.dark.node.fill).toBe("#181818");
        expect(canvasThemes.dark.node.edge).toBe("rgba(255,255,255,.18)");
        expect(canvasThemes.dark.node.shadow).toBe("0 8px 24px rgba(0,0,0,.34)");
        expect(canvasThemes.dark.node.hoverShadow).toBe("0 12px 30px rgba(0,0,0,.46)");
        expect(canvasThemes.dark.toolbar.panel).toBe("rgba(20,20,20,.97)");
        expect(canvasThemes.dark.toolbar.border).toBe("rgba(255,255,255,.1)");
        expect(canvasThemes.dark.spatial.elevated).toBe("rgba(15,15,15,.97)");
    });

    test("pins intentional grid tokens while retaining canvas grid opacity", async () => {
        expect(canvasThemes.light.canvas.dot).toBe("rgba(15,23,42,.20)");
        expect(canvasThemes.light.canvas.line).toBe("rgba(15,23,42,.15)");
        expect(canvasThemes.dark.canvas.dot).toBe("rgba(205,205,205,.28)");
        expect(canvasThemes.dark.canvas.line).toBe("rgba(205,205,205,.28)");

        const source = await Bun.file(new URL("../src/components/canvas/infinite-canvas.tsx", import.meta.url)).text();
        expect(source).toContain('opacity: mode === "dots" ? 0.34 : 0.46');
    });

    test("keeps the original transparent edge for standard canvas nodes", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url)).text();

        expect(source).toContain('border: isComposerNode ? "0" : "1px solid transparent"');
        expect(source).not.toContain('border: isComposerNode ? "0" : `1px solid ${theme.node.edge}`');
    });
});
