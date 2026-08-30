import { describe, expect, test } from "bun:test";

import { canvasThemes } from "../src/lib/canvas-theme";

describe("canvas visual contrast", () => {
    test("keeps the canvas substrate distinct from node surfaces in both themes", () => {
        for (const theme of Object.values(canvasThemes)) {
            expect(theme.canvas.background).not.toBe(theme.node.fill);
            expect(theme.node.panel).not.toBe(theme.canvas.background);
        }
    });

    test("keeps a visible semantic edge for standard canvas nodes", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url)).text();

        expect(source).toContain('border: isComposerNode ? "0" : `1px solid ${theme.node.edge}`');
        expect(source).not.toContain('border: isComposerNode ? "0" : "1px solid transparent"');
    });
});
