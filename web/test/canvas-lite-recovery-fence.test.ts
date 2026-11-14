import { expect, test } from "bun:test";

import { recoverCanvasGenerationTaskNode } from "@/pages/canvas/use-canvas-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";

test("取消旧节点恢复后迟到的结果不能写入新生成", async () => {
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Text, title: "node", position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { taskId: "old", status: "loading" } };
    const task: GenerationTask = { id: "old", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" };
    const nodesRef = { current: [node] };
    const controller = new AbortController();
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const recovery = recoverCanvasGenerationTaskNode({
        projectId: "project",
        node,
        completed: task,
        continuationOnly: false,
        nodesRef,
        setNodes: (update) => {
            nodesRef.current = typeof update === "function" ? update(nodesRef.current) : update;
        },
        applyGenerationTaskResult: async (_nodeId, _task, signal) => {
            started();
            await wait;
            if (!signal?.aborted) nodesRef.current = [{ ...node, metadata: { taskId: "old", content: "old result" } }];
        },
        signal: controller.signal,
    });
    await entered;
    controller.abort();
    nodesRef.current = [{ ...node, metadata: { taskId: "new", status: "loading" } }];
    finish();
    await recovery;
    expect(nodesRef.current[0].metadata).toEqual({ taskId: "new", status: "loading" });
});
