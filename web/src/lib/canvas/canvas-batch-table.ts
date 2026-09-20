import { nanoid } from "nanoid";

import type { CanvasBatchOperation, CanvasBatchReferenceColumn, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasNodeData } from "@/types/canvas";

export const TRY_ON_BATCH_PROMPT = "参考图1是人物原图，参考图2是目标服装。保持人物身份、五官、姿态和背景不变，将人物服装替换为参考图2中的款式。准确还原服装版型、颜色、材质、纹理和装饰细节，穿着关系自然，光影与原图一致。";
export const CREATIVE_BATCH_PROMPT = "基于参考图创作一张新的商业图片，保留主体身份和关键产品细节，画面构图完整，光影自然。";
export const BATCH_REFERENCE_HANDLE_PREFIX = "batch-reference:";
/** 两行工具栏（操作栏 44 + 全局提示词 36 + 分隔 1）之后，对准表头中线。 */
export const BATCH_REFERENCE_HANDLE_TOP = 102;
export const BATCH_REFERENCE_HANDLE_GAP = 40;
export const MIN_BATCH_REFERENCE_COLUMNS = 1;
export const MAX_BATCH_REFERENCE_COLUMNS = 10;
const LEGACY_BATCH_TABLE_WIDTH = 900;

/** 旧默认 900 宽的批量创作表升级到当前默认尺寸，已经手动改过宽度的节点保持原样。 */
export function promoteLegacyBatchTableSize(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== "batch-table" || node.width !== LEGACY_BATCH_TABLE_WIDTH) return node;
    return { ...node, width: 1280, height: Math.max(node.height, 560) };
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
    return columns;
}

export function batchReferenceHandleId(columnId: string) {
    return `${BATCH_REFERENCE_HANDLE_PREFIX}${columnId}`;
}

export function batchTextColumns(table?: CanvasBatchTableData) {
    return table?.textColumns || [];
}

export function batchTextInputColumns(node: CanvasNodeData, connections: CanvasConnection[]) {
    return batchTextColumns(node.metadata?.batchTable).map((column) =>
        Array.from(new Set(connections.filter((connection) => connection.toNodeId === node.id && connection.toHandleId === `batch-text:${column.id}` && connection.relation !== "batch-output").map((connection) => connection.fromNodeId))),
    );
}

export function batchReferenceMentionToken(index: number) {
    return `@参考图${index + 1}`;
}

export function batchReferenceColumnId(handleId?: string) {
    return handleId?.startsWith(BATCH_REFERENCE_HANDLE_PREFIX) ? handleId.slice(BATCH_REFERENCE_HANDLE_PREFIX.length) : undefined;
}

export function batchReferenceHandleY(node: CanvasNodeData, handleId?: string) {
    if (node.type !== "batch-table") return undefined;
    const columnId = batchReferenceColumnId(handleId);
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    const index = columnId ? columns.findIndex((column) => column.id === columnId) : 0;
    if (index < 0) return undefined;
    return node.position.y + BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP;
}

export function batchReferenceHandleAtY(node: CanvasNodeData, worldY: number, hitRadius = 18) {
    if (node.type !== "batch-table") return undefined;
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    columns.forEach((_, index) => {
        const distance = Math.abs(worldY - (node.position.y + BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP));
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex >= 0 && nearestDistance <= hitRadius ? batchReferenceHandleId(columns[nearestIndex].id) : undefined;
}

export function removeLastBatchReferenceColumn(table: CanvasBatchTableData): CanvasBatchTableData | null {
    const columns = batchReferenceColumns(table);
    if (columns.length <= MIN_BATCH_REFERENCE_COLUMNS) return null;
    const nextColumns = columns.slice(0, -1).map((column, index) => ({ ...column, label: `参考图 ${index + 1}` }));
    return {
        ...table,
        referenceColumns: nextColumns,
        rows: table.rows.map((row) => ({ ...row, inputNodeIds: nextColumns.map((_, index) => row.inputNodeIds[index] || "") })),
    };
}

export function reorderBatchReferenceColumns(table: CanvasBatchTableData, fromColumnId: string, toColumnId: string): CanvasBatchTableData {
    const columns = batchReferenceColumns(table);
    const fromIndex = columns.findIndex((column) => column.id === fromColumnId);
    const toIndex = columns.findIndex((column) => column.id === toColumnId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return table;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    nextColumns.splice(toIndex, 0, moved);
    return {
        ...table,
        referenceColumns: nextColumns.map((column, index) => ({ ...column, label: `参考图 ${index + 1}` })),
        rows: table.rows.map((row) => ({
            ...row,
            inputNodeIds: nextColumns.map((column) => {
                const oldIndex = columns.findIndex((item) => item.id === column.id);
                return row.inputNodeIds[oldIndex] || "";
            }),
        })),
    };
}

export function moveBatchReferenceCell(table: CanvasBatchTableData, sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number): CanvasBatchTableData {
    if (sourceRowId === targetRowId && sourceColumnIndex === targetColumnIndex) return table;
    if (sourceColumnIndex < 0 || targetColumnIndex < 0) return table;
    const referenceCount = Math.max(batchReferenceColumns(table).length, sourceColumnIndex + 1, targetColumnIndex + 1);
    const sourceRow = table.rows.find((row) => row.id === sourceRowId);
    const targetRow = table.rows.find((row) => row.id === targetRowId);
    if (!sourceRow || !targetRow) return table;
    const nextRows = table.rows.map((row) => ({ ...row, inputNodeIds: Array.from({ length: referenceCount }, (_, index) => row.inputNodeIds[index] || "") }));
    const nextSource = nextRows.find((row) => row.id === sourceRowId)!;
    const nextTarget = nextRows.find((row) => row.id === targetRowId)!;
    const sourceNodeId = nextSource.inputNodeIds[sourceColumnIndex];
    if (!sourceNodeId) return table;
    const targetNodeId = nextTarget.inputNodeIds[targetColumnIndex];
    nextTarget.inputNodeIds[targetColumnIndex] = sourceNodeId;
    nextSource.inputNodeIds[sourceColumnIndex] = targetNodeId || "";
    return { ...table, rows: nextRows };
}

export function batchPromptForRow(table: CanvasBatchTableData, row: CanvasBatchRow) {
    return table.globalPrompt?.trim() || row.prompt;
}

export function batchRowReady(row: CanvasBatchRow, table: CanvasBatchTableData, nodes: Map<string, CanvasNodeData>) {
    if (!row.enabled || !batchPromptForRow(table, row).trim()) return false;
    const inputs = row.inputNodeIds.filter(Boolean);
    if (inputs.length < (table.operation === "try_on" ? 2 : 1)) return false;
    return inputs.every((id) => {
        const node = nodes.get(id);
        return node?.type === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
    });
}

export function batchGenerationRows(source: CanvasNodeData, nodes: CanvasNodeData[], requestedRowIds?: string[]) {
    const table = source.metadata?.batchTable;
    if (!table) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const active = new Set((source.metadata?.generationBatches || []).filter((batch) => batch.mode === "batch_image").flatMap((batch) => batch.items.filter((item) => ["waiting", "submitting", "queued", "running"].includes(item.status)).map((item) => item.nodeId)));
    const requested = requestedRowIds ? new Set(requestedRowIds) : null;
    return table.rows.filter((row) => {
        if ((requested && !requested.has(row.id)) || !batchRowReady(row, table, byId)) return false;
        const output = byId.get(row.outputNodeId || "");
        if (output && active.has(output.id)) return false;
        return Boolean(requested) || !Boolean(output?.metadata?.content || output?.metadata?.storageKey);
    });
}

export function batchInputColumns(node: CanvasNodeData, connections: CanvasConnection[]) {
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    const indexById = new Map(columns.map((column, index) => [column.id, index]));
    const result = columns.map(() => [] as string[]);
    connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output" && !connection.toHandleId?.startsWith("batch-text:")).forEach((connection) => {
        const columnId = batchReferenceColumnId(connection.toHandleId);
        const index = columnId ? indexById.get(columnId) : 0;
        if (index === undefined || result[index].includes(connection.fromNodeId)) return;
        result[index].push(connection.fromNodeId);
    });
    return result;
}

export function createBatchRow(operation: CanvasBatchOperation, inputNodeIds: string[] = []): CanvasBatchRow {
    return {
        id: `batch-row-${nanoid()}`,
        enabled: true,
        inputNodeIds,
        prompt: operation === "try_on" ? TRY_ON_BATCH_PROMPT : CREATIVE_BATCH_PROMPT,
    };
}

/** 手工追加任务时沿用上一行的参考图，但重新使用当前任务类型的默认提示词。 */
export function createInheritedBatchRow(operation: CanvasBatchOperation, rows: CanvasBatchRow[]) {
    return createBatchRow(operation, [...(rows.at(-1)?.inputNodeIds || [])]);
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

/**
 * Zip equally sized columns and broadcast singleton columns across every row.
 *
 * 同步连线是增量操作：匹配到的行更新参考图，未被本次连线覆盖的手工行继续保留。
 * 这样用户在表格内追加或编辑的任务不会因为再次点击“同步连线”而被删除。
 */
export function createBatchRowsFromColumns(operation: CanvasBatchOperation, columns: string[][], previousRows: CanvasBatchRow[] = []) {
    const rowCount = Math.max(0, ...columns.map((column) => column.length));
    const unmatchedRows = [...previousRows];
    const synchronizedRows = Array.from({ length: rowCount }, (_, rowIndex) => {
        const inputNodeIds = columns.flatMap((column) => {
            const input = column.length === 1 ? column[0] : column[rowIndex];
            return input ? [input] : [];
        });
        let previousIndex = unmatchedRows.findIndex((row) => sameBatchInputs(row.inputNodeIds, inputNodeIds));
        if (previousIndex < 0 && inputNodeIds[0]) previousIndex = unmatchedRows.findIndex((row) => row.inputNodeIds[0] === inputNodeIds[0]);
        const previous = previousIndex >= 0 ? unmatchedRows.splice(previousIndex, 1)[0] : undefined;
        const inputsUnchanged = previous && previous.inputNodeIds.length === inputNodeIds.length && previous.inputNodeIds.every((id, index) => id === inputNodeIds[index]);
        return {
            ...createBatchRow(operation, inputNodeIds),
            ...(previous ? { id: previous.id, enabled: previous.enabled, prompt: previous.prompt, cells: previous.cells, textNodeIds: previous.textNodeIds } : {}),
            ...(inputsUnchanged && previous?.outputNodeId ? { outputNodeId: previous.outputNodeId } : {}),
            inputNodeIds,
        };
    });
    return [...synchronizedRows, ...unmatchedRows];
}

function sameBatchInputs(left: string[], right: string[]) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}
