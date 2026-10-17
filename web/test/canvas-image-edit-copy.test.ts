import { expect, test } from "bun:test";
import { createCanvasImageEditCopy } from "@/lib/canvas/canvas-image-edit-copy";
import { applyCanvasImageRotation } from "@/lib/canvas/canvas-image-rotation";
import { imageWheelSize } from "@/pages/canvas/use-canvas-image-wheel-resize";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
const source: CanvasNodeData = {
    id: "original",
    type: CanvasNodeType.Image,
    title: "原图",
    position: { x: 20, y: 40 },
    width: 360,
    height: 240,
    metadata: { storageKey: "resource:original", content: "/api/resources/original", naturalWidth: 1200, naturalHeight: 800, batchSourceNodeId: "table", batchRowId: "row", taskId: "old-task" },
};
test("edit copy leaves source and task ownership intact, links the new node, and rotates that copy", () => {
    const copy = createCanvasImageEditCopy(source, [source])!;
    expect(copy.node.metadata).toMatchObject({ imageEditSourceNodeId: "original", storageKey: "resource:original" });
    expect(copy.node.metadata?.batchSourceNodeId).toBeUndefined();
    expect(copy.node.metadata?.batchRowId).toBeUndefined();
    expect(copy.node.metadata?.taskId).toBeUndefined();
    expect(copy.connection).toMatchObject({ fromNodeId: "original", toNodeId: copy.node.id });
    const turned = applyCanvasImageRotation(copy.node, {
        original: { content: "/original", storageKey: "resource:original", width: 1200, height: 800 },
        quarterTurns: 1,
        variants: { 1: { content: "/rotated", storageKey: "resource:rotated", width: 800, height: 1200 } },
    });
    expect(turned.id).toBe(copy.node.id);
    expect(turned.metadata?.storageKey).toBe("resource:rotated");
    expect(turned.metadata?.imageEditSourceNodeId).toBe("original");
    expect(source.metadata?.storageKey).toBe("resource:original");
    expect(source.metadata?.batchRowId).toBe("row");
    expect([turned.width, turned.height]).toEqual([240, 360]);
});
test("copy refuses locked, uploading, loading and empty nodes; a copy starts at visible orientation", () => {
    for (const metadata of [{ ...source.metadata, locked: true }, { ...source.metadata, status: "loading" as const }, {}]) expect(createCanvasImageEditCopy({ ...source, metadata }, [source])).toBeUndefined();
    const copied = createCanvasImageEditCopy({ ...source, metadata: { ...source.metadata, imageRotation: { quarterTurns: 1, original: { content: "/old", width: 800, height: 1200 } } } }, [source])!;
    expect(copied.node.metadata?.imageRotation).toBeUndefined();
});
test("wheel resize preserves the current aspect ratio and center, clamps at corner-resize minimum, and never changes pixels", () => {
    for (const [width, height] of [
        [360, 240],
        [240, 360],
        [80, 1200],
        [1500, 100],
    ]) {
        let node = { ...source, width, height };
        const center = { x: node.position.x + width / 2, y: node.position.y + height / 2 };
        for (const delta of [-100, -100, 100, 100, ...Array(80).fill(200)]) {
            const next = imageWheelSize(node, delta);
            node = { ...node, ...next };
            expect(next.width / next.height).toBeCloseTo(width / height, 9);
            expect(next.position.x + next.width / 2).toBeCloseTo(center.x, 8);
            expect(next.position.y + next.height / 2).toBeCloseTo(center.y, 8);
            expect(next.width).toBeGreaterThan(0);
            expect(next.height).toBeGreaterThan(0);
        }
        expect(node.metadata).toBe(source.metadata);
        expect(Math.max(node.width, node.height)).toBeCloseTo(160, 8);
    }
});
test("shrinking an imported portrait does not enlarge it to the media-panel minimum", () => {
    const portrait = { ...source, width: 260, height: 520 };
    const next = imageWheelSize(portrait, 100);
    expect(next.width).toBeLessThan(260);
    expect(next.height).toBeLessThan(520);
    expect(next.width / next.height).toBe(0.5);
});
