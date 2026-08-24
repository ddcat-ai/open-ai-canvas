import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasContext, findCanvasNodes, getCanvasConnection, getCanvasGenerationTasks, getCanvasNode, getCanvasResources, validateCanvasOps } from "../src/canvas-context.js";
import type { CanvasSnapshot } from "../src/types.js";

const state: CanvasSnapshot = {
    projectId: "canvas-1",
    title: "分镜画布",
    viewport: { x: 0, y: 0, k: 1 },
    selectedNodeIds: ["ref-1"],
    nodes: [
        { id: "prompt-1", type: "text", title: "提示词", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "夜雨中的城市", status: "success" } },
        { id: "ref-1", type: "image", title: "角色参考", position: { x: 420, y: 0 }, width: 320, height: 320, metadata: { status: "success", storageKey: "resource:abc", mimeType: "image/png", assetId: "asset-1", assetCategory: "character", naturalWidth: 1024, naturalHeight: 1024 } },
        { id: "loading-1", type: "video", title: "待生成视频", position: { x: 840, y: 0 }, width: 480, height: 270, metadata: { status: "loading", taskId: "task-1", taskStatus: "running", taskProgress: 42, taskStage: "rendering", taskProvider: "backend" } },
    ],
    connections: [{ id: "c-1", fromNodeId: "prompt-1", toNodeId: "ref-1" }],
};

test("builds semantic canvas context without media URLs", () => {
    const context = buildCanvasContext(state);
    assert.equal(context.canvas.nodeCount, 3);
    assert.equal(context.selection[0]?.id, "ref-1");
    assert.equal(context.resources[0]?.resourceId, "abc");
    assert.equal(context.resources[0]?.isReady, true);
    assert.equal(context.resources[1]?.isReady, false);
    assert.equal((context.nodes[1] as { resource?: { ready?: boolean } }).resource?.ready, true);
    assert.equal((context.nodes[2] as { generation?: { taskId?: string; progress?: number } }).generation?.taskId, "task-1");
    assert.equal((context.nodes[2] as { generation?: { taskId?: string; progress?: number; stage?: string } }).generation?.progress, 42);
    assert.equal((context.nodes[2] as { generation?: { taskId?: string; progress?: number; stage?: string } }).generation?.stage, "rendering");
    assert.equal("url" in context.nodes[1], false);
    assert.match(context.stateHash, /^[a-f0-9]{16}$/);
});

test("finds real nodes and resources by semantic query", () => {
    assert.equal(findCanvasNodes(state, { query: "角色", resourceOnly: true }).nodes[0]?.id, "ref-1");
    assert.equal(getCanvasResources(state, { status: "loading" }).resources[0]?.nodeId, "loading-1");
});

test("reads one node and its related connections without media URLs", () => {
    const result = getCanvasNode(state, { id: "ref-1" });
    assert.equal(result.found, true);
    assert.equal(result.node?.id, "ref-1");
    assert.equal(result.resource?.isReady, true);
    assert.equal(result.connections[0]?.id, "c-1");
    assert.equal("url" in (result.node || {}), false);
    assert.equal(getCanvasNode(state, { id: "missing" }).found, false);
});

test("reads one connection with endpoint summaries", () => {
    const result = getCanvasConnection(state, { id: "c-1" });
    assert.equal(result.found, true);
    assert.equal(result.connection?.fromTitle, "提示词");
    assert.equal(result.toNode?.id, "ref-1");
    assert.equal(getCanvasConnection(state, { id: "missing" }).found, false);
});

test("projects observable generation task state from canvas nodes", () => {
    const result = getCanvasGenerationTasks(state, { status: "running" });
    assert.equal(result.total, 1);
    assert.deepEqual(result.tasks[0], {
        taskId: "task-1",
        nodeId: "loading-1",
        nodeTitle: "待生成视频",
        mode: undefined,
        nodeStatus: "loading",
        status: "running",
        progress: 42,
        stage: "rendering",
        provider: "backend",
        errorCode: undefined,
        officialStatus: undefined,
        resourceReady: false,
    });
});

test("rejects stale or unsafe operations before dispatch", () => {
    const result = validateCanvasOps(state, [
        { type: "update_node", id: "missing" },
        { type: "connect_nodes", fromNodeId: "prompt-1", toNodeId: "prompt-1" },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 2);
});

test("validates a batch transaction against its evolving node and connection state", () => {
    const result = validateCanvasOps(state, [
        { type: "add_node", id: "new-1", nodeType: "image", position: { x: 10, y: 20 }, width: 320, height: 240 },
        { type: "connect_nodes", fromNodeId: "new-1", toNodeId: "ref-1", id: "new-connection" },
        { type: "delete_node", id: "new-1" },
        { type: "update_node", id: "new-1", patch: { title: "should fail" } },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.issues.at(-1)?.message || "", /不在当前画布状态中/);
});

test("rejects duplicate, missing, and unsafe connection or viewport operations", () => {
    const result = validateCanvasOps(state, [
        { type: "connect_nodes", fromNodeId: "prompt-1", toNodeId: "ref-1" },
        { type: "delete_connections", ids: ["missing-connection"] },
        { type: "set_viewport", viewport: { x: 0, y: 0, k: 99 } },
        { type: "add_node", nodeType: "image", width: -1, height: 0, position: { x: Number.NaN, y: 0 } },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.message.includes("相同端点")));
    assert.ok(result.issues.some((issue) => issue.message.includes("不存在")));
    assert.ok(result.issues.some((issue) => issue.message.includes("0.05 到 8")));
    assert.ok(result.issues.some((issue) => issue.message.includes("正数")));
});


test("evolving connection state allows delete then recreate in one atomic batch", () => {
    const result = validateCanvasOps(state, [
        { type: "delete_connections", id: "c-1" },
        { type: "connect_nodes", id: "c-2", fromNodeId: "prompt-1", toNodeId: "ref-1" },
    ]);
    assert.equal(result.ok, true);
});

test("rejects direct media status forgery as a write error", () => {
    const result = validateCanvasOps(state, [
        { type: "update_node", id: "ref-1", patch: { metadata: { status: "success" } } },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.severity, "error");
});
