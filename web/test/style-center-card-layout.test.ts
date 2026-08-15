import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("style center card layout", () => {
    test("keeps every card at its content height in the all-category grid", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-style-picker-modal.tsx"), "utf8");
        const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(source).toContain("style-center-card group grid");
        expect(source).toContain('className="style-center-card-cover');
        expect(source).toContain("preset.description");
        expect(styles).toMatch(/\.style-center-grid\s*\{[^}]*grid-auto-rows:\s*max-content;/s);
        expect(styles).toMatch(/\.style-center-card\s*\{[^}]*grid-template-rows:\s*auto minmax\(min-content, 1fr\) auto;/s);
        expect(styles).toMatch(/\.style-center-card-cover\s*\{[^}]*aspect-ratio:\s*16 \/ 9;/s);
    });
});
