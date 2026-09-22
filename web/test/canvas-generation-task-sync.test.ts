import { describe, expect, test } from "bun:test";

import { applyGeneratedMediaResultMetadata, applyGenerationTaskResultToNodes, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function videoNode(assetId: string, storageKey: string): CanvasNodeData {
    return {
        id: "node-1",
        type: CanvasNodeType.Video,
        title: "镜头",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { assetId, storageKey, content: "https://example.test/old.mp4", prompt: "旧提示词" },
    };
}

describe("applyGeneratedMediaResultMetadata", () => {
    test("明确指定的节点已删除时不能根据 taskId 误更新其他节点", async () => {
        const other = { ...videoNode("asset", "video:key"), metadata: { taskId: "task" } };
        const applied = await applyGenerationTaskResultToNodes([other], { id: "task", type: "canvas_video", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" }, "deleted-node");
        expect(applied.updated).toBe(false);
        expect(applied.nodes).toEqual([other]);
    });
    test("clears the previous asset binding when a regenerated media result lands", () => {
        const node = videoNode("asset-old", "video:old");
        const next = applyGeneratedMediaResultMetadata(node, videoMetadata({
            url: "https://example.test/new.mp4",
            storageKey: "video:new",
            width: 1280,
            height: 720,
            bytes: 12,
            mimeType: "video/mp4",
            durationMs: 4000,
        }), { prompt: "新提示词" });

        expect(next.assetId).toBeUndefined();
        expect(next.storageKey).toBe("video:new");
        expect(next.content).toBe("https://example.test/new.mp4");
        expect(next.prompt).toBe("新提示词");
        expect(next.status).toBe("success");
    });
});
