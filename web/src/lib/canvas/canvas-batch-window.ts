import { BATCH_COLUMN_HEADER_HEIGHT, BATCH_ROW_HEIGHT } from "./canvas-batch-references";

export const BATCH_VIRTUAL_ROW_THRESHOLD = 20;
const OVERSCAN_ROWS = 3;

export function batchVisibleRowRange(rowCount: number, scrollTop: number, viewportHeight: number) {
    if (rowCount <= BATCH_VIRTUAL_ROW_THRESHOLD) return { start: 0, end: rowCount };
    const start = Math.max(0, Math.floor((scrollTop - BATCH_COLUMN_HEADER_HEIGHT) / BATCH_ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight - BATCH_COLUMN_HEADER_HEIGHT) / BATCH_ROW_HEIGHT) + OVERSCAN_ROWS);
    return { start: Math.min(start, rowCount), end: Math.max(Math.min(start, rowCount), end) };
}

/** Keep one focused row mounted even when scrolling away from its editor or mention popup. */
export function batchRenderedRowIndices(rowCount: number, range: { start: number; end: number }, focusedIndex = -1) {
    if (rowCount <= BATCH_VIRTUAL_ROW_THRESHOLD) return Array.from({ length: rowCount }, (_, index) => index);
    const indices = Array.from({ length: Math.max(0, Math.min(rowCount, range.end) - range.start) }, (_, index) => range.start + index);
    if (focusedIndex >= 0 && focusedIndex < rowCount && !indices.includes(focusedIndex)) indices.push(focusedIndex);
    return indices.sort((a, b) => a - b);
}
