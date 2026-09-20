import { expect, test } from "bun:test";
import { bindStoryboardKeyframes, storyboardRowsFromBatchTable } from "@/lib/canvas/canvas-batch-storyboard";
import { createCanvasNode, createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasBatchTableData } from "@/types/canvas";

test("storyboard conversion follows row identity and retains edits and asset bindings", () => {
    const table: CanvasBatchTableData = {
        operation: "creative", concurrency: 1,
        textColumns: [{ id: "unrelated", label: "无关列" }],
        rows: [
            { id: "second", enabled: true, prompt: "", inputNodeIds: [], cells: { "storyboard-shotNumber": "72", "storyboard-durationSeconds": "2.5", "storyboard-dialogue": "" } },
            { id: "new", enabled: true, prompt: "", inputNodeIds: [], cells: { unrelated: "不要猜成画面" } },
            { id: "first", enabled: false, prompt: "", inputNodeIds: [] },
        ],
        storyboardRows: [
            createStoryboardRow(1, { id: "first", plotDescription: "deleted" }),
            createStoryboardRow(2, { id: "second", plotDescription: "second shot", dialogue: "old", keyframeTimeMs: 2000, imageNodeId: "existing-image" }),
        ],
    };
    const rows = storyboardRowsFromBatchTable(table);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "second", shotNumber: 72, durationSeconds: 2.5, dialogue: "", plotDescription: "second shot", keyframeTimeMs: 2000, imageNodeId: "existing-image" });
    expect(rows[1].plotDescription).toBe("");
});

test("keyframes bind by source and timestamp despite sorting, duplicates or partial extraction", () => {
    const rows = [3000, 1000, 3000, 2000].map((time, index) => createStoryboardRow(index + 1, { keyframeTimeMs: time }));
    const frame = (source: string, time: number) => createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { videoFrameSourceNodeId: source, videoFrameTimeMs: time });
    const first = frame("video", 1000);
    const third = frame("video", 3000);
    const result = bindStoryboardKeyframes(rows, [first, third, frame("other", 2000)], "video");
    expect(result.map((row) => row.imageNodeId)).toEqual([third.id, first.id, third.id, rows[3].imageNodeId]);
    expect(result[3]).toBe(rows[3]);
    expect(bindStoryboardKeyframes([createStoryboardRow(1, { sourceStartMs: 500, sourceEndMs: 1500 })], [first], "video")[0].imageNodeId).toBe(first.id);
});
