import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasContext, findCanvasNodes, getCanvasResources, validateCanvasOps } from "../src/canvas-context.js";
import type { CanvasSnapshot } from "../src/types.js";

const state: CanvasSnapshot = {
    projectId: "canvas-1",
    title: "分镜画布",
    viewport: { x: 0, y: 0, k: 1 },
    selectedNodeIds: ["ref-1"],
    nodes: [
        { id: "prompt-1", type: "text", title: "提示词", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "夜雨中的城市", status: "success" } },
        { id: "ref-1", type: "image", title: "角色参考", position: { x: 420, y: 0 }, width: 320, height: 320, metadata: { status: "success", storageKey: "resource:abc", mimeType: "image/png", assetId: "asset-1", assetCategory: "character", naturalWidth: 1024, naturalHeight: 1024 } },
        { id: "loading-1", type: "video", title: "待生成视频", position: { x: 840, y: 0 }, width: 480, height: 270, metadata: { status: "loading" } },
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
    assert.equal("url" in context.nodes[1], false);
    assert.match(context.stateHash, /^[a-f0-9]{16}$/);
});

test("finds real nodes and resources by semantic query", () => {
    assert.equal(findCanvasNodes(state, { query: "角色", resourceOnly: true }).nodes[0]?.id, "ref-1");
    assert.equal(getCanvasResources(state, { status: "loading" }).resources[0]?.nodeId, "loading-1");
});

test("rejects stale or unsafe operations before dispatch", () => {
    const result = validateCanvasOps(state, [
        { type: "update_node", id: "missing" },
        { type: "connect_nodes", fromNodeId: "prompt-1", toNodeId: "prompt-1" },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 2);
});
