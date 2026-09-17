import { describe, expect, test } from "bun:test";

import { batchGridTemplateColumns, batchPromptForRow, batchReferenceHandleAtY, batchReferenceHandleId, batchTextHandleId, batchTextHandleTop, createBatchRowsFromColumns, createBatchRowsFromInputs, CREATIVE_BATCH_PROMPT, moveBatchReferenceCell, reorderBatchReferenceColumns, TRY_ON_BATCH_PROMPT } from "@/lib/canvas/canvas-batch-table";
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
        expect(node.metadata?.batchTable).toEqual({ operation: "try_on", concurrency: 10, referenceColumns: [{ id: "reference-1", label: "参考图 1" }, { id: "reference-2", label: "参考图 2" }, { id: "reference-3", label: "参考图 3" }], rows: [] });
    });
    test("keeps the third reference handle addressable", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });

        expect(batchReferenceHandleAtY(node, node.position.y + 112 + 2 * 38)).toBe(batchReferenceHandleId("reference-3"));
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

    test("keeps text handles separated from reference controls", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });
        node.metadata = { ...node.metadata, batchTable: { ...node.metadata?.batchTable!, textColumns: [{ id: "text-1", label: "文字 1" }] } };

        expect(batchReferenceHandleAtY(node, node.position.y + batchTextHandleTop(3))).toBe(batchTextHandleId("text-1"));
        expect(batchTextHandleTop(3)).toBeGreaterThan(112 + 3 * 38);
    });

    test("global prompt overrides a row prompt without changing the row data", () => {
        const node = createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 300 });
        const table = node.metadata?.batchTable!;
        const row = createBatchRowsFromInputs("creative", ["image-1"])[0];

        expect(batchPromptForRow(table, row)).toBe(row.prompt);
        expect(batchPromptForRow({ ...table, globalPrompt: "统一风格：高级商业摄影" }, row)).toBe("统一风格：高级商业摄影");
        expect(row.prompt).toBe(CREATIVE_BATCH_PROMPT);
    });

    test("legacy rows without enabled stay enabled by default", () => {
        const row = createBatchRowsFromInputs("creative", ["image-1"])[0];
        expect(row.enabled).toBe(true);
        expect({ ...row, enabled: undefined }.enabled === false).toBe(false);
    });

    test("keeps the table grid valid when no text columns exist", () => {
        const withoutText = batchGridTemplateColumns(3, 0);
        const withText = batchGridTemplateColumns(3, 1);

        expect(withoutText).not.toContain("repeat(0,");
        expect(withoutText).toContain("68px");
        expect(withoutText).toContain("repeat(3, 88px)");
        expect(withText).toContain("repeat(1, minmax(168px, 0.75fr))");
    });

    test("reorders reference columns and keeps row materials aligned", () => {
        const table = {
            operation: "creative" as const,
            concurrency: 10,
            referenceColumns: [
                { id: "reference-1", label: "参考图 1" },
                { id: "reference-2", label: "参考图 2" },
                { id: "reference-3", label: "参考图 3" },
            ],
            rows: [{ id: "row-1", enabled: true, inputNodeIds: ["a", "b", "c"], prompt: "" }],
        };
        const reordered = reorderBatchReferenceColumns(table, "reference-1", "reference-3");

        expect(reordered.referenceColumns?.map((column) => column.label)).toEqual(["参考图 1", "参考图 2", "参考图 3"]);
        expect(reordered.referenceColumns?.map((column) => column.id)).toEqual(["reference-2", "reference-3", "reference-1"]);
        expect(reordered.rows[0].inputNodeIds).toEqual(["b", "c", "a"]);
    });

    test("moves a reference image into an empty slot across rows", () => {
        const table = {
            operation: "creative" as const,
            concurrency: 10,
            referenceColumns: [
                { id: "reference-1", label: "参考图 1" },
                { id: "reference-2", label: "参考图 2" },
            ],
            rows: [
                { id: "row-1", enabled: true, inputNodeIds: ["a", ""], prompt: "" },
                { id: "row-2", enabled: true, inputNodeIds: ["b", ""], prompt: "" },
            ],
        };

        const moved = moveBatchReferenceCell(table, "row-1", 0, "row-2", 1);

        expect(moved.rows.map((row) => row.inputNodeIds)).toEqual([["", ""], ["b", "a"]]);
    });

    test("swaps reference images when the target slot is occupied", () => {
        const table = {
            operation: "creative" as const,
            concurrency: 10,
            referenceColumns: [{ id: "reference-1", label: "参考图 1" }, { id: "reference-2", label: "参考图 2" }],
            rows: [{ id: "row-1", enabled: true, inputNodeIds: ["a", "b"], prompt: "" }, { id: "row-2", enabled: true, inputNodeIds: ["c", "d"], prompt: "" }],
        };

        const swapped = moveBatchReferenceCell(table, "row-1", 0, "row-2", 1);

        expect(swapped.rows.map((row) => row.inputNodeIds)).toEqual([["d", "b"], ["c", "a"]]);
    });
});
