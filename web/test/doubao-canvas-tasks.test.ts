import { describe, expect, test } from "bun:test";
import { canvasTasksByNode } from "../src/components/doubao/doubao-canvas-tasks";
import type { BridgeTask } from "../src/services/doubao-bridge";

const task = (id: string, nodeId: string, kind: string, status: string): BridgeTask => ({
    id,
    nodeId,
    kind,
    status,
    prompt: "",
    error: null,
    accountId: null,
    attempt: 0,
});

describe("canvas bridge tasks", () => {
    test("maps active image and video tasks to their own nodes and excludes text and terminal tasks", () => {
        const mapped = canvasTasksByNode([task("image", "a", "image", "processing"), task("video", "b", "video", "queued"), task("text", "c", "text", "processing"), task("done", "d", "image", "completed"), task("failed", "e", "video", "failed")]);
        expect([...mapped.entries()].map(([node, value]) => [node, value.id])).toEqual([
            ["a", "image"],
            ["b", "video"],
        ]);
        expect(canvasTasksByNode([task("image", "a", "image", "completed"), task("video", "b", "video", "failed")]).size).toBe(0);
    });
});
