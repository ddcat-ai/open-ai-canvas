import { expect, test } from "bun:test";
import { applyBatchReferenceEdits, batchCellHandle, filterBatchCellConnections, reconcileBatchCellConnections, syncBatchColumnReferences } from "@/lib/canvas/canvas-batch-references";
import { batchReferenceHandleId, insertBatchRow, reorderBatchReferenceColumns } from "@/lib/canvas/canvas-batch-table";
import { applyCanvasConnectionPromptSync } from "@/lib/canvas/canvas-resource-references";
import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function fixture(count = 5) {
    const table: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "AI list",
        position: { x: 500, y: 0 },
        width: 800,
        height: 560,
        metadata: {
            batchTable: {
                operation: "creative",
                concurrency: 2,
                aiGenerated: true,
                referenceColumns: [
                    { id: "a", label: "1" },
                    { id: "b", label: "2" },
                ],
                rows: Array.from({ length: count }, (_, i) => ({ id: `row${i}`, enabled: i !== 2, inputNodeIds: [], prompt: `prompt ${i}`, cells: { detail: `detail ${i}` }, outputNodeId: `result${i}` })),
            },
        },
    };
    const nodes: CanvasNodeData[] = [table, ...["person", "outfit", "other"].map((id) => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { storageKey: `resource:${id}` } }))];
    const edges: CanvasConnection[] = [
        { id: "col1", fromNodeId: "person", toNodeId: "table", toHandleId: batchReferenceHandleId("a") },
        { id: "col2", fromNodeId: "outfit", toNodeId: "table", toHandleId: batchReferenceHandleId("b") },
    ];
    return { nodes, edges };
}
const rows = (nodes: CanvasNodeData[]) => nodes[0].metadata!.batchTable!.rows;
test("locked column ports reject edits instead of storing an inactive connection", () => {
    const { nodes, edges } = fixture();
    nodes[0].metadata!.locked = true;
    expect(canvasConnectionError({} as AiConfig, nodes, [], edges[0])).toBe("批量创作表已锁定");
    expect(syncBatchColumnReferences(nodes, edges)).toBe(nodes);
});
test("AI-generated task rows do not grow when a reference column has more inputs than tasks", () => {
    const f = fixture(2);
    const edges = [...f.edges, { id: "col1-extra", fromNodeId: "other", toNodeId: "table", toHandleId: batchReferenceHandleId("a") }];
    const next = syncBatchColumnReferences(f.nodes, edges);
    expect(rows(next)).toHaveLength(2);
    expect(rows(next).map((row) => row.id)).toEqual(["row0", "row1"]);
    expect(rows(next).map((row) => row.inputNodeIds)).toEqual([
        ["person", "outfit"],
        ["other", "outfit"],
    ]);
    expect(rows(next).map((row) => row.prompt)).toEqual(["prompt 0", "prompt 1"]);
    expect(rows(next).map((row) => row.outputNodeId)).toEqual(["result0", "result1"]);
});
test("column 1 and 2 broadcast without changing five AI tasks, prompts, details or results", () => {
    const { nodes, edges } = fixture();
    const next = syncBatchColumnReferences(nodes, edges);
    expect(rows(next)).toHaveLength(5);
    rows(next).forEach((row, i) => {
        expect(row.inputNodeIds).toEqual(["person", "outfit"]);
        expect(row).toMatchObject({ id: `row${i}`, prompt: `prompt ${i}`, enabled: i !== 2, cells: { detail: `detail ${i}` }, outputNodeId: `result${i}` });
    });
    expect(reconcileBatchCellConnections(next, edges)).toBe(edges);
    expect(syncBatchColumnReferences(next, edges)).toBe(next);
});
test("one-cell override and deliberate empty remain independent when the shared column changes", () => {
    const f = fixture();
    const nodes = syncBatchColumnReferences(f.nodes, f.edges);
    const edit = applyBatchReferenceEdits(nodes, f.edges, "table", [
        { rowId: "row0", columnId: "b", expectedSourceId: "outfit", sourceId: "other" },
        { rowId: "row1", columnId: "a", expectedSourceId: "person", sourceId: "" },
    ])!;
    const edges = edit.connections.map((e) => (e.id === "col1" ? { ...e, fromNodeId: "other" } : e));
    const next = syncBatchColumnReferences(edit.nodes, edges);
    expect(rows(next)[0].inputNodeIds).toEqual(["other", "other"]);
    expect(rows(next)[1].inputNodeIds).toEqual(["", "outfit"]);
    expect(rows(next)[4].inputNodeIds).toEqual(["other", "outfit"]);
    expect(reconcileBatchCellConnections(next, edges)).toHaveLength(3);
});
test("deleting column disconnects inherited cells only; deleting cell edge leaves explicit empty", () => {
    const f = fixture();
    const nodes = syncBatchColumnReferences(f.nodes, f.edges);
    const edit = applyBatchReferenceEdits(nodes, f.edges, "table", [{ rowId: "row0", columnId: "a", expectedSourceId: "person", sourceId: "other" }])!;
    const afterColumn = syncBatchColumnReferences(
        edit.nodes,
        edit.connections.filter((e) => e.id !== "col1"),
    );
    expect(rows(afterColumn)[0].inputNodeIds).toEqual(["other", "outfit"]);
    expect(rows(afterColumn)[1].inputNodeIds).toEqual(["", "outfit"]);
    const removed = edit.connections.filter((e) => e.toHandleId !== batchCellHandle("row0", "a"));
    const detached = syncBatchColumnReferences(applyCanvasConnectionPromptSync(edit.nodes, edit.connections, edit.nodes, removed), removed);
    expect(rows(detached)[0].inputNodeIds[0]).toBe("");
});
test("new rows, column reorder, JSON reopen and undo retain stable override locations", () => {
    const f = fixture();
    const nodes = syncBatchColumnReferences(f.nodes, f.edges);
    const edit = applyBatchReferenceEdits(nodes, f.edges, "table", [{ rowId: "row0", columnId: "a", expectedSourceId: "person", sourceId: "other" }])!;
    const table = edit.nodes[0].metadata!.batchTable!;
    const inserted = insertBatchRow(table, "row0")!;
    const updated = edit.nodes.map((n) => (n.id !== "table" ? n : { ...n, metadata: { ...n.metadata, batchTable: reorderBatchReferenceColumns({ ...table, rows: inserted.rows }, "a", "b") } }));
    const reopened = syncBatchColumnReferences(JSON.parse(JSON.stringify(updated)), f.edges);
    expect(rows(reopened)[1].inputNodeIds).toEqual(["outfit", "other"]);
    expect(rows(reopened)[1].referenceOverrides).toEqual(["a"]);
    expect(syncBatchColumnReferences(nodes, f.edges)).toBe(nodes);
});
test("empty table creates enough rows, multiple images fill by order, and old per-cell content survives", () => {
    const f = fixture(0);
    f.nodes[0].metadata!.batchTable!.aiGenerated = false;
    const edges = [...f.edges, { ...f.edges[0], id: "col1b", fromNodeId: "other" }];
    const nodes = syncBatchColumnReferences(f.nodes, edges);
    expect(rows(nodes).map((r) => r.inputNodeIds)).toEqual([
        ["person", "outfit"],
        ["other", "outfit"],
    ]);
    const saved = fixture();
    saved.nodes[0].metadata!.batchTable!.referenceMode = "cells";
    rows(saved.nodes)[0].inputNodeIds = ["other", ""];
    expect(rows(syncBatchColumnReferences(saved.nodes, saved.edges))[0].inputNodeIds).toEqual(["other", "outfit"]);
});
test("a thousand shared rows need two edges; offscreen independent cell edges are retained but not drawn", () => {
    const f = fixture(1000);
    const nodes = syncBatchColumnReferences(f.nodes, f.edges);
    expect(rows(nodes)).toHaveLength(1000);
    expect(reconcileBatchCellConnections(nodes, f.edges)).toHaveLength(2);
    const edit = applyBatchReferenceEdits(nodes, f.edges, "table", [{ rowId: "row999", columnId: "a", expectedSourceId: "person", sourceId: "other" }])!;
    const entries = edit.connections.map((connection) => ({ connection, to: edit.nodes[0] }));
    expect(filterBatchCellConnections(entries, {}, null)).toHaveLength(2);
    const cell = entries.find((e) => e.connection.toHandleId === batchCellHandle("row999", "a"))!;
    expect(filterBatchCellConnections(entries, {}, cell.connection.id)).toHaveLength(3);
    expect(filterBatchCellConnections(entries, { table: { top: 999 * 122, left: 0 } }, null)).toHaveLength(3);
});
