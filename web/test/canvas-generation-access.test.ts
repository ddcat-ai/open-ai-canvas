import { expect, test } from "bun:test";
import { canvasRecoveryStillTargetsNode, readOwnCanvasTask } from "../src/services/canvas-generation-access";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { ApiError } from "../src/services/api/request";
import type { GenerationTask } from "../src/services/api/task-center";

test("shared task recovery requires a task readable by the current account in this canvas", async () => {
    const task = { id: "task", projectId: "canvas", status: "succeeded" } as GenerationTask;
    expect(await readOwnCanvasTask("task", "canvas", undefined, async () => task)).toBe(task);
    expect(await readOwnCanvasTask("task", "other-canvas", undefined, async () => task)).toBeNull();
    for (const status of [403, 404]) {
        expect(
            await readOwnCanvasTask("foreign", "canvas", undefined, async () => {
                throw new ApiError("unavailable", { status });
            }),
        ).toBeNull();
    }
});

test("transient failure and cancellation do not turn into ownership decisions", async () => {
    const signal = new AbortController().signal;
    for (const error of [new ApiError("unavailable", { status: 503 }), new DOMException("Aborted", "AbortError")]) {
        await expect(
            readOwnCanvasTask("task", "canvas", signal, async (_id, options) => {
                expect(options?.signal).toBe(signal);
                throw error;
            }),
        ).rejects.toBe(error);
    }
});

test("late recovery cannot overwrite a new task or a restored node", () => {
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { taskId: "mine", collaborationIncarnation: 1 } };
    expect(canvasRecoveryStillTargetsNode(node, node, "mine")).toBe(true);
    expect(canvasRecoveryStillTargetsNode(node, undefined, "mine")).toBe(false);
    expect(canvasRecoveryStillTargetsNode(node, { ...node, metadata: { ...node.metadata, taskId: "new-task" } }, "mine")).toBe(false);
    expect(canvasRecoveryStillTargetsNode(node, { ...node, metadata: { ...node.metadata, collaborationIncarnation: 2 } }, "mine")).toBe(false);
    expect(canvasRecoveryStillTargetsNode(node, { ...node, metadata: {} }, "mine")).toBe(false);
    const unbound = { ...node, metadata: {} };
    expect(canvasRecoveryStillTargetsNode(unbound, unbound, "discovered")).toBe(true);
    expect(canvasRecoveryStillTargetsNode(unbound, { ...unbound, metadata: { taskId: "another-task" } }, "discovered")).toBe(false);
});
