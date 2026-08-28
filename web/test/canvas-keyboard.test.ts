import { expect, test } from "bun:test";

import { hasCanvasTextSelection } from "../src/pages/canvas/use-canvas-keyboard";

test("Canvas copy shortcut yields to a real browser text selection", () => {
    expect(hasCanvasTextSelection(null)).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: true, rangeCount: 1, toString: () => "Agent 文本" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 0, toString: () => "Agent 文本" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 1, toString: () => "" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 1, toString: () => "Agent 文本" })).toBe(true);
});

test("Canvas keyboard keeps node copy as the fallback when no text is selected", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-keyboard.ts", import.meta.url)).text();
    expect(source).toContain("if (hasCanvasTextSelection(window.getSelection())) return;");
    expect(source).toContain("event.preventDefault();\n                copySelectedNodes();");
});
