import { describe, expect, test } from "bun:test";
import { applyCanvasImageRotation, canRotateCanvasImage, commitCanvasImageRotation, currentImageRotation, imageRotationSourceKey, nextImageQuarterTurns, type CanvasImageRotation } from "@/lib/canvas/canvas-image-rotation";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { canvasResourceIds } from "@/services/canvas-missing-resources";
import { prepareCanvasImageRotation } from "@/services/canvas-image-rotation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const image = (key: string, width: number, height: number) => ({ content: `/api/resources/${key}/file`, storageKey: `resource:${key}`, width, height, bytes: 100, mimeType: "image/png" });
const original = image("original", 600, 400);
const variants = { 1: image("clockwise", 400, 600), 2: image("upside-down", 600, 400), 3: image("counterclockwise", 400, 600) };
const node: CanvasNodeData = {
    id: "image",
    type: CanvasNodeType.Image,
    title: "图片",
    position: { x: 20, y: 40 },
    width: 300,
    height: 200,
    metadata: { content: original.content, storageKey: original.storageKey, naturalWidth: 600, naturalHeight: 400, status: "success", taskId: "old-task", assetId: "old-output" },
};
const rotation = (quarterTurns: CanvasImageRotation["quarterTurns"]): CanvasImageRotation => ({ original, variants, quarterTurns });

describe("image direction correction", () => {
    test("90 / 180 / 270 / restore preserve node identity, center and reusable original", () => {
        let current = node;
        for (const quarterTurns of [1, 2, 3, 0] as const) {
            current = applyCanvasImageRotation(current, rotation(quarterTurns));
            expect(current.id).toBe(node.id);
            expect(current.position.x + current.width / 2).toBe(170);
            expect(current.position.y + current.height / 2).toBe(140);
            expect([current.width, current.height]).toEqual(quarterTurns % 2 ? [200, 300] : [300, 200]);
            expect([current.metadata?.naturalWidth, current.metadata?.naturalHeight]).toEqual(quarterTurns % 2 ? [400, 600] : [600, 400]);
            expect(current.metadata?.imageRotation?.original).toBe(original);
        }
        expect(current.metadata?.storageKey).toBe(original.storageKey);
        expect(node.metadata?.storageKey).toBe(original.storageKey);
        expect(node.metadata?.taskId).toBe("old-task");
    });

    test("new downstream references use corrected bytes while an earlier reference remains frozen", () => {
        const submitted = nodeReferenceImage(node)!;
        const next = applyCanvasImageRotation(node, rotation(1));
        expect(nodeReferenceImage(next)?.storageKey).toBe("resource:clockwise");
        expect(submitted.storageKey).toBe("resource:original");
        expect(next.metadata?.taskId).toBeUndefined();
        expect(next.metadata?.assetId).toBeUndefined();
        expect(next.metadata?.status).toBe("success");
    });

    test("replacement invalidates old rotation state so restore cannot resurrect the previous image", () => {
        const turned = applyCanvasImageRotation(node, rotation(1));
        const replaced = { ...turned, metadata: { ...turned.metadata, storageKey: "resource:new", content: "/api/resources/new/file" } };
        expect(currentImageRotation(turned)?.quarterTurns).toBe(1);
        expect(currentImageRotation(replaced)).toBeUndefined();
        expect(imageRotationSourceKey(replaced)).not.toBe(imageRotationSourceKey(turned));
    });

    test("cached directions and restore do not decode or upload again", async () => {
        const turned = applyCanvasImageRotation(node, rotation(1));
        expect((await prepareCanvasImageRotation(turned, 1))?.rotation.quarterTurns).toBe(2);
        expect((await prepareCanvasImageRotation(turned, -1))?.rotation.original.storageKey).toBe(original.storageKey);
        expect((await prepareCanvasImageRotation(turned, 0))?.rotation.quarterTurns).toBe(0);
        expect(await prepareCanvasImageRotation(node, 0)).toBeNull();
    });

    test("a stale page or account cancels before reading or uploading an image", async () => {
        await expect(prepareCanvasImageRotation(node, 1, () => false)).rejects.toThrow("图片旋转已取消");
    });

    test("original and all generated direction files remain discoverable by resource retention", () => {
        const turned = applyCanvasImageRotation(node, rotation(3));
        expect([...canvasResourceIds({ nodes: [turned] })].sort()).toEqual(["clockwise", "counterclockwise", "original", "upside-down"]);
    });

    test("shared source correction marks legacy results stale without changing their pixels or queued tasks", () => {
        const table: CanvasNodeData = {
            id: "table",
            type: CanvasNodeType.BatchTable,
            title: "任务",
            position: { x: 0, y: 0 },
            width: 1280,
            height: 560,
            metadata: {
                batchTable: {
                    operation: "creative",
                    concurrency: 1,
                    rows: [
                        { id: "old-result", enabled: true, inputNodeIds: [node.id], prompt: "old", outputNodeId: "result" },
                        { id: "no-result", enabled: true, inputNodeIds: [node.id], prompt: "queued" },
                        { id: "other-source", enabled: true, inputNodeIds: ["unrelated"], prompt: "other", outputNodeId: "other-result" },
                    ],
                },
            },
        };
        const result = { ...node, id: "result", metadata: { ...node.metadata, content: "finished.png", storageKey: "resource:finished" } };
        const nodes = [node, table, result];
        const next = commitCanvasImageRotation(nodes, node.id, imageRotationSourceKey(node), rotation(1));
        expect(next[1].metadata?.batchTable?.rows[0].inputChanged).toBe(true);
        expect(next[1].metadata?.batchTable?.rows[1]).toBe(table.metadata!.batchTable!.rows[1]);
        expect(next[1].metadata?.batchTable?.rows[2]).toBe(table.metadata!.batchTable!.rows[2]);
        expect(next[2]).toBe(result);
        expect(commitCanvasImageRotation(nodes, node.id, "stale-image", rotation(1))).toBe(nodes);
    });

    test("locked, loading, empty and composite images are rejected", () => {
        expect(canRotateCanvasImage(node)).toBe(true);
        expect(canRotateCanvasImage({ ...node, metadata: { ...node.metadata, locked: true } })).toBe(false);
        expect(canRotateCanvasImage({ ...node, metadata: { ...node.metadata, status: "loading" } })).toBe(false);
        expect(canRotateCanvasImage({ ...node, metadata: { ...node.metadata, status: "idle", batchSourceNodeId: "table", batchRowId: "row", batchInputSignature: "next" } })).toBe(false);
        expect(canRotateCanvasImage({ ...node, metadata: {} })).toBe(false);
        expect(canRotateCanvasImage({ ...node, metadata: { ...node.metadata, imageLayer: { groupId: "group", outputIndex: 0 } } })).toBe(false);
        expect(nextImageQuarterTurns(0, -1)).toBe(3);
        expect(nextImageQuarterTurns(3, 1)).toBe(0);
    });
});
