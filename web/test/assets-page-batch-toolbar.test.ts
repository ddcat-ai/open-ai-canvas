import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("assets page batch toolbar", () => {
    test("places select all before cancel selection", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const selectAllIndex = source.search(/>\s*全选\s*<\/Button>/);
        const clearSelectionIndex = source.search(/>\s*取消选择\s*<\/Button>/);

        expect(selectAllIndex).toBeGreaterThanOrEqual(0);
        expect(clearSelectionIndex).toBeGreaterThanOrEqual(0);
        expect(selectAllIndex).toBeLessThan(clearSelectionIndex);
    });
});
