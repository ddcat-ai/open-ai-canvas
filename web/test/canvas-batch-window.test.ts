import { expect, test } from "bun:test";
import { batchRenderedRowIndices, batchVisibleRowRange } from "@/lib/canvas/canvas-batch-window";
import { BATCH_ROW_HEIGHT } from "@/lib/canvas/canvas-batch-references";

test("small tables keep every row; large tables render only the viewport and three-row overscan", () => {
    expect(batchRenderedRowIndices(20, { start: 4, end: 8 })).toHaveLength(20);
    const range = batchVisibleRowRange(100, BATCH_ROW_HEIGHT * 40 + 36, BATCH_ROW_HEIGHT * 3);
    expect(range).toEqual({ start: 37, end: 46 });
    expect(batchRenderedRowIndices(100, range)).toEqual([37, 38, 39, 40, 41, 42, 43, 44, 45]);
});

test("scrolling retains the focused editor without rendering intervening rows", () => {
    const range = batchVisibleRowRange(100, BATCH_ROW_HEIGHT * 40 + 36, BATCH_ROW_HEIGHT * 3);
    const rows = batchRenderedRowIndices(100, range, 2);
    expect(rows).toEqual([2, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
    const gaps = rows.reduce((total, index, i) => total + index - (i ? rows[i - 1] + 1 : 0), 0) + 100 - rows.at(-1)! - 1;
    expect(gaps + rows.length).toBe(100);
    expect(batchRenderedRowIndices(100, range, 40)).toHaveLength(9);
});

test("empty, top and bottom scroll bounds never address a missing row", () => {
    expect(batchRenderedRowIndices(0, { start: 0, end: 0 })).toEqual([]);
    expect(batchVisibleRowRange(100, 0, 366).start).toBe(0);
    const last = batchVisibleRowRange(100, BATCH_ROW_HEIGHT * 98, 366);
    expect(last.end).toBe(100);
    expect(batchRenderedRowIndices(100, last).at(-1)).toBe(99);
});
