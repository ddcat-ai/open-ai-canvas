import { describe, expect, test } from "bun:test";

import { batchReferenceHandleAtY, batchReferenceHandleId, createBatchRowsFromColumns, createBatchRowsFromInputs, TRY_ON_BATCH_PROMPT } from "@/lib/canvas/canvas-batch-table";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType } from "@/types/canvas";

describe("batch creation table", () => {
    test("creates one try-on row per person with the final image as the shared garment", () => {
        const rows = createBatchRowsFromInputs("try_on", ["person-1", "person-2", "person-3", "garment"]);

        expect(rows.map((row) => row.inputNodeIds)).toEqual([
            ["person-1", "garment"],
            ["person-2", "garment"],
            ["person-3", "garment"],
        ]);
        expect(rows.every((row) => row.prompt === TRY_ON_BATCH_PROMPT)).toBe(true);
    });

    test("creates one creative row per connected image", () => {
        expect(createBatchRowsFromInputs("creative", ["a", "b"]).map((row) => row.inputNodeIds)).toEqual([["a"], ["b"]]);
    });

    test("broadcasts a singleton reference column across rows", () => {
        expect(createBatchRowsFromColumns("try_on", [["person-1", "person-2"], ["garment"]]).map((row) => row.inputNodeIds)).toEqual([
            ["person-1", "garment"],
            ["person-2", "garment"],
        ]);
    });

    test("new canvas node has durable batch defaults", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });

        expect(node.title).toBe("批量创作表");
        expect(node.metadata?.batchTable).toEqual({ operation: "try_on", concurrency: 10, referenceColumns: [{ id: "reference-1", label: "参考图 1" }, { id: "reference-2", label: "参考图 2" }], rows: [] });
    });
    test("keeps the second reference handle addressable", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });
        const referenceColumns = [
            { id: "reference-1", label: "参考图 1" },
            { id: "reference-2", label: "参考图 2" },
        ];
        node.metadata = { ...node.metadata, batchTable: { operation: "try_on", concurrency: 10, referenceColumns, rows: [] } };

        expect(batchReferenceHandleAtY(node, node.position.y + 112 + 38)).toBe(batchReferenceHandleId("reference-2"));
    });

    test("chooses the nearest reference handle when magnetic hit areas overlap", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });

        expect(batchReferenceHandleAtY(node, node.position.y + 112 + 38, 90)).toBe(batchReferenceHandleId("reference-2"));
    });
});
