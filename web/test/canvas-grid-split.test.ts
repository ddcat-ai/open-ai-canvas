import { describe, expect, test } from "bun:test";

import { clampGridSplitSize, isValidGridSplit, layoutGridSplitCells } from "../src/lib/canvas/canvas-grid-split";

describe("canvas-grid-split", () => {
    test("clamps size into 1..5", () => {
        expect(clampGridSplitSize(0)).toBe(1);
        expect(clampGridSplitSize(8)).toBe(5);
        expect(clampGridSplitSize(2.6)).toBe(3);
    });

    test("rejects a single cell", () => {
        expect(isValidGridSplit({ rows: 1, columns: 1 })).toBe(false);
        expect(isValidGridSplit({ rows: 1, columns: 2 })).toBe(true);
        expect(isValidGridSplit({ rows: 3, columns: 2 })).toBe(true);
    });

    test("lays out fitted cells without overlap", () => {
        const cells = [
            { row: 0, column: 0, width: 592, height: 432 },
            { row: 0, column: 1, width: 592, height: 432 },
            { row: 1, column: 0, width: 592, height: 432 },
            { row: 1, column: 1, width: 592, height: 432 },
        ];
        const positions = layoutGridSplitCells({ x: 100, y: 40 }, cells, 48);
        expect(positions[1]).toEqual({ x: 100 + 592 + 48, y: 40 });
        expect(positions[2]).toEqual({ x: 100, y: 40 + 432 + 48 });
        expect(positions[3]).toEqual({ x: 100 + 592 + 48, y: 40 + 432 + 48 });
        expect(positions[1]!.x).toBeGreaterThanOrEqual(positions[0]!.x + cells[0]!.width + 48);
        expect(positions[2]!.y).toBeGreaterThanOrEqual(positions[0]!.y + cells[0]!.height + 48);
    });
});
