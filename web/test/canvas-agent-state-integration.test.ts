import { expect, test } from "bun:test";

import { runCanvasAgentGenerationOps } from "../src/pages/canvas/use-canvas-agent-operations";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function makeNode(id: string, metadata: Record<string, unknown>): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        position: { x: 0, y: 0 },
        title: id,
        metadata: { generationMode: "image", ...metadata },
    } as unknown as CanvasNodeData;
}

const noopSubscribe = () => () => undefined;

test("提交点拦截：进行中/已完成的非 retry 任务不会重复提交，retry 与新任务正常提交", async () => {
    const running = makeNode("running-node", { taskId: "t-running", taskStatus: "running" });
    const completed = makeNode("done-node", { taskId: "t-done", taskStatus: "succeeded", status: "success", storageKey: "k" });
    const failed = makeNode("failed-node", { taskId: "t-failed", taskStatus: "failed" });
    const fresh = makeNode("fresh-node", { composerContent: "一只猫" });
    const nodes = [running, completed, failed, fresh];

    const submitted: string[] = [];
    const generate = async (nodeId: string) => {
        submitted.push(nodeId);
    };

    const result = await runCanvasAgentGenerationOps({
        generationOps: [
            { type: "run_generation", nodeId: "running-node" },
            { type: "run_generation", nodeId: "done-node" },
            { type: "run_generation", nodeId: "failed-node" },
            { type: "run_generation", nodeId: "fresh-node" },
            // 进行中节点显式 retry，应当放行
            { type: "run_generation", nodeId: "running-node", retry: true },
        ],
        nodes,
        generate,
        subscribeTasks: noopSubscribe as never,
    });

    // 新节点 + 显式 retry 的进行中节点被提交；其余被拦截。
    expect(submitted.sort()).toEqual(["fresh-node", "running-node"]);
    expect(result.submittedNodeIds.sort()).toEqual(["fresh-node", "running-node"]);
    const skippedReasons = Object.fromEntries(result.skipped.map((item) => [item.nodeId, item.reason]));
    expect(skippedReasons["done-node"]).toBe("completed");
    expect(skippedReasons["failed-node"]).toBe("failed-needs-retry");
    // running-node 出现两次：一次非 retry 被跳过，一次 retry 放行，因此跳过清单里仍记录一次 pending。
    expect(skippedReasons["running-node"]).toBe("pending");
});

test("提交点在全部任务都已完成时不调用 generate，返回全部跳过", async () => {
    const done = makeNode("done", { taskId: "t", taskStatus: "succeeded", status: "success", storageKey: "k" });
    let called = 0;
    const result = await runCanvasAgentGenerationOps({
        generationOps: [{ type: "run_generation", nodeId: "done" }],
        nodes: [done],
        generate: async () => {
            called += 1;
        },
        subscribeTasks: noopSubscribe as never,
    });
    expect(called).toBe(0);
    expect(result.submittedNodeIds).toEqual([]);
    expect(result.skipped[0].reason).toBe("completed");
});
