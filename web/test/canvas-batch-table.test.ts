import { describe, expect, test } from "bun:test";

import {
    batchPromptForRow,
    batchReferenceColumns,
    batchReferenceHandleAtY,
    batchReferenceHandleId,
    batchReferenceMentionToken,
    createBatchRowsFromColumns,
    createBatchRowsFromInputs,
    createInheritedBatchRow,
    moveBatchReferenceCell,
    promoteLegacyBatchTableSize,
    removeLastBatchReferenceColumn,
    reorderBatchReferenceColumns,
    BATCH_REFERENCE_HANDLE_GAP,
    BATCH_REFERENCE_HANDLE_TOP,
    TRY_ON_BATCH_PROMPT,
} from "@/lib/canvas/canvas-batch-table";
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

    test("inherits the previous row references when adding a manual task", () => {
        const row = createInheritedBatchRow("try_on", [{ id: "row-1", enabled: true, inputNodeIds: ["person-1", "garment"], prompt: "自定义提示词" }]);

        expect(row.inputNodeIds).toEqual(["person-1", "garment"]);
        expect(row.inputNodeIds).not.toBe(createInheritedBatchRow("try_on", [{ id: "row-1", enabled: true, inputNodeIds: ["person-1", "garment"], prompt: "自定义提示词" }]).inputNodeIds);
        expect(row.prompt).toBe(TRY_ON_BATCH_PROMPT);
    });

    test("syncing connections preserves unmatched manual rows", () => {
        const manual = { id: "manual-row", enabled: false, inputNodeIds: ["manual-image"], prompt: "保留手工任务" };
        const rows = createBatchRowsFromColumns("try_on", [["person-1"], ["garment"]], [manual]);

        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual(manual);
    });

    test("syncing unchanged references keeps the row identity and linked output", () => {
        const existing = { id: "row-1", enabled: true, inputNodeIds: ["person-1", "garment"], prompt: "保留提示词", outputNodeId: "output-1" };
        const [row] = createBatchRowsFromColumns("try_on", [["person-1"], ["garment"]], [existing]);

        expect(row).toEqual(existing);
    });

    test("uses stable prompt mention tokens for positional references", () => {
        expect(batchReferenceMentionToken(0)).toBe("@参考图1");
        expect(batchReferenceMentionToken(1)).toBe("@参考图2");
    });

    test("new canvas node has durable batch defaults", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });

        expect(node.title).toBe("批量创作表");
        expect(node.width).toBe(1280);
        expect(node.height).toBe(560);
        expect(node.metadata?.batchTable).toEqual({ operation: "try_on", concurrency: 10, referenceColumns: [{ id: "reference-1", label: "参考图 1" }, { id: "reference-2", label: "参考图 2" }, { id: "reference-3", label: "参考图 3" }], rows: [] });
    });

    test("promotes the previous 900-wide default without touching resized tables", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });
        const legacy = { ...node, width: 900, height: 520 };
        const resized = { ...node, width: 1100, height: 480 };

        expect(promoteLegacyBatchTableSize(legacy)).toEqual({ ...legacy, width: 1280, height: 560 });
        expect(promoteLegacyBatchTableSize(resized)).toBe(resized);
    });
    test("keeps a single explicitly stored reference column", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });
        node.metadata = { ...node.metadata, batchTable: { operation: "creative", concurrency: 10, referenceColumns: [{ id: "reference-1", label: "参考图 1" }], rows: [] } };

        expect(batchReferenceColumns(node.metadata.batchTable).map((column) => column.id)).toEqual(["reference-1"]);
    });

    test("removes the last reference column down to one and trims row inputs", () => {
        const table = {
            operation: "creative" as const,
            concurrency: 10,
            referenceColumns: [
                { id: "reference-1", label: "参考图 1" },
                { id: "reference-2", label: "参考图 2" },
                { id: "reference-3", label: "参考图 3" },
            ],
            rows: [{ id: "row-1", enabled: true, inputNodeIds: ["a", "b", "c"], prompt: "x" }],
        };

        const next = removeLastBatchReferenceColumn(table);
        expect(next?.referenceColumns?.map((column) => column.id)).toEqual(["reference-1", "reference-2"]);
        expect(next?.rows[0].inputNodeIds).toEqual(["a", "b"]);
        expect(removeLastBatchReferenceColumn({ ...table, referenceColumns: [{ id: "reference-1", label: "参考图 1" }] })).toBeNull();
    });

    test("keeps the second reference handle addressable", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });
        const referenceColumns = [
            { id: "reference-1", label: "参考图 1" },
            { id: "reference-2", label: "参考图 2" },
        ];
        node.metadata = { ...node.metadata, batchTable: { operation: "try_on", concurrency: 10, referenceColumns, rows: [] } };

        expect(batchReferenceHandleAtY(node, node.position.y + BATCH_REFERENCE_HANDLE_TOP + BATCH_REFERENCE_HANDLE_GAP)).toBe(batchReferenceHandleId("reference-2"));
    });

    test("chooses the nearest reference handle when magnetic hit areas overlap", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });

        expect(batchReferenceHandleAtY(node, node.position.y + BATCH_REFERENCE_HANDLE_TOP + BATCH_REFERENCE_HANDLE_GAP, 90)).toBe(batchReferenceHandleId("reference-2"));
    });

    test("reorders reference columns and keeps row inputs aligned", () => {
        const table = {
            operation: "try_on" as const,
            concurrency: 10,
            referenceColumns: [
                { id: "reference-1", label: "参考图 1" },
                { id: "reference-2", label: "参考图 2" },
                { id: "reference-3", label: "参考图 3" },
            ],
            rows: [{ id: "row-1", enabled: true, inputNodeIds: ["a", "b", "c"], prompt: "x" }],
        };
        const next = reorderBatchReferenceColumns(table, "reference-1", "reference-3");
        expect(next.referenceColumns?.map((column) => column.id)).toEqual(["reference-2", "reference-3", "reference-1"]);
        expect(next.rows[0].inputNodeIds).toEqual(["b", "c", "a"]);
    });

    test("swaps reference cells across rows and columns", () => {
        const table = {
            operation: "creative" as const,
            concurrency: 10,
            referenceColumns: [
                { id: "reference-1", label: "参考图 1" },
                { id: "reference-2", label: "参考图 2" },
            ],
            rows: [
                { id: "row-1", enabled: true, inputNodeIds: ["a", "b"], prompt: "one" },
                { id: "row-2", enabled: true, inputNodeIds: ["c", "d"], prompt: "two" },
            ],
        };
        const next = moveBatchReferenceCell(table, "row-1", 0, "row-2", 1);
        expect(next.rows[0].inputNodeIds).toEqual(["d", "b"]);
        expect(next.rows[1].inputNodeIds).toEqual(["c", "a"]);
    });

    test("uses a non-empty global prompt instead of the row prompt", () => {
        const table = { operation: "creative" as const, concurrency: 10, globalPrompt: " 全局覆盖 ", rows: [{ id: "row-1", enabled: true, inputNodeIds: ["a"], prompt: "行提示词" }] };
        expect(batchPromptForRow(table, table.rows[0])).toBe("全局覆盖");
        expect(batchPromptForRow({ ...table, globalPrompt: "   " }, table.rows[0])).toBe("行提示词");
    });
});
