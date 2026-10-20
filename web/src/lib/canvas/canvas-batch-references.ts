import type { CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { batchInputColumns, batchPromptForRow, batchReferenceColumns, createBatchRow } from "./canvas-batch-table";
import { canvasBatchInputToken } from "./canvas-batch-input-signature";

export const BATCH_CELL_PREFIX = "batch-cell:";
export const BATCH_TABLE_HEADER_HEIGHT = 121;
export const BATCH_COLUMN_HEADER_HEIGHT = 36;
export const BATCH_ROW_HEIGHT = 122;
export type BatchScroll = { top: number; left: number };
export type BatchReferenceEdit = { rowId: string; columnId: string; sourceId: string; expectedSourceId: string };

export function batchCellHandle(rowId: string, columnId: string) {
    return `${BATCH_CELL_PREFIX}${encodeURIComponent(rowId)}:${encodeURIComponent(columnId)}`;
}
export function parseBatchCellHandle(handle?: string) {
    if (!handle?.startsWith(BATCH_CELL_PREFIX)) return undefined;
    const parts = handle.slice(BATCH_CELL_PREFIX.length).split(":");
    if (parts.length !== 2 || parts.some((part) => !part)) return undefined;
    try {
        return { rowId: decodeURIComponent(parts[0]), columnId: decodeURIComponent(parts[1]) };
    } catch {
        return undefined;
    }
}
const tableIndexes = new WeakMap<CanvasBatchTableData, { rows: Map<string, number>; columns: Map<string, number> }>();
function batchIndexes(table: CanvasBatchTableData) {
    let indexes = tableIndexes.get(table);
    if (!indexes) {
        indexes = { rows: new Map(table.rows.map((row, index) => [row.id, index])), columns: new Map(batchReferenceColumns(table).map((column, index) => [column.id, index])) };
        tableIndexes.set(table, indexes);
    }
    return indexes;
}
export function batchCellAnchor(node: CanvasNodeData, handle: string | undefined, scroll: BatchScroll = { top: 0, left: 0 }) {
    const cell = parseBatchCellHandle(handle);
    const table = node.metadata?.batchTable;
    if (!cell || !table) return undefined;
    const indexes = batchIndexes(table);
    const rowIndex = indexes.rows.get(cell.rowId);
    const columnIndex = indexes.columns.get(cell.columnId);
    if (rowIndex === undefined || columnIndex === undefined) return undefined;
    const rawX = 12 + 64 + columnIndex * 88 + 12 - scroll.left;
    const rawY = BATCH_TABLE_HEADER_HEIGHT + BATCH_COLUMN_HEADER_HEIGHT + rowIndex * BATCH_ROW_HEIGHT + BATCH_ROW_HEIGHT / 2 - scroll.top;
    const x = Math.max(4, Math.min(node.width - 8, rawX));
    const y = Math.max(BATCH_TABLE_HEADER_HEIGHT + BATCH_COLUMN_HEADER_HEIGHT + 4, Math.min(node.height - 8, rawY));
    return { x: node.position.x + x, y: node.position.y + y, clipped: x !== rawX || y !== rawY, label: `任务 ${rowIndex + 1} · 参考图 ${columnIndex + 1}` };
}

/** Column inputs update references in place, never reconstruct user/AI task rows. */
export function syncBatchColumnReferences(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, CanvasConnection[]>();
    for (const edge of connections) {
        if (byId.get(edge.toNodeId)?.type !== "batch-table" || parseBatchCellHandle(edge.toHandleId)) continue;
        const list = incoming.get(edge.toNodeId) || [];
        list.push(edge);
        incoming.set(edge.toNodeId, list);
    }
    let changed = false;
    const next = nodes.map((node) => {
        const table = node.metadata?.batchTable;
        if (!table || node.metadata?.locked) return node;
        const columns = batchReferenceColumns(table);
        const inputs = batchInputColumns(node, incoming.get(node.id) || []).map((ids) =>
            ids.filter((id) => {
                const source = byId.get(id);
                return source?.type === "image" && Boolean(source.metadata?.content || source.metadata?.storageKey);
            }),
        );
        const previousInputs = table.referenceColumnInputs;
        const changedColumns = columns.map((column, index) => {
            const previous = previousInputs?.[column.id];
            return !previous || previous.length !== inputs[index].length || previous.some((id, inputIndex) => id !== inputs[index][inputIndex]);
        });
        const snapshotChanged = changedColumns.some(Boolean) || Object.keys(previousInputs || {}).length !== columns.length;
        // 行操作沿用已有绑定；只有实际变化的列输入才重新按顺序分配或补行。
        const count = table.aiGenerated ? table.rows.length : Math.max(table.rows.length, ...inputs.map((ids, index) => (changedColumns[index] ? ids.length : 0)));
        const rows = Array.from({ length: count }, (_, rowIndex) => {
            const previousRow = table.rows[rowIndex];
            const row = previousRow || createBatchRow(table.operation);
            const defaults = inputs.map((ids) => (ids.length === 1 ? ids[0] : ids[rowIndex] || ""));
            // Preserve saved per-cell edits from before column inheritance was explicit.
            const overrides = row.referenceOverrides ?? columns.flatMap((column, index) => (row.inputNodeIds[index] && row.inputNodeIds[index] !== defaults[index] ? [column.id] : []));
            const ids = columns.map((column, index) => (overrides.includes(column.id) || (previousRow && !changedColumns[index]) ? row.inputNodeIds[index] || "" : defaults[index]));
            const inputChanged = ids.some((id, index) => id !== (row.inputNodeIds[index] || ""));
            if (!inputChanged && row.referenceOverrides !== undefined) return row;
            return { ...row, inputNodeIds: ids, referenceOverrides: overrides, inputChanged: (inputChanged && Boolean(row.outputNodeId)) || row.inputChanged };
        });
        if (table.referenceMode === "cells" && !snapshotChanged && rows.length === table.rows.length && rows.every((row, index) => row === table.rows[index])) return node;
        changed = true;
        const referenceColumnInputs = snapshotChanged ? Object.fromEntries(columns.map((column, index) => [column.id, [...inputs[index]]])) : previousInputs;
        return { ...node, metadata: { ...node.metadata, batchTable: { ...table, referenceMode: "cells" as const, referenceColumnInputs, rows } } };
    });
    return changed ? next : nodes;
}

/** Keep offscreen cell bindings in data, but do not draw their overlapping clipped tails. */
export function filterBatchCellConnections<T extends { connection: CanvasConnection; to: CanvasNodeData }>(entries: T[], scrolls: Record<string, BatchScroll>, selectedId: string | null) {
    return entries.filter((entry) => {
        if (entry.connection.id === selectedId || !parseBatchCellHandle(entry.connection.toHandleId)) return true;
        const anchor = batchCellAnchor(entry.to, entry.connection.toHandleId, scrolls[entry.to.id]);
        return Boolean(anchor && !anchor.clipped);
    });
}

/** Row references are the source of truth. Preserve existing edge IDs when the binding is unchanged. */
export function reconcileBatchCellConnections(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const managed = new Set(nodes.filter((node) => node.metadata?.batchTable?.referenceMode === "cells").map((node) => node.id));
    const existing = new Map(connections.filter((connection) => parseBatchCellHandle(connection.toHandleId)).map((connection) => [`${connection.toNodeId}|${connection.toHandleId}|${connection.fromNodeId}`, connection]));
    const next = connections.filter((connection) => !parseBatchCellHandle(connection.toHandleId) || !managed.has(connection.toNodeId));
    for (const id of managed) {
        const table = byId.get(id)!.metadata!.batchTable!;
        const columns = batchReferenceColumns(table);
        const inputs = batchInputColumns(byId.get(id)!, connections);
        table.rows.forEach((row, rowIndex) =>
            columns.forEach((column, index) => {
                const sourceId = row.inputNodeIds[index];
                if (!sourceId || !byId.has(sourceId)) return;
                const inherited = inputs[index].length === 1 ? inputs[index][0] : inputs[index][rowIndex];
                if (!row.referenceOverrides?.includes(column.id) && sourceId === inherited) return;
                const handle = batchCellHandle(row.id, column.id);
                const key = `${id}|${handle}|${sourceId}`;
                next.push(
                    existing.get(key) || { id: `cell:${encodeURIComponent(id)}:${encodeURIComponent(row.id)}:${encodeURIComponent(column.id)}`, fromNodeId: sourceId, fromHandleId: "output", toNodeId: id, toHandleId: handle, relation: "batch-input" },
                );
            }),
        );
    }
    const current = new Set(connections);
    const unchanged = next.length === connections.length && next.every((connection) => current.has(connection));
    return unchanged ? connections : next;
}

/** Deleting an edge must also remove its binding, otherwise edge projection would restore it. */
export function detachRemovedBatchCellConnections(nodes: CanvasNodeData[], previous: CanvasConnection[], next: CanvasConnection[]) {
    const remaining = new Set(next.map((edge) => edge.id));
    const removed = previous.filter((edge) => !remaining.has(edge.id) && parseBatchCellHandle(edge.toHandleId));
    if (!removed.length) return nodes;
    return nodes.map((node) => {
        const table = node.metadata?.batchTable;
        const edges = removed.filter((edge) => edge.toNodeId === node.id);
        if (!table || !edges.length) return node;
        const columns = batchReferenceColumns(table);
        let changed = false;
        const rows = table.rows.map((row) => {
            const ids = [...row.inputNodeIds];
            edges.forEach((edge) => {
                const cell = parseBatchCellHandle(edge.toHandleId)!;
                const index = columns.findIndex((column) => column.id === cell.columnId);
                if (cell.rowId === row.id && index >= 0 && ids[index] === edge.fromNodeId) {
                    ids[index] = "";
                    changed = true;
                }
            });
            return ids.some((id, index) => id !== row.inputNodeIds[index])
                ? {
                      ...row,
                      inputNodeIds: ids,
                      referenceOverrides: Array.from(
                          new Set([
                              ...(row.referenceOverrides || []),
                              ...edges.flatMap((edge) => {
                                  const cell = parseBatchCellHandle(edge.toHandleId)!;
                                  return cell.rowId === row.id ? [cell.columnId] : [];
                              }),
                          ]),
                      ),
                      inputChanged: Boolean(row.outputNodeId) || row.inputChanged,
                  }
                : row;
        });
        return changed ? { ...node, metadata: { ...node.metadata, batchTable: { ...table, rows } } } : node;
    });
}

export function applyBatchReferenceEdits(nodes: CanvasNodeData[], connections: CanvasConnection[], tableId: string, edits: BatchReferenceEdit[]) {
    const node = nodes.find((item) => item.id === tableId);
    const table = node?.metadata?.batchTable;
    if (!node || !table || node.metadata?.locked) return undefined;
    const columns = batchReferenceColumns(table);
    const byId = new Map(nodes.map((item) => [item.id, item]));
    for (const edit of edits) {
        const row = table.rows.find((item) => item.id === edit.rowId);
        const index = columns.findIndex((column) => column.id === edit.columnId);
        const source = edit.sourceId ? byId.get(edit.sourceId) : undefined;
        if (!row || index < 0 || (row.inputNodeIds[index] || "") !== edit.expectedSourceId) return undefined;
        if (edit.sourceId && (source?.type !== "image" || !(source.metadata?.content || source.metadata?.storageKey))) return undefined;
    }
    const rows = table.rows.map((row) => {
        const changes = edits.filter((edit) => edit.rowId === row.id && edit.sourceId !== edit.expectedSourceId);
        if (!changes.length) return row;
        const inputNodeIds = columns.map((_, i) => row.inputNodeIds[i] || "");
        changes.forEach((edit) => {
            inputNodeIds[columns.findIndex((column) => column.id === edit.columnId)] = edit.sourceId;
        });
        return { ...row, inputNodeIds, referenceOverrides: Array.from(new Set([...(row.referenceOverrides || []), ...changes.map((edit) => edit.columnId)])), inputChanged: Boolean(row.outputNodeId) || row.inputChanged };
    });
    if (rows.every((row, index) => row === table.rows[index])) return { nodes, connections };
    const nextNodes = nodes.map((item) => (item.id !== tableId ? item : { ...item, metadata: { ...item.metadata, batchTable: { ...table, referenceMode: "cells" as const, rows } } }));
    return { nodes: nextNodes, connections: reconcileBatchCellConnections(nextNodes, connections) };
}

const inputTokens = new WeakMap<CanvasNodeData, string>();
function inputToken(node: CanvasNodeData | undefined) {
    if (!node) return "missing";
    const cached = inputTokens.get(node);
    if (cached) return cached;
    const content = node.type === "text" || node.type === "markdown" ? node.metadata?.content || node.metadata?.prompt || "" : node.metadata?.storageKey || node.metadata?.content || node.metadata?.prompt || "";
    const token = canvasBatchInputToken(node.id, content);
    inputTokens.set(node, token);
    return token;
}
export function batchRowInputSignature(table: CanvasBatchTableData, row: CanvasBatchRow, nodes: Map<string, CanvasNodeData>) {
    return JSON.stringify([batchPromptForRow(table, row).trim(), row.inputNodeIds.map((id) => (id ? inputToken(nodes.get(id)) : "")), (row.textNodeIds || []).map((id) => inputToken(nodes.get(id)))]);
}
export function batchRowInputChanged(table: CanvasBatchTableData, row: CanvasBatchRow, nodes: Map<string, CanvasNodeData>) {
    const output = row.outputNodeId ? nodes.get(row.outputNodeId) : undefined;
    if (!(output?.metadata?.content || output?.metadata?.storageKey)) return false;
    const generatedSignature = output.metadata.batchResultInputSignature || row.generatedInputSignature;
    return Boolean(generatedSignature ? generatedSignature !== batchRowInputSignature(table, row, nodes) : row.inputChanged);
}

/** A provider receipt is not proof that the replacement image has been consumed. */
export function batchOutputResultPending(metadata: CanvasNodeMetadata | undefined) {
    return Boolean(metadata?.batchSourceNodeId && metadata.batchRowId && metadata.batchInputSignature && metadata.batchResultInputSignature !== metadata.batchInputSignature);
}

export function batchCellConnectionError(nodes: CanvasNodeData[], sourceId: string, tableId: string, handleId?: string) {
    const source = nodes.find((node) => node.id === sourceId);
    const table = nodes.find((node) => node.id === tableId);
    if (!table || table.type !== "batch-table" || !batchCellAnchor(table, handleId)) return "找不到目标参考格";
    if (table.metadata?.locked) return "批量创作表已锁定";
    if (source?.type !== "image") return "批量创作表节点只接受图片输入";
    if (!(source.metadata?.content || source.metadata?.storageKey)) return "请先为图片节点添加图片";
    return "";
}
