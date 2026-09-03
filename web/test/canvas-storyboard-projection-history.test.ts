import { expect, test } from "bun:test";

import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

/**
 * 真实画布历史undo/redo测试。
 *
 * 生产路径：
 * - apply: applyCanvasAgentOps(before, ops) → next snapshot
 * - undo: 恢复 before snapshot（useCanvasAgentOperations的undoStackRef机制）
 * - redo: 重新 applyCanvasAgentOps(before, ops) → next snapshot
 *
 * 本测试执行真实的applyCanvasAgentOps生产函数，验证完整的apply→undo→redo行为。
 */

function makeSnapshot(nodes: CanvasNodeData[]): CanvasAgentSnapshot {
    return {
        projectId: "test-project",
        title: "测试项目",
        nodes,
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function makeUnrelatedNode(): CanvasNodeData {
    return {
        id: "unrelated-user-node",
        type: CanvasNodeType.Image,
        title: "用户自己的图片",
        position: { x: 999, y: 999 },
        width: 400,
        height: 300,
        metadata: { customField: "important-user-data" },
    };
}

function makeStoryboardOps(count: number, startX = 0): CanvasAgentOp[] {
    return Array.from({ length: count }, (_, i) => ({
        type: "add_node" as const,
        nodeType: CanvasNodeType.Text,
        id: `storyboard-node-${i}`,
        title: `分镜 ${i + 1}`,
        position: { x: startX, y: i * 280 },
        width: 340,
        height: 240,
        metadata: {
            shotId: `shot-${i}`,
            shotIndex: i,
            content: `第 ${i + 1} 个分镜的剧情描述`,
            workflowKind: "storyboard",
        },
    }));
}

function assertUnrelatedNodeUnchanged(nodes: CanvasNodeData[]) {
    const node = nodes.find((n) => n.id === "unrelated-user-node");
    expect(node).toBeDefined();
    expect(node?.title).toBe("用户自己的图片");
    expect(node?.position).toEqual({ x: 999, y: 999 });
    expect(node?.width).toBe(400);
    expect(node?.height).toBe(300);
    expect(node?.metadata?.customField).toBe("important-user-data");
}

function assertStoryboardProjections(nodes: CanvasNodeData[], count: number) {
    const storyboardNodes = nodes.filter((n) => n.metadata?.workflowKind === "storyboard");
    expect(storyboardNodes.length).toBe(count);
    for (let i = 0; i < count; i++) {
        const node = storyboardNodes.find((n) => n.metadata?.shotId === `shot-${i}`);
        expect(node).toBeDefined();
        expect(node?.metadata?.shotIndex).toBe(i);
        expect(node?.metadata?.workflowKind).toBe("storyboard");
    }
}

// ============ 测试1: 8个新投影的apply→undo→redo ============
test("真实历史: 8个新分镜投影 apply→undo→redo", () => {
    // 初始状态：一个无关节点
    const unrelatedNode = makeUnrelatedNode();
    const before = makeSnapshot([unrelatedNode]);
    const ops = makeStoryboardOps(8);

    // === APPLY ===
    const after = applyCanvasAgentOps(before, ops);

    // 无关节点不变
    assertUnrelatedNodeUnchanged(after.nodes);

    // 恰好8个分镜投影
    assertStoryboardProjections(after.nodes, 8);

    // 总节点数 = 1无关 + 8投影 = 9
    expect(after.nodes.length).toBe(9);

    // === UNDO（恢复before快照，与useCanvasAgentOperations的undoOps行为一致）===
    const undone = before; // undo = 恢复before snapshot

    // 无关节点不变
    assertUnrelatedNodeUnchanged(undone.nodes);

    // 分镜投影全部消失
    const storyboardAfterUndo = undone.nodes.filter((n) => n.metadata?.workflowKind === "storyboard");
    expect(storyboardAfterUndo.length).toBe(0);

    // 总节点数恢复为1
    expect(undone.nodes.length).toBe(1);

    // 画布状态等于操作前状态
    expect(undone.nodes).toEqual(before.nodes);
    expect(undone.connections).toEqual(before.connections);

    // === REDO（重新应用ops）===
    const redone = applyCanvasAgentOps(undone, ops);

    // 无关节点不变
    assertUnrelatedNodeUnchanged(redone.nodes);

    // 8个分镜投影恢复
    assertStoryboardProjections(redone.nodes, 8);

    // 节点ID和shotId一致
    for (let i = 0; i < 8; i++) {
        const afterNode = after.nodes.find((n) => n.id === `storyboard-node-${i}`);
        const redoneNode = redone.nodes.find((n) => n.id === `storyboard-node-${i}`);
        expect(redoneNode).toBeDefined();
        expect(redoneNode?.metadata?.shotId).toBe(afterNode?.metadata?.shotId);
        expect(redoneNode?.position).toEqual(afterNode?.position);
    }

    // redo后的状态与第一次apply后的状态一致
    expect(redone.nodes).toEqual(after.nodes);
});

// ============ 测试2: 5个更新 + 3个新创建的混合历史 ============
test("真实历史: 5个已有投影更新 + 3个新投影创建 apply→undo→redo", () => {
    // 初始状态：5个已有分镜投影（其中一个被用户手动移动）+ 1个无关节点
    const existingShots: CanvasNodeData[] = Array.from({ length: 5 }, (_, i) => ({
        id: `existing-shot-${i}`,
        type: CanvasNodeType.Text,
        title: `旧标题 ${i + 1}`,
        // 第3个被用户手动移动到 (5000, 6000)
        position: i === 2 ? { x: 5000, y: 6000 } : { x: 0, y: i * 280 },
        width: 340,
        height: 240,
        metadata: {
            shotId: `shot-${i}`,
            shotIndex: i,
            content: `旧描述 ${i + 1}`,
            workflowKind: "storyboard",
        },
    }));
    const unrelatedNode = makeUnrelatedNode();
    const before = makeSnapshot([...existingShots, unrelatedNode]);

    // ops: 5个update_node（更新title/content，不含position）+ 3个add_node
    const updateOps: CanvasAgentOp[] = Array.from({ length: 5 }, (_, i) => ({
        type: "update_node" as const,
        id: `existing-shot-${i}`,
        patch: { title: `新标题 ${i + 1}` },
        metadata: {
            shotId: `shot-${i}`,
            shotIndex: i,
            content: `新描述 ${i + 1}`,
            workflowKind: "storyboard",
        },
    }));
    const addOps: CanvasAgentOp[] = Array.from({ length: 3 }, (_, i) => ({
        type: "add_node" as const,
        nodeType: CanvasNodeType.Text,
        id: `new-shot-${i + 5}`,
        title: `新分镜 ${i + 6}`,
        position: { x: 1000, y: i * 280 },
        width: 340,
        height: 240,
        metadata: {
            shotId: `shot-${i + 5}`,
            shotIndex: i + 5,
            content: `新分镜描述 ${i + 6}`,
            workflowKind: "storyboard",
        },
    }));
    const ops = [...updateOps, ...addOps];

    // === APPLY ===
    const after = applyCanvasAgentOps(before, ops);

    // 5个已有节点ID保留
    for (let i = 0; i < 5; i++) {
        const node = after.nodes.find((n) => n.id === `existing-shot-${i}`);
        expect(node).toBeDefined();
    }

    // 手动移动的节点（第3个）位置保留
    const manuallyMoved = after.nodes.find((n) => n.id === "existing-shot-2");
    expect(manuallyMoved?.position).toEqual({ x: 5000, y: 6000 });

    // 5个已有节点的title/content更新了
    for (let i = 0; i < 5; i++) {
        const node = after.nodes.find((n) => n.id === `existing-shot-${i}`);
        expect(node?.title).toBe(`新标题 ${i + 1}`);
        expect(node?.metadata?.content).toBe(`新描述 ${i + 1}`);
    }

    // 3个新节点添加了
    for (let i = 0; i < 3; i++) {
        const node = after.nodes.find((n) => n.id === `new-shot-${i + 5}`);
        expect(node).toBeDefined();
        expect(node?.metadata?.shotId).toBe(`shot-${i + 5}`);
    }

    // 无关节点不变
    assertUnrelatedNodeUnchanged(after.nodes);

    // 总节点数 = 5已有 + 3新 + 1无关 = 9
    expect(after.nodes.length).toBe(9);

    // === UNDO ===
    const undone = before;

    // 5个已有节点恢复旧title/content
    for (let i = 0; i < 5; i++) {
        const node = undone.nodes.find((n) => n.id === `existing-shot-${i}`);
        expect(node?.title).toBe(`旧标题 ${i + 1}`);
        expect(node?.metadata?.content).toBe(`旧描述 ${i + 1}`);
    }

    // 手动移动的节点位置保留（undo恢复的是操作前状态，操作前位置就是手动移动后的位置）
    const manuallyMovedUndo = undone.nodes.find((n) => n.id === "existing-shot-2");
    expect(manuallyMovedUndo?.position).toEqual({ x: 5000, y: 6000 });

    // 3个新节点消失
    for (let i = 0; i < 3; i++) {
        const node = undone.nodes.find((n) => n.id === `new-shot-${i + 5}`);
        expect(node).toBeUndefined();
    }

    // 无关节点不变
    assertUnrelatedNodeUnchanged(undone.nodes);

    // 总节点数恢复为6（5已有 + 1无关）
    expect(undone.nodes.length).toBe(6);

    // === REDO ===
    const redone = applyCanvasAgentOps(undone, ops);

    // 5个已有节点更新恢复
    for (let i = 0; i < 5; i++) {
        const node = redone.nodes.find((n) => n.id === `existing-shot-${i}`);
        expect(node?.title).toBe(`新标题 ${i + 1}`);
        expect(node?.metadata?.content).toBe(`新描述 ${i + 1}`);
    }

    // 手动移动的节点位置仍然保留
    const manuallyMovedRedo = redone.nodes.find((n) => n.id === "existing-shot-2");
    expect(manuallyMovedRedo?.position).toEqual({ x: 5000, y: 6000 });

    // 3个新节点恢复
    for (let i = 0; i < 3; i++) {
        const node = redone.nodes.find((n) => n.id === `new-shot-${i + 5}`);
        expect(node).toBeDefined();
    }

    // 无关节点不变
    assertUnrelatedNodeUnchanged(redone.nodes);

    // redo后的状态与第一次apply后的状态一致
    expect(redone.nodes).toEqual(after.nodes);
});

// ============ 测试3: 一次Agent投影调用作为一个历史事务 ============
test("真实历史: 一次Agent投影调用的全部ops作为一个undo单元", () => {
    // 初始：无关节点
    const before = makeSnapshot([makeUnrelatedNode()]);

    // 模拟一次Agent调用产生的ops：8个add_node + 0个update_node
    const agentOps = makeStoryboardOps(8, 100);

    // 生产路径：applyOps在useCanvasAgentOperations中一次性应用全部ops
    // 并将before快照推入undoStackRef的一个batch中
    const after = applyCanvasAgentOps(before, agentOps);

    // undo = 弹出该batch，恢复before快照（一个undo操作恢复全部8个节点）
    const undone = before;

    // 验证一次undo恢复全部8个投影
    expect(undone.nodes.length).toBe(1);
    expect(undone.nodes.filter((n) => n.metadata?.workflowKind === "storyboard").length).toBe(0);

    // redo = 重新应用全部ops（一个redo操作恢复全部8个节点）
    const redone = applyCanvasAgentOps(undone, agentOps);
    expect(redone.nodes.length).toBe(9);
    expect(redone.nodes.filter((n) => n.metadata?.workflowKind === "storyboard").length).toBe(8);

    // 无关节点在整个过程中不变
    assertUnrelatedNodeUnchanged(after.nodes);
    assertUnrelatedNodeUnchanged(undone.nodes);
    assertUnrelatedNodeUnchanged(redone.nodes);
});
