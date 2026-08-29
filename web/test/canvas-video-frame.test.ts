import { describe, expect, test } from "bun:test";

import { buildVideoFrameNodes } from "../src/lib/canvas/canvas-video-frame-nodes";
import { normalizeVideoFrameTimes } from "../src/lib/canvas/canvas-video-frame";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const sourceNode: CanvasNodeData = {
    id: "video-source",
    type: CanvasNodeType.Video,
    title: "测试视频",
    position: { x: 100, y: 200 },
    width: 640,
    height: 360,
    metadata: { workflowKind: "shot", workflowTitle: "镜头 1", shotIndex: 1 },
};

describe("normalizeVideoFrameTimes", () => {
    test("按时间排序、去重并限制在可解码范围内", () => {
        expect(normalizeVideoFrameTimes([1500, 0, 1500.4, -20, 16000, Number.NaN], 15000)).toEqual([0, 1500, 14999]);
    });

    test("视频时长无效时不返回时间点", () => {
        expect(normalizeVideoFrameTimes([0, 1000], 0)).toEqual([]);
    });
});

describe("buildVideoFrameNodes", () => {
    test("为每个时间点创建可追溯的图片节点并保持网格布局", () => {
        const nodes = buildVideoFrameNodes(sourceNode, [
            { timeMs: 0, image: { url: "blob:first", storageKey: "image:first", width: 1280, height: 720, bytes: 10, mimeType: "image/png" } },
            { timeMs: 1500, image: { url: "blob:middle", storageKey: "image:middle", width: 1280, height: 720, bytes: 20, mimeType: "image/png" } },
            { timeMs: 14999, image: { url: "blob:last", storageKey: "image:last", width: 1280, height: 720, bytes: 30, mimeType: "image/png" } },
        ]);

        expect(nodes).toHaveLength(3);
        expect(nodes.map((node) => node.metadata?.videoFrameTimeMs)).toEqual([0, 1500, 14999]);
        expect(nodes.every((node) => node.metadata?.videoFrameSourceNodeId === sourceNode.id)).toBe(true);
        expect(nodes.every((node) => node.metadata?.workflowKind === "shot" && node.metadata?.shotIndex === 1)).toBe(true);
        expect(nodes[0].position.x).toBe(sourceNode.position.x + sourceNode.width + 96);
        expect(nodes[1].position.x).toBeGreaterThan(nodes[0].position.x);
        expect(nodes[2].position.y).toBeGreaterThan(nodes[0].position.y);
    });
});
