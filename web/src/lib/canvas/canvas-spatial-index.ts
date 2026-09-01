export type CanvasSpatialBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type CanvasSpatialIndexEntry<T> = {
    id: string;
    bounds: CanvasSpatialBounds;
    value: T;
};

type Bucket = number[];

export type CanvasSpatialIndex<T> = {
    query: (bounds: CanvasSpatialBounds, limit?: number) => T[];
};

const DEFAULT_CELL_SIZE = 1024;
const MAX_BUCKET_COVERAGE = 256;

/**
 * A uniform grid keeps viewport queries proportional to nearby content. The
 * original entry order is restored after bucket de-duplication so stacking
 * behavior remains deterministic.
 */
export function buildCanvasSpatialIndex<T>(entries: CanvasSpatialIndexEntry<T>[], cellSize = DEFAULT_CELL_SIZE): CanvasSpatialIndex<T> {
    const normalizedCellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;
    const buckets = new Map<string, Bucket>();
    const largeEntryIndexes: number[] = [];
    const validEntries: CanvasSpatialIndexEntry<T>[] = [];

    entries.forEach((entry) => {
        const bounds = normalizeBounds(entry.bounds);
        if (!bounds || !entry.id) return;
        const index = validEntries.push({ ...entry, bounds }) - 1;
        const minColumn = Math.floor(bounds.left / normalizedCellSize);
        const maxColumn = Math.floor((bounds.right - Number.EPSILON) / normalizedCellSize);
        const minRow = Math.floor(bounds.top / normalizedCellSize);
        const maxRow = Math.floor((bounds.bottom - Number.EPSILON) / normalizedCellSize);
        if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > MAX_BUCKET_COVERAGE) {
            largeEntryIndexes.push(index);
            return;
        }
        for (let row = minRow; row <= maxRow; row += 1) {
            for (let column = minColumn; column <= maxColumn; column += 1) {
                const key = `${column}:${row}`;
                const bucket = buckets.get(key);
                if (bucket) bucket.push(index);
                else buckets.set(key, [index]);
            }
        }
    });

    return {
        query(bounds, limit) {
            const normalizedBounds = normalizeBounds(bounds);
            if (!normalizedBounds || validEntries.length === 0) return [];
            const resultLimit = Number.isFinite(limit) && (limit || 0) > 0 ? Math.floor(limit as number) : null;
            const minColumn = Math.floor(normalizedBounds.left / normalizedCellSize);
            const maxColumn = Math.floor((normalizedBounds.right - Number.EPSILON) / normalizedCellSize);
            const minRow = Math.floor(normalizedBounds.top / normalizedCellSize);
            const maxRow = Math.floor((normalizedBounds.bottom - Number.EPSILON) / normalizedCellSize);
            if (resultLimit) {
                const candidateIndexes = new Set<number>();
                const resultIndexes: number[] = [];
                const addBucket = (bucket: Bucket | undefined) => {
                    if (!bucket) return false;
                    for (const index of bucket) {
                        if (candidateIndexes.has(index)) continue;
                        candidateIndexes.add(index);
                        const entry = validEntries[index];
                        if (!intersects(entry.bounds, normalizedBounds)) continue;
                        resultIndexes.push(index);
                        if (resultIndexes.length >= resultLimit) return true;
                    }
                    return false;
                };
                for (let row = minRow; row <= maxRow; row += 1) {
                    for (let column = minColumn; column <= maxColumn; column += 1) {
                        if (addBucket(buckets.get(`${column}:${row}`))) return resultIndexes.sort((left, right) => left - right).map((index) => validEntries[index].value);
                    }
                }
                for (const index of largeEntryIndexes) {
                    if (candidateIndexes.has(index)) continue;
                    const entry = validEntries[index];
                    if (!intersects(entry.bounds, normalizedBounds)) continue;
                    resultIndexes.push(index);
                    if (resultIndexes.length >= resultLimit) break;
                }
                return resultIndexes.sort((left, right) => left - right).map((index) => validEntries[index].value);
            }
            const candidateIndexes = new Set<number>();
            for (let row = minRow; row <= maxRow; row += 1) {
                for (let column = minColumn; column <= maxColumn; column += 1) {
                    buckets.get(`${column}:${row}`)?.forEach((index) => candidateIndexes.add(index));
                }
            }
            largeEntryIndexes.forEach((index) => candidateIndexes.add(index));
            return [...candidateIndexes]
                .sort((left, right) => left - right)
                .map((index) => validEntries[index])
                .filter((entry) => intersects(entry.bounds, normalizedBounds))
                .map((entry) => entry.value);
        },
    };
}

export function canvasNodeBounds(node: { position: { x: number; y: number }; width: number; height: number }): CanvasSpatialBounds {
    return { left: node.position.x, top: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height };
}

function normalizeBounds(bounds: CanvasSpatialBounds | undefined): CanvasSpatialBounds | null {
    if (!bounds) return null;
    const { left, top, right, bottom } = bounds;
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
    return { left, top, right, bottom };
}

function intersects(left: CanvasSpatialBounds, right: CanvasSpatialBounds) {
    return left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom;
}
