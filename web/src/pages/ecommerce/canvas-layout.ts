/** Accept both model aspect-ratio enums and explicit pixel dimensions. */
export function commerceCanvasAspect(ratio: string) {
    const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(ratio);
    return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : 1;
}

export function commerceCanvasLayout(count: number, ratio: string) {
    const safeCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    const columns = Math.min(safeCount, 4);
    const rows = Math.ceil(safeCount / columns);
    return { columns, width: columns * 260 + (columns - 1) * 28, height: rows * (260 / commerceCanvasAspect(ratio)) + (rows - 1) * 28 };
}
