import { describe, expect, test } from "bun:test";

import { CANVAS_SHORTCUTS, filterCanvasShortcuts } from "../src/lib/canvas/canvas-shortcuts";

describe("canvas shortcuts", () => {
    test("uses Ctrl/Cmd + F for search and Shift + Ctrl/Cmd + F for focus mode", () => {
        expect(CANVAS_SHORTCUTS.find((shortcut) => shortcut.id === "search")?.keys).toEqual([["Ctrl / Cmd", "F"]]);
        expect(CANVAS_SHORTCUTS.find((shortcut) => shortcut.id === "focus")?.keys).toEqual([["Shift", "Ctrl / Cmd", "F"]]);
    });

    test("searches titles, descriptions, keys and keywords", () => {
        expect(filterCanvasShortcuts("粘贴").map((shortcut) => shortcut.id)).toContain("paste");
        expect(filterCanvasShortcuts("缩放").map((shortcut) => shortcut.id)).toEqual(expect.arrayContaining(["zoom-wheel", "zoom-controls", "zoom-presets"]));
        expect(filterCanvasShortcuts("Alt L").map((shortcut) => shortcut.id)).toContain("batch-connect");
    });

    test("filters by category without losing the full catalog", () => {
        expect(filterCanvasShortcuts("", "common").every((shortcut) => shortcut.category === "common")).toBe(true);
        expect(filterCanvasShortcuts("", "all")).toHaveLength(CANVAS_SHORTCUTS.length);
    });
});
