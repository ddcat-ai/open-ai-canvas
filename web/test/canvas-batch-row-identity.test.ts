import { expect, test } from "bun:test";
import { applyBatchReferenceEdits, reconcileBatchCellConnections, syncBatchColumnReferences } from "@/lib/canvas/canvas-batch-references";
import { batchReferenceHandleId, insertBatchRow } from "@/lib/canvas/canvas-batch-table";
import { isolateCopiedNodeMetadata } from "@/lib/canvas/canvas-node-copy";
import { CanvasNodeType, type CanvasBatchRow, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function fixture() {
    const table: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "任务表",
        position: { x: 500, y: 0 },
        width: 1280,
        height: 560,
        metadata: {
            batchTable: {
                operation: "creative",
                concurrency: 2,
                referenceColumns: [
                    { id: "person", label: "人物" },
                    { id: "shared", label: "共用素材" },
                ],
                rows: ["r1", "r2", "r3"].map((id) => ({ id, enabled: true, prompt: `提示词 ${id}`, inputNodeIds: [], outputNodeId: `result-${id}` })),
            },
        },
    };
    const images: CanvasNodeData[] = ["A", "B", "C", "D", "E", "X", "Y"].map((id) => ({
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 200,
        height: 100,
        metadata: { storageKey: `resource:${id}` },
    }));
    const edges: CanvasConnection[] = [
        ...["A", "B", "C"].map((id) => ({ id: `person-${id}`, fromNodeId: id, toNodeId: "table", toHandleId: batchReferenceHandleId("person") })),
        { id: "shared", fromNodeId: "X", toNodeId: "table", toHandleId: batchReferenceHandleId("shared") },
    ];
    return { nodes: syncBatchColumnReferences([table, ...images], edges), edges };
}

const tableOf = (nodes: CanvasNodeData[], id = "table") => nodes.find((node) => node.id === id)!.metadata!.batchTable!;
const rowsOf = (nodes: CanvasNodeData[], id = "table") => tableOf(nodes, id).rows;
const bindings = (nodes: CanvasNodeData[], id = "table") => rowsOf(nodes, id).map((row) => ({ id: row.id, inputs: row.inputNodeIds }));
function withRows(nodes: CanvasNodeData[], rows: CanvasBatchRow[]) {
    return nodes.map((node) => (node.id === "table" ? { ...node, metadata: { ...node.metadata, batchTable: { ...tableOf(nodes), rows } } } : node));
}

test("multiple column inputs initially follow connection order; insertion keeps each existing task's images across reopen", () => {
    const { nodes, edges } = fixture();
    expect(bindings(nodes)).toEqual([
        { id: "r1", inputs: ["A", "X"] },
        { id: "r2", inputs: ["B", "X"] },
        { id: "r3", inputs: ["C", "X"] },
    ]);
    const inserted = insertBatchRow(tableOf(nodes), "r1")!;
    const edited = withRows(nodes, inserted.rows);
    const next = syncBatchColumnReferences(edited, reconcileBatchCellConnections(edited, edges));
    const expected = [
        { id: "r1", inputs: ["A", "X"] },
        { id: inserted.row.id, inputs: ["A", "X"] },
        { id: "r2", inputs: ["B", "X"] },
        { id: "r3", inputs: ["C", "X"] },
    ];
    expect(bindings(next)).toEqual(expected);
    expect(rowsOf(next)[2]).toMatchObject({ prompt: "提示词 r2", outputNodeId: "result-r2" });
    expect(rowsOf(next)[1].outputNodeId).toBeUndefined();
    const reopened = syncBatchColumnReferences(JSON.parse(JSON.stringify(next)), edges);
    expect(bindings(reopened)).toEqual(expected);
    expect(syncBatchColumnReferences(reopened, edges)).toBe(reopened);
});

test("deleting one or all tasks does not replenish rows while column inputs stay unchanged", () => {
    const { nodes, edges } = fixture();
    const deleted = withRows(
        nodes,
        rowsOf(nodes).filter((row) => row.id !== "r2"),
    );
    const next = syncBatchColumnReferences(deleted, reconcileBatchCellConnections(deleted, edges));
    expect(bindings(next)).toEqual([
        { id: "r1", inputs: ["A", "X"] },
        { id: "r3", inputs: ["C", "X"] },
    ]);
    const moved = next.map((node) => (node.id === "A" ? { ...node, position: { x: 100, y: 50 } } : node));
    expect(bindings(syncBatchColumnReferences(moved, edges))).toEqual(bindings(next));
    const empty = withRows(next, []);
    expect(rowsOf(syncBatchColumnReferences(JSON.parse(JSON.stringify(empty)), edges))).toEqual([]);
});

test("changing one column leaves other assignments intact; adding a multiple input still applies its current order", () => {
    const { nodes, edges } = fixture();
    const deleted = withRows(
        nodes,
        rowsOf(nodes).filter((row) => row.id !== "r2"),
    );
    const changedShared = edges.map((edge) => (edge.id === "shared" ? { ...edge, fromNodeId: "Y" } : edge));
    const next = syncBatchColumnReferences(deleted, changedShared);
    expect(bindings(next)).toEqual([
        { id: "r1", inputs: ["A", "Y"] },
        { id: "r3", inputs: ["C", "Y"] },
    ]);
    const newEdges = [...changedShared, { id: "person-D", fromNodeId: "D", toNodeId: "table", toHandleId: batchReferenceHandleId("person") }];
    const connected = syncBatchColumnReferences(next, newEdges);
    expect(rowsOf(connected).map((row) => row.inputNodeIds)).toEqual([
        ["A", "Y"],
        ["B", "Y"],
        ["C", "Y"],
        ["D", "Y"],
    ]);
    expect(
        rowsOf(connected)
            .slice(0, 2)
            .map((row) => row.id),
    ).toEqual(["r1", "r3"]);
    expect(rowsOf(connected)[1]).toMatchObject({ prompt: "提示词 r3", outputNodeId: "result-r3" });
});

test("explicit replacements and deliberately empty cells survive actual column changes after row deletion", () => {
    const { nodes, edges } = fixture();
    const edited = applyBatchReferenceEdits(nodes, edges, "table", [
        { rowId: "r1", columnId: "person", sourceId: "D", expectedSourceId: "A" },
        { rowId: "r3", columnId: "person", sourceId: "", expectedSourceId: "C" },
    ])!;
    const deleted = withRows(
        edited.nodes,
        rowsOf(edited.nodes).filter((row) => row.id !== "r2"),
    );
    const changed = edited.connections.map((edge) => (edge.id === "person-A" ? { ...edge, fromNodeId: "E" } : edge));
    const next = syncBatchColumnReferences(deleted, changed);
    expect(rowsOf(next).find((row) => row.id === "r1")!.inputNodeIds).toEqual(["D", "X"]);
    expect(rowsOf(next).find((row) => row.id === "r3")!.inputNodeIds).toEqual(["", "X"]);
});

test("copying a table with its input images remaps the applied-column snapshot and preserves inserted-row bindings", () => {
    const { nodes, edges } = fixture();
    const inserted = insertBatchRow(tableOf(nodes), "r1")!;
    const edited = withRows(nodes, inserted.rows);
    const idMap = new Map(edited.map((node) => [node.id, `copy-${node.id}`]));
    const copied = edited.map((node) => ({ ...node, id: idMap.get(node.id)!, metadata: isolateCopiedNodeMetadata(node, idMap) }));
    const copiedEdges = edges.map((edge) => ({ ...edge, id: `copy-${edge.id}`, fromNodeId: idMap.get(edge.fromNodeId)!, toNodeId: idMap.get(edge.toNodeId)! }));
    const next = syncBatchColumnReferences(JSON.parse(JSON.stringify(copied)), copiedEdges);
    expect(bindings(next, "copy-table")).toEqual([
        { id: "r1", inputs: ["copy-A", "copy-X"] },
        { id: inserted.row.id, inputs: ["copy-A", "copy-X"] },
        { id: "r2", inputs: ["copy-B", "copy-X"] },
        { id: "r3", inputs: ["copy-C", "copy-X"] },
    ]);
});
