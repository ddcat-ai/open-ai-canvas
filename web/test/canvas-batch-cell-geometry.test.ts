import { describe, expect, test } from "bun:test";

import { activeConnectionPath, canvasConnectionPath } from "../src/components/canvas/canvas-connections";
import { batchCellAnchor, batchCellConnectionError, batchCellHandle, BATCH_ROW_HEIGHT } from "../src/lib/canvas/canvas-batch-references";
import { getConnectionTargetAnchor } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const source: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", width: 300, height: 200, position: { x: 0, y: 0 }, metadata: { content: "/source.png" } };
const table: CanvasNodeData = {
    id: "table",
    type: CanvasNodeType.BatchTable,
    title: "表",
    width: 1280,
    height: 560,
    position: { x: 500, y: 100 },
    metadata: {
        batchTable: {
            operation: "creative",
            referenceColumns: [
                { id: "shared", label: "共同图片" },
                { id: "individual", label: "各行图片" },
            ],
            rows: Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}`, prompt: `任务${i}`, inputNodeIds: [source.id, ""] })),
        },
    },
};
const targetHandle = batchCellHandle("row-1", "individual");
const connection = { id: "cell", fromNodeId: source.id, toNodeId: table.id, toHandleId: targetHandle };

describe("batch cell connection geometry", () => {
    test("saved, snapping and draft paths end at the same cell across two-axis scrolling", () => {
        for (const scroll of [
            { top: 0, left: 0 },
            { top: 100, left: 30 },
            { top: 600, left: 300 },
        ]) {
            const cell = batchCellAnchor(table, targetHandle, scroll)!;
            const path = canvasConnectionPath(connection, source, table, 0, 0, undefined, scroll);
            const snap = getConnectionTargetAnchor(table, { nodeId: source.id, handleType: "source" }, targetHandle, 0, scroll);
            const draft = activeConnectionPath(source, { nodeId: source.id, handleType: "source" }, { x: 0, y: 0 }, table, 0, targetHandle, undefined, scroll);
            expect({ x: path.endX, y: path.endY }).toEqual(snap);
            expect(snap).toEqual({ x: cell.x, y: cell.y });
            expect(draft.endsWith(`${cell.x} ${cell.y}`)).toBe(true);
        }
    });

    test("insertion keeps stable row identity and moves its anchor by exactly one row", () => {
        const cell = batchCellAnchor(table, targetHandle)!;
        const inserted = { ...table, metadata: { ...table.metadata, batchTable: { ...table.metadata!.batchTable!, rows: [{ id: "new", inputNodeIds: [], prompt: "" }, ...table.metadata!.batchTable!.rows] } } };
        const moved = batchCellAnchor(inserted, targetHandle)!;
        expect(moved.y - cell.y).toBe(BATCH_ROW_HEIGHT);
        expect(moved.label).toBe("任务 3 · 参考图 2");
    });

    test("offscreen references gather at the correct boundary and retain their row label", () => {
        const below = batchCellAnchor(table, batchCellHandle("row-5", "individual"))!;
        const above = batchCellAnchor(table, targetHandle, { top: 1000, left: 0 })!;
        expect(below.clipped).toBe(true);
        expect(below.y).toBe(table.position.y + table.height - 8);
        expect(below.label).toBe("任务 6 · 参考图 2");
        expect(above.clipped).toBe(true);
        expect(above.y).toBe(table.position.y + 161);
        expect(above.label).toBe("任务 2 · 参考图 2");
        expect(batchCellAnchor(table, batchCellHandle("deleted", "individual"))).toBeUndefined();
        expect(canvasConnectionPath({ ...connection, toHandleId: batchCellHandle("deleted", "individual") }, source, table).pathD).toBe("");
    });

    test("reverse drag from a cell starts from its actual port; ordinary node ports stay centered", () => {
        const cell = batchCellAnchor(table, targetHandle)!;
        const reverse = activeConnectionPath(table, { nodeId: table.id, handleType: "target", handleId: targetHandle }, { x: 0, y: 0 }, source);
        expect(reverse.startsWith("M 300 100 ")).toBe(true);
        expect(reverse.endsWith(`${cell.x} ${cell.y}`)).toBe(true);
        const normal = canvasConnectionPath({ ...connection, toHandleId: undefined }, source, { ...source, id: "other", position: { x: 500, y: 50 } });
        expect({ x: normal.endX, y: normal.endY }).toEqual({ x: 500, y: 150 });
    });
});

test("cell connection admission rejects text, empty images, locks and stale row identities", () => {
    expect(batchCellConnectionError([source, table], source.id, table.id, targetHandle)).toBe("");
    expect(batchCellConnectionError([{ ...source, type: CanvasNodeType.Text }, table], source.id, table.id, targetHandle)).toContain("只接受图片");
    expect(batchCellConnectionError([{ ...source, metadata: {} }, table], source.id, table.id, targetHandle)).toContain("添加图片");
    expect(batchCellConnectionError([source, { ...table, metadata: { ...table.metadata, locked: true } }], source.id, table.id, targetHandle)).toContain("锁定");
    expect(batchCellConnectionError([source, table], source.id, table.id, batchCellHandle("deleted", "individual"))).toContain("找不到");
    expect(batchCellConnectionError([source, table], source.id, table.id, batchCellHandle("row-1", "deleted"))).toContain("找不到");
});
