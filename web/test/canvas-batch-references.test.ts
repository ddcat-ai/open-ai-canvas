import { expect, test } from "bun:test";
import { applyBatchReferenceEdits, batchCellHandle, parseBatchCellHandle, reconcileBatchCellConnections, batchRowInputSignature, batchRowInputChanged } from "@/lib/canvas/canvas-batch-references";
import { batchInputColumns, createBatchRowsFromColumns, insertBatchRow, reorderBatchReferenceColumns } from "@/lib/canvas/canvas-batch-table";
import { removeCanvasNodes } from "@/lib/canvas/canvas-project-domain";
import { applyCanvasConnectionPromptSync } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function fixture() {
    const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { storageKey: `resource:${id}` } });
    const table: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "table",
        position: { x: 200, y: 0 },
        width: 1280,
        height: 560,
        metadata: {
            batchTable: {
                operation: "creative",
                concurrency: 1,
                referenceMode: "cells",
                referenceColumns: [
                    { id: "a:b", label: "1" },
                    { id: "c", label: "2" },
                ],
                rows: [
                    { id: "row:1", enabled: true, inputNodeIds: ["a", ""], prompt: "first", outputNodeId: "out" },
                    { id: "row2", enabled: true, inputNodeIds: ["a", "b"], prompt: "second" },
                ],
            },
        },
    };
    const nodes = [table, image("a"), image("b"), image("out")];
    return { nodes, table, edges: reconcileBatchCellConnections(nodes, []) };
}
test("cell replacement changes one binding and edge, retaining shared source, tasks and results", () => {
    const { nodes, edges } = fixture();
    const result = applyBatchReferenceEdits(nodes, edges, "table", [{ rowId: "row:1", columnId: "a:b", expectedSourceId: "a", sourceId: "b" }])!;
    expect(result.nodes[1]).toBe(nodes[1]);
    expect(result.nodes[0].metadata!.batchTable!.rows[1]).toBe(nodes[0].metadata!.batchTable!.rows[1]);
    expect(result.nodes[0].metadata!.batchTable!.rows[0]).toMatchObject({ inputNodeIds: ["b", ""], outputNodeId: "out", inputChanged: true, prompt: "first" });
    expect(result.connections.filter((e) => e.toHandleId === batchCellHandle("row:1", "a:b"))).toHaveLength(1);
    expect(reconcileBatchCellConnections(result.nodes, result.connections)).toBe(result.connections);
    expect(applyBatchReferenceEdits(result.nodes, result.connections, "table", [{ rowId: "row:1", columnId: "a:b", expectedSourceId: "a", sourceId: "b" }])).toBeUndefined();
});
test("stable cells survive insertion and column reorder, no accidental column fallback", () => {
    const { nodes, table, edges } = fixture();
    const original = table.metadata!.batchTable!;
    const inserted = insertBatchRow(original, "row:1")!;
    const changed = { ...table, metadata: { batchTable: reorderBatchReferenceColumns({ ...original, rows: inserted.rows }, "a:b", "c") } };
    const next = reconcileBatchCellConnections([changed, ...nodes.slice(1)], edges);
    expect(next.find((e) => e.toHandleId === batchCellHandle("row2", "c"))?.fromNodeId).toBe("b");
    expect(next.filter((e) => parseBatchCellHandle(e.toHandleId)?.rowId === inserted.row.id)).toHaveLength(1);
    expect(batchInputColumns(changed, next)).toEqual([[], []]);
});
test("deleting cell edge detaches its binding and does not resurrect it; deleting source preserves slots", () => {
    const { nodes, edges } = fixture();
    const remaining = edges.filter((e) => e.toHandleId !== batchCellHandle("row:1", "a:b"));
    const detached = applyCanvasConnectionPromptSync(nodes, edges, nodes, remaining);
    expect(detached[0].metadata!.batchTable!.rows[0].inputNodeIds).toEqual(["", ""]);
    expect(reconcileBatchCellConnections(detached, remaining)).toBe(remaining);
    const removed = removeCanvasNodes(nodes, new Set(["a", "out"])).nodes[0].metadata!.batchTable!;
    expect(removed.rows[1].inputNodeIds).toEqual(["", "b"]);
    expect(removed.rows[0].outputNodeId).toBeUndefined();
});
test("stale destination, locked table, wrong media and same-source changes never corrupt bindings", () => {
    const { nodes, edges } = fixture();
    const edit = { rowId: "row:1", columnId: "a:b", expectedSourceId: "a", sourceId: "b" };
    expect(applyBatchReferenceEdits(nodes, edges, "table", [{ ...edit, rowId: "deleted" }])).toBeUndefined();
    expect(
        applyBatchReferenceEdits(
            nodes.map((n) => (n.id === "table" ? { ...n, metadata: { ...n.metadata, locked: true } } : n)),
            edges,
            "table",
            [edit],
        ),
    ).toBeUndefined();
    expect(
        applyBatchReferenceEdits(
            nodes.map((n) => (n.id === "b" ? { ...n, type: CanvasNodeType.Text } : n)),
            edges,
            "table",
            [edit],
        ),
    ).toBeUndefined();
    expect(applyBatchReferenceEdits(nodes, edges, "table", [{ ...edit, sourceId: "a" }])!.nodes).toBe(nodes);
});
test("input changes retain old result and distinguish current prompt and shared media", () => {
    const { nodes, table } = fixture();
    const data = table.metadata!.batchTable!;
    const map = new Map(nodes.map((n) => [n.id, n]));
    const row = { ...data.rows[0], generatedInputSignature: batchRowInputSignature(data, data.rows[0], map) };
    expect(batchRowInputChanged(data, row, map)).toBe(false);
    expect(batchRowInputChanged({ ...data, globalPrompt: "new prompt" }, row, map)).toBe(true);
    map.set("a", { ...nodes[1], metadata: { storageKey: "resource:rotated" } });
    expect(batchRowInputChanged(data, row, map)).toBe(true);
    const synced = createBatchRowsFromColumns("creative", [["a"], [], ["b"]], [data.rows[0]]);
    expect(synced[0].inputNodeIds).toEqual(["a", "", "b"]);
    expect(synced[0].outputNodeId).toBe("out");
});
