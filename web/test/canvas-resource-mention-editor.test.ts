import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("canvas resource mention editor", () => {
    test("uses stable component classes for inline media references", () => {
        const component = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");

        expect(component).toContain('chip.className = "canvas-resource-inline-mention"');
        expect(component).toContain("canvas-resource-inline-preview is-${reference.kind}");
        expect(component).not.toContain("size-[1.18em]");
    });

    test("clamps native media dimensions so video previews cannot cover prompt text", () => {
        const css = source("../src/styles/globals.css");
        const previewRule = css.match(/\.canvas-resource-inline-preview \{[^}]+}/)?.[0] || "";

        expect(previewRule).toContain("width: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("min-width: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("max-width: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("height: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("flex: 0 0 var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("object-fit: cover");
    });
});
