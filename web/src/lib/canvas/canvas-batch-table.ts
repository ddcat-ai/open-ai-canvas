import { nanoid } from "nanoid";

import type { CanvasBatchOperation, CanvasBatchReferenceColumn, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasNodeData } from "@/types/canvas";

export const TRY_ON_BATCH_PROMPT = "参考图1是人物原图，参考图2是目标服装。保持人物身份、五官、姿态和背景不变，将人物服装替换为参考图2中的款式。准确还原服装版型、颜色、材质、纹理和装饰细节，穿着关系自然，光影与原图一致。";
export const CREATIVE_BATCH_PROMPT = "基于参考图创作一张新的商业图片，保留主体身份和关键产品细节，画面构图完整，光影自然。";
export const BATCH_REFERENCE_HANDLE_PREFIX = "batch-reference:";
export const BATCH_REFERENCE_HANDLE_TOP = 112;
export const BATCH_REFERENCE_HANDLE_GAP = 38;
export const MAX_BATCH_REFERENCE_COLUMNS = 6;
export const MAX_BATCH_TEXT_COLUMNS = 4;
export const BATCH_TEXT_HANDLE_PREFIX = "batch-text:";

export function batchGridTemplateColumns(referenceCount: number, textCount: number) {
    return [
        "36px",
        "68px",
        `repeat(${referenceCount}, 88px)`,
        textCount > 0 ? `repeat(${textCount}, minmax(168px, 0.75fr))` : undefined,
        "minmax(280px, 1fr)",
        "148px",
        "36px",
    ].filter(Boolean).join(" ");
}

export function reorderBatchReferenceColumns(table: CanvasBatchTableData, fromColumnId: string, toColumnId: string): CanvasBatchTableData {
    const columns = batchReferenceColumns(table);
    const fromIndex = columns.findIndex((column) => column.id === fromColumnId);
    const toIndex = columns.findIndex((column) => column.id === toColumnId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return table;

    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    nextColumns.splice(toIndex, 0, moved);
    const nextRows = table.rows.map((row) => ({
        ...row,
        inputNodeIds: nextColumns.map((column) => {
            const oldIndex = columns.findIndex((item) => item.id === column.id);
            return row.inputNodeIds[oldIndex] || "";
        }),
    }));

    return {
        ...table,
        referenceColumns: nextColumns.map((column, index) => ({ ...column, label: `参考图 ${index + 1}` })),
        rows: nextRows,
    };
}

export function moveBatchReferenceCell(
    table: CanvasBatchTableData,
    sourceRowId: string,
    sourceColumnIndex: number,
    targetRowId: string,
    targetColumnIndex: number,
): CanvasBatchTableData {
    if (sourceRowId === targetRowId && sourceColumnIndex === targetColumnIndex) return table;
    if (sourceColumnIndex < 0 || targetColumnIndex < 0) return table;

    const referenceCount = Math.max(batchReferenceColumns(table).length, sourceColumnIndex + 1, targetColumnIndex + 1);
    const sourceRow = table.rows.find((row) => row.id === sourceRowId);
    const targetRow = table.rows.find((row) => row.id === targetRowId);
    if (!sourceRow || !targetRow) return table;

    const nextRows = table.rows.map((row) => ({
        ...row,
        inputNodeIds: Array.from({ length: referenceCount }, (_, index) => row.inputNodeIds[index] || ""),
    }));
    const nextSourceRow = nextRows.find((row) => row.id === sourceRowId)!;
    const nextTargetRow = nextRows.find((row) => row.id === targetRowId)!;
    const sourceNodeId = nextSourceRow.inputNodeIds[sourceColumnIndex];
    if (!sourceNodeId) return table;

    const targetNodeId = nextTargetRow.inputNodeIds[targetColumnIndex];
    nextTargetRow.inputNodeIds[targetColumnIndex] = sourceNodeId;
    nextSourceRow.inputNodeIds[sourceColumnIndex] = targetNodeId || "";

    return { ...table, rows: nextRows };
}

// Reserve one slot for adding a reference and a separate gap before text inputs.
export function batchTextHandleTop(referenceCount: number) {
    return BATCH_REFERENCE_HANDLE_TOP + (referenceCount + 1) * BATCH_REFERENCE_HANDLE_GAP + 24;
}

export function defaultBatchReferenceColumns(): CanvasBatchReferenceColumn[] {
    return [
        { id: "reference-1", label: "参考图 1" },
        { id: "reference-2", label: "参考图 2" },
        { id: "reference-3", label: "参考图 3" },
    ];
}

export function batchReferenceColumns(table?: CanvasBatchTableData) {
    const columns = table?.referenceColumns;
    if (!columns?.length) return defaultBatchReferenceColumns();
    // Older tables were created before the second default slot existed. They
    // never had a remove-column action, so extending this exact legacy shape is
    // a safe migration and makes reference slot 2 immediately selectable.
    if (columns.length === 1 && columns[0].id === "reference-1") return defaultBatchReferenceColumns();
    return columns;
}

export function batchReferenceHandleId(columnId: string) {
    return `${BATCH_REFERENCE_HANDLE_PREFIX}${columnId}`;
}

export function batchReferenceColumnId(handleId?: string) {
    return handleId?.startsWith(BATCH_REFERENCE_HANDLE_PREFIX) ? handleId.slice(BATCH_REFERENCE_HANDLE_PREFIX.length) : undefined;
}

export function batchTextColumns(table?: CanvasBatchTableData) {
    return table?.textColumns || [];
}

export function batchTextHandleId(columnId: string) {
    return `${BATCH_TEXT_HANDLE_PREFIX}${columnId}`;
}

export function batchTextColumnId(handleId?: string) {
    return handleId?.startsWith(BATCH_TEXT_HANDLE_PREFIX) ? handleId.slice(BATCH_TEXT_HANDLE_PREFIX.length) : undefined;
}

export function batchTextHandleY(node: CanvasNodeData, handleId?: string) {
    if (node.type !== "batch-table") return undefined;
    const columnId = batchTextColumnId(handleId);
    const columns = batchTextColumns(node.metadata?.batchTable);
    const index = columnId ? columns.findIndex((column) => column.id === columnId) : -1;
    if (index < 0) return undefined;
    return node.position.y + batchTextHandleTop(batchReferenceColumns(node.metadata?.batchTable).length) + index * BATCH_REFERENCE_HANDLE_GAP;
}

export function batchTextHandleAtY(node: CanvasNodeData, worldY: number, hitRadius = 18) {
    if (node.type !== "batch-table") return undefined;
    const columns = batchTextColumns(node.metadata?.batchTable);
    const referenceCount = batchReferenceColumns(node.metadata?.batchTable).length;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    columns.forEach((_, index) => {
        const distance = Math.abs(worldY - (node.position.y + batchTextHandleTop(referenceCount) + index * BATCH_REFERENCE_HANDLE_GAP));
        if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });
    return nearestIndex >= 0 && nearestDistance <= hitRadius ? batchTextHandleId(columns[nearestIndex].id) : undefined;
}
export function batchReferenceHandleY(node: CanvasNodeData, handleId?: string) {
    if (node.type !== "batch-table") return undefined;
    const textY = batchTextHandleY(node, handleId);
    if (textY !== undefined) return textY;
    const columnId = batchReferenceColumnId(handleId);
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    const index = columnId ? columns.findIndex((column) => column.id === columnId) : 0;
    if (index < 0) return undefined;
    return node.position.y + BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP;
}

export function batchReferenceHandleAtY(node: CanvasNodeData, worldY: number, hitRadius = 18) {
    if (node.type !== "batch-table") return undefined;
    const referenceColumns = batchReferenceColumns(node.metadata?.batchTable);
    const textColumns = batchTextColumns(node.metadata?.batchTable);
    const handles = [
        ...referenceColumns.map((column, index) => ({ id: batchReferenceHandleId(column.id), y: BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP })),
        ...textColumns.map((column, index) => ({ id: batchTextHandleId(column.id), y: batchTextHandleTop(referenceColumns.length) + index * BATCH_REFERENCE_HANDLE_GAP })),
    ];
    const nearest = handles.reduce<{ id: string; distance: number } | null>((current, handle) => {
        const distance = Math.abs(worldY - (node.position.y + handle.y));
        return !current || distance < current.distance ? { id: handle.id, distance } : current;
    }, null);
    return nearest && nearest.distance <= hitRadius ? nearest.id : undefined;
}

export function batchInputColumns(node: CanvasNodeData, connections: CanvasConnection[]) {
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    const indexById = new Map(columns.map((column, index) => [column.id, index]));
    const result = columns.map(() => [] as string[]);
    connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output").forEach((connection) => {
        const columnId = batchReferenceColumnId(connection.toHandleId);
        const index = columnId ? indexById.get(columnId) : 0;
        if (index === undefined || result[index].includes(connection.fromNodeId)) return;
        result[index].push(connection.fromNodeId);
    });
    return result;
}

export function batchTextInputColumns(node: CanvasNodeData, connections: CanvasConnection[]) {
    const columns = batchTextColumns(node.metadata?.batchTable);
    const indexById = new Map(columns.map((column, index) => [column.id, index]));
    const result = columns.map(() => [] as string[]);
    connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output").forEach((connection) => {
        const columnId = batchTextColumnId(connection.toHandleId);
        const index = columnId ? indexById.get(columnId) : undefined;
        if (index === undefined || result[index].includes(connection.fromNodeId)) return;
        result[index].push(connection.fromNodeId);
    });
    return result;
}

/** A non-empty global prompt takes precedence without destroying row-specific prompts. */
export function batchPromptForRow(table: CanvasBatchTableData, row: CanvasBatchRow) {
    return table.globalPrompt?.trim() || row.prompt;
}

export function createBatchRow(operation: CanvasBatchOperation, inputNodeIds: string[] = []): CanvasBatchRow {
    return {
        id: `batch-row-${nanoid()}`,
        enabled: true,
        inputNodeIds,
        textNodeIds: [],
        prompt: operation === "try_on" ? TRY_ON_BATCH_PROMPT : CREATIVE_BATCH_PROMPT,
    };
}

/**
 * Connected try-on inputs follow the reference layout: all model/person images first,
 * followed by one shared garment image. Users can still edit any row afterwards.
 */
export function createBatchRowsFromInputs(operation: CanvasBatchOperation, inputNodeIds: string[]) {
    if (operation === "creative") return inputNodeIds.map((id) => createBatchRow(operation, [id]));
    if (inputNodeIds.length < 2) return [];
    const garmentId = inputNodeIds.at(-1)!;
    return inputNodeIds.slice(0, -1).map((personId) => createBatchRow(operation, [personId, garmentId]));
}

/** Zip equally sized columns and broadcast singleton columns across every row. */
export function createBatchRowsFromColumns(operation: CanvasBatchOperation, columns: string[][], previousRows: CanvasBatchRow[] = []) {
    const rowCount = Math.max(0, ...columns.map((column) => column.length));
    const previousByPrimary = new Map(previousRows.flatMap((row) => row.inputNodeIds[0] ? [[row.inputNodeIds[0], row] as const] : []));
    return Array.from({ length: rowCount }, (_, rowIndex) => {
        const inputNodeIds = columns.flatMap((column) => {
            const input = column.length === 1 ? column[0] : column[rowIndex];
            return input ? [input] : [];
        });
        const previous = inputNodeIds[0] ? previousByPrimary.get(inputNodeIds[0]) : undefined;
        const inputsUnchanged = previous && previous.inputNodeIds.length === inputNodeIds.length && previous.inputNodeIds.every((id, index) => id === inputNodeIds[index]);
        return {
            ...createBatchRow(operation, inputNodeIds),
            ...(previous ? { id: previous.id, enabled: previous.enabled, prompt: previous.prompt, textNodeIds: previous.textNodeIds } : {}),
            ...(inputsUnchanged && previous?.outputNodeId ? { outputNodeId: previous.outputNodeId } : {}),
            inputNodeIds,
        };
    });
}

export function assignBatchTextRows(rows: CanvasBatchRow[], columns: string[][]) {
    return rows.map((row, rowIndex) => ({
        ...row,
        textNodeIds: columns.flatMap((column) => {
            const input = column.length === 1 ? column[0] : column[rowIndex];
            return input ? [input] : [];
        }),
    }));
}
