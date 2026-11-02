import { expect, test } from "bun:test";
import { selectRetriedNodeRoute } from "../src/lib/canvas/canvas-route-retry";
import { readNodeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("route retry updates model identity in the canvas contract without changing original inputs", () => {
    const original: CanvasNodeData = {
        id: "node",
        type: CanvasNodeType.Image,
        title: "Image",
        position: { x: 10, y: 20 },
        width: 320,
        height: 240,
        metadata: { taskId: "task", model: "cheap::image", prompt: "keep my prompt", references: ["resource:reference"], size: "3:4", quality: "hd", count: 1, imageParameters: '{"quality":"hd","count":1}' },
    };
    const updated = selectRetriedNodeRoute(original, { channelId: "stable", modelKey: "image" });
    expect(updated.metadata?.model).toBe("stable::image");
    expect(updated.metadata?.producedModelCandidate).toBe("stable::image");
    expect(readNodeGenerationSpec(updated)?.modelSelection).toEqual({ kind: "channel", channelId: "stable", modelKey: "image" });
    expect(readNodeGenerationSpec(updated)?.prompt).toBe("keep my prompt");
    expect(updated.metadata?.references).toEqual(original.metadata?.references);
    expect(updated.metadata?.imageParameters).toEqual(original.metadata?.imageParameters);
    expect(updated.metadata?.taskId).toBe("task");
    expect(original.metadata?.model).toBe("cheap::image");
});
