import { describe, expect, test } from "bun:test";
import { clampPromptEditorModalSize } from "../src/lib/canvas/canvas-prompt-editor-size";

describe("prompt editor window bounds", () => {
    test("keeps desktop minimums and leaves a viewport margin", () => {
        const viewport = { width: 1440, height: 900 };
        expect(clampPromptEditorModalSize({ width: 100, height: 100 }, viewport)).toEqual({ width: 560, height: 320 });
        expect(clampPromptEditorModalSize({ width: 2000, height: 2000 }, viewport)).toEqual({ width: 1416, height: 876 });
    });

    test("a narrow or short viewport takes precedence over desktop minimums", () => {
        expect(clampPromptEditorModalSize({ width: 1200, height: 800 }, { width: 390, height: 844 })).toEqual({ width: 366, height: 800 });
        expect(clampPromptEditorModalSize({ width: 1200, height: 800 }, { width: 844, height: 300 })).toEqual({ width: 820, height: 276 });
    });

    test("reconstrains a previously resized window after viewport shrink", () => {
        const desktop = clampPromptEditorModalSize({ width: 1200, height: 800 }, { width: 1440, height: 900 });
        const mobile = clampPromptEditorModalSize(desktop, { width: 390, height: 300 });
        expect(mobile).toEqual({ width: 366, height: 276 });
        expect(clampPromptEditorModalSize(mobile, { width: 390, height: 300 })).toEqual(mobile);
    });
});
