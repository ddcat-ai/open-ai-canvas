import { nanoid } from "nanoid";

import type { CanvasBatchOperation, CanvasBatchReferenceColumn, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasNodeData } from "@/types/canvas";

export const TRY_ON_BATCH_PROMPT = "参考图1是人物原图，参考图2是目标服装。保持人物身份、五官、姿态和背景不变，将人物服装替换为参考图2中的款式。准确还原服装版型、颜色、材质、纹理和装饰细节，穿着关系自然，光影与原图一致。";
export const CREATIVE_BATCH_PROMPT = "基于参考图创作一张新的商业图片，保留主体身份和关键产品细节，画面构图完整，光影自然。";
export const BATCH_REFERENCE_HANDLE_PREFIX = "batch-reference:";
export const BATCH_REFERENCE_HANDLE_TOP = 112;
export const BATCH_REFERENCE_HANDLE_GAP = 38;
export const MAX_BATCH_REFERENCE_COLUMNS = 6;

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

export function createBatchRow(operation: CanvasBatchOperation, inputNodeIds: string[] = []): CanvasBatchRow {
    return {
        id: `batch-row-${nanoid()}`,
        enabled: true,
        inputNodeIds,
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
            ...(previous ? { id: previous.id, enabled: previous.enabled, prompt: previous.prompt } : {}),
            ...(inputsUnchanged && previous?.outputNodeId ? { outputNodeId: previous.outputNodeId } : {}),
            inputNodeIds,
        };
    });
}
