import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";

export const CANVAS_GRID_SPLIT_MAX = 5;
export const CANVAS_GRID_SPLIT_GAP = 48;

export const CANVAS_GRID_SPLIT_PRESETS: Array<{ rows: number; columns: number; label: string }> = [
    { rows: 2, columns: 2, label: "4宫格 (2×2)" },
    { rows: 3, columns: 3, label: "9宫格 (3×3)" },
    { rows: 4, columns: 4, label: "16宫格 (4×4)" },
    { rows: 5, columns: 5, label: "25宫格 (5×5)" },
];

export type GridSplitCellSize = {
    row: number;
    column: number;
    width: number;
    height: number;
};

export function clampGridSplitSize(value: number) {
    if (!Number.isFinite(value)) return 2;
    return Math.max(1, Math.min(CANVAS_GRID_SPLIT_MAX, Math.round(value)));
}

export function isValidGridSplit(params: ImageSplitParams) {
    const rows = clampGridSplitSize(params.rows);
    const columns = clampGridSplitSize(params.columns);
    return rows * columns >= 2;
}

export function layoutGridSplitCells(origin: { x: number; y: number }, cells: GridSplitCellSize[], gap = CANVAS_GRID_SPLIT_GAP) {
    const columnCount = Math.max(0, ...cells.map((cell) => cell.column)) + 1;
    const rowCount = Math.max(0, ...cells.map((cell) => cell.row)) + 1;
    const columnWidth = Array.from({ length: columnCount }, (_, column) => Math.max(1, ...cells.filter((cell) => cell.column === column).map((cell) => cell.width)));
    const rowHeight = Array.from({ length: rowCount }, (_, row) => Math.max(1, ...cells.filter((cell) => cell.row === row).map((cell) => cell.height)));
    const columnX: number[] = [];
    let x = origin.x;
    for (let column = 0; column < columnCount; column += 1) {
        columnX.push(x);
        x += (columnWidth[column] || 1) + gap;
    }
    const rowY: number[] = [];
    let y = origin.y;
    for (let row = 0; row < rowCount; row += 1) {
        rowY.push(y);
        y += (rowHeight[row] || 1) + gap;
    }
    return cells.map((cell) => ({ x: columnX[cell.column] || origin.x, y: rowY[cell.row] || origin.y }));
}
