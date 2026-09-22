import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("assets page batch toolbar", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

    test("keeps card selection in the top left with badge clearance", () => {
        const checkbox = styles.match(/\.assets-select-check\s*\{([^}]+)\}/)?.[1] ?? "";
        const badges = styles.match(/\.assets-cover-badges\s*\{([^}]+)\}/)?.[1] ?? "";
        expect(checkbox).toContain("left: 8px;");
        expect(checkbox).toContain("top: 8px;");
        expect(checkbox).not.toMatch(/(?:right|bottom):/);
        expect(badges).toContain("left: 38px;");
        expect(badges).toContain("right: 44px;");
    });

    test("keeps batch actions in document flow with space above selected cards", () => {
        const toolbarRules = [...styles.matchAll(/\.assets-batch-bar\s*\{([^}]+)\}/g)].map((match) => match[1]).join("\n");
        expect(toolbarRules).not.toMatch(/position:\s*(?:sticky|fixed|absolute)/);
        expect(toolbarRules).not.toContain("z-index:");
        expect(toolbarRules).toContain("margin: 2px 0 var(--space-4);");
        const actions = styles.match(/\.assets-batch-actions\s*\{([^}]+)\}/)?.[1] ?? "";
        expect(actions).toContain("flex-wrap: wrap;");
    });

    test("places select all before cancel selection", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const selectAllIndex = source.search(/>\s*全选\s*<\/Button>/);
        const clearSelectionIndex = source.search(/>\s*取消选择\s*<\/Button>/);

        expect(selectAllIndex).toBeGreaterThanOrEqual(0);
        expect(clearSelectionIndex).toBeGreaterThanOrEqual(0);
        expect(selectAllIndex).toBeLessThan(clearSelectionIndex);
    });
});
