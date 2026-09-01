import { describe, expect, test } from "bun:test";

import { buildCanvasSpatialIndex, canvasNodeBounds } from "@/lib/canvas/canvas-spatial-index";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas spatial index", () => {
    test("queries intersecting entries across buckets in source order", () => {
        const index = buildCanvasSpatialIndex([
            { id: "far", bounds: { left: 2048, top: 0, right: 2200, bottom: 120 }, value: "far" },
            { id: "near", bounds: { left: 900, top: 40, right: 1100, bottom: 160 }, value: "near" },
            { id: "cross", bounds: { left: 1000, top: -40, right: 2100, bottom: 40 }, value: "cross" },
        ], 1024);

        expect(index.query({ left: 950, top: 0, right: 1150, bottom: 100 })).toEqual(["near", "cross"]);
        expect(index.query({ left: 2100, top: 0, right: 2200, bottom: 100 })).toEqual(["far"]);
    });

    test("does not return edge-touching or invalid entries", () => {
        const index = buildCanvasSpatialIndex([
            { id: "touching", bounds: { left: 0, top: 0, right: 10, bottom: 10 }, value: "touching" },
            { id: "invalid", bounds: { left: 0, top: 0, right: 0, bottom: 10 }, value: "invalid" },
        ]);

        expect(index.query({ left: 10, top: 0, right: 20, bottom: 10 })).toEqual([]);
        expect(index.query({ left: 1, top: 1, right: 2, bottom: 2 })).toEqual(["touching"]);
    });

    test("builds bounds from canvas node geometry", () => {
        expect(canvasNodeBounds({ position: { x: -20, y: 30 }, width: 120, height: 80 })).toEqual({ left: -20, top: 30, right: 100, bottom: 110 });
    });

    test("keeps very large entries out of the bucket build loop", () => {
        const index = buildCanvasSpatialIndex([
            { id: "large", bounds: { left: -100_000, top: -100_000, right: 100_000, bottom: 100_000 }, value: "large" },
            { id: "small", bounds: { left: 20_000, top: 20_000, right: 20_100, bottom: 20_100 }, value: "small" },
        ], 100);

        expect(index.query({ left: 0, top: 0, right: 10, bottom: 10 })).toEqual(["large"]);
        expect(index.query({ left: 20_000, top: 20_000, right: 20_050, bottom: 20_050 })).toEqual(["large", "small"]);
    });

    test("supports a bounded query for dense buckets", () => {
        const index = buildCanvasSpatialIndex(Array.from({ length: 10 }, (_, index) => ({
            id: `node-${index}`,
            bounds: { left: index * 2, top: 0, right: index * 2 + 1, bottom: 1 },
            value: index,
        })));

        expect(index.query({ left: 0, top: 0, right: 100, bottom: 100 }, 3)).toEqual([0, 1, 2]);
    });

    test("keeps the target 50k canvas mix query-bounded", () => {
        const nodes = buildLargeCanvasFixture();
        const counts = nodes.reduce<Record<string, number>>((result, node) => {
            result[node.type] = (result[node.type] || 0) + 1;
            return result;
        }, {});
        expect(counts[CanvasNodeType.Image]).toBe(35000);
        expect(counts[CanvasNodeType.Video]).toBe(14000);
        expect(counts[CanvasNodeType.Text]).toBe(1000);

        const index = buildCanvasSpatialIndex(nodes.map((node) => ({ id: node.id, bounds: canvasNodeBounds(node), value: node.id })));
        const visible = index.query({ left: 0, top: 0, right: 1600, bottom: 900 }, 720);
        expect(visible.length).toBeLessThanOrEqual(720);
        expect(visible.every((id) => id.startsWith("node"))).toBe(true);
    });
});

function buildLargeCanvasFixture(): CanvasNodeData[] {
    return Array.from({ length: 50000 }, (_, index) => ({
        id: `node${index}`,
        type: index < 35000 ? CanvasNodeType.Image : index < 49000 ? CanvasNodeType.Video : CanvasNodeType.Text,
        title: `节点 ${index}`,
        position: { x: (index % 250) * 360, y: Math.floor(index / 250) * 220 },
        width: 320,
        height: 180,
        metadata: {},
    }));
}
