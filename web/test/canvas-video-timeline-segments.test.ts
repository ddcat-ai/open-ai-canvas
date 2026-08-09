import { describe, expect, test } from "bun:test";

import { buildTimelineImportSegments } from "../src/lib/canvas/canvas-video-timeline-segments";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import type { TimelineProject } from "../src/types/timeline";

function videoNode(id: string, title: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content: `data:video/mp4;base64,${id}`, durationMs: 10_000 },
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `conn-${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

const timeline: TimelineProject = {
    version: 2,
    tracks: [],
    clips: [
        {
            id: "clip-1",
            kind: "video",
            nodeId: "source-video",
            trackId: "video",
            startMs: 0,
            durationMs: 3_000,
            title: "源视频",
            sourceStartMs: 2_000,
            sourceDurationMs: 3_000,
        },
    ],
    durationMs: 3_000,
};

describe("buildTimelineImportSegments", () => {
    test("下游节点能从上游视频节点导入时间线片段", () => {
        const source = videoNode("source-video", "源视频");
        const segment = videoNode("segment-video", "片段");
        const target = videoNode("target-video", "结果");
        const nodes = [target, segment, source];
        const connections = [connection("source-video", "segment-video"), connection("segment-video", "target-video")];
        const result = buildTimelineImportSegments(target, nodes, connections, timeline, 10_000);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).toMatchObject({ startMs: 2_000, endMs: 5_000, sourceNodeId: "source-video" });
    });

    test("旧数据 nodeId 不一致时按唯一标题回退匹配", () => {
        const source = videoNode("source-video", "源视频");
        const target = videoNode("target-video", "结果");
        const nodes = [target, source];
        const connections = [connection("source-video", "target-video")];
        const oldTimeline: TimelineProject = {
            ...timeline,
            clips: [{ ...timeline.clips[0], nodeId: "legacy-source-id" }],
        };
        const result = buildTimelineImportSegments(target, nodes, connections, oldTimeline, 10_000);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.segments[0].sourceNodeId).toBe("source-video");
    });

    test("没有匹配片段时返回错误", () => {
        const target = videoNode("target-video", "结果");
        const result = buildTimelineImportSegments(target, [target], [], timeline, 10_000);
        expect(result.ok).toBe(false);
    });
});
