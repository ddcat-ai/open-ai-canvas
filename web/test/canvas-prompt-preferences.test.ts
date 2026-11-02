import { describe, expect, test } from "bun:test";
import { CANVAS_PROMPT_FONT_SIZES, DEFAULT_CANVAS_PROMPT_FONT_SIZE, normalizeCanvasPromptFontSize } from "@/stores/canvas/use-canvas-prompt-preferences-store";
import { clampPromptHeight, estimatePromptContentHeight, promptEditorBounds } from "@/components/canvas/canvas-node-prompt-resize";

describe("canvas prompt reading preferences", () => {
    test("accepts supported font sizes and discards malformed persisted values", () => {
        for (const size of CANVAS_PROMPT_FONT_SIZES) expect(normalizeCanvasPromptFontSize(size)).toBe(size);
        for (const value of [null, undefined, "24", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
            expect(normalizeCanvasPromptFontSize(value)).toBe(DEFAULT_CANVAS_PROMPT_FONT_SIZE);
        }
        expect(normalizeCanvasPromptFontSize(24)).toBe(20);
        expect(normalizeCanvasPromptFontSize(0)).toBe(10);
    });

    test("reserves a useful writing area and counts references separately", () => {
        expect(promptEditorBounds(false, false).min).toBe(160);
        expect(promptEditorBounds(true, false).min).toBe(280);
        expect(promptEditorBounds(false, true).min).toBe(218);
        expect(estimatePromptContentHeight("", false)).toBe(160);
    });

    test("larger fonts get larger scroll and resize bounds without invalid ranges", () => {
        const text = "long prompt ".repeat(100);
        const small = promptEditorBounds(false, true, 12);
        const large = promptEditorBounds(false, true, 24);
        expect(large.max).toBeGreaterThan(small.max);
        expect(estimatePromptContentHeight(text, false, 24)).toBeGreaterThan(estimatePromptContentHeight(text, false, 12));
        for (const size of CANVAS_PROMPT_FONT_SIZES) {
            for (const expanded of [false, true]) {
                const bounds = promptEditorBounds(expanded, false, size);
                expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
                expect(clampPromptHeight(10000, bounds)).toBe(bounds.max);
                expect(clampPromptHeight(0, bounds)).toBe(bounds.min);
            }
        }
    });
});
