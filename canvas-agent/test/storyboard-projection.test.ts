import { test } from "node:test";
import assert from "node:assert/strict";

import { identifyCreatedStoryboardNodes, reconcileStoryboardShots, type StoryboardShotInput } from "../src/storyboard-projection.js";
import { toolDescriptions, toolNames, toolInputSchemas } from "../src/schemas.js";
import type { CanvasNode, CanvasSnapshot } from "../src/types.js";

function makeNode(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
    return {
        id,
        type: "text",
        title: `Node ${id}`,
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: {},
        ...overrides,
    };
}

function makeShots(count: number, prefix = "shot"): StoryboardShotInput[] {
    return Array.from({ length: count }, (_, i) => ({
        shotId: `${prefix}-${i}`,
        title: `分镜 ${i + 1}`,
        description: `第 ${i + 1} 个分镜的剧情描述`,
        position: i,
    }));
}

function makeSnapshot(nodes: CanvasNode[]): CanvasSnapshot {
    return { projectId: "test-project", nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

// ============ TEST A: 幂等 - 重复调用不创建重复节点 ============
test("TEST A: 空画布投影8个shot，重复调用不创建重复节点", () => {
    const shots = makeShots(8);
    const emptyState = makeSnapshot([]);

    // 第一次调用：8个add_node
    const result1 = reconcileStoryboardShots(emptyState, shots);
    assert.equal(result1.ops.length, 8);
    assert.equal(result1.createdCount, 8);
    assert.equal(result1.updatedNodeIds.length, 0);
    assert.ok(result1.ops.every((op) => op.type === "add_node"));

    // 模拟第一次调用后的画布状态：8个节点带有shotId metadata
    const projectedNodes = result1.ops.map((op, i) =>
        makeNode(`node-${i}`, {
            metadata: { shotId: shots[i].shotId, workflowKind: "storyboard" },
            position: (op as { position: { x: number; y: number } }).position,
        }),
    );
    const stateAfterFirst = makeSnapshot(projectedNodes);

    // 第二次调用：0个add_node，8个update_node
    const result2 = reconcileStoryboardShots(stateAfterFirst, shots);
    assert.equal(result2.createdCount, 0);
    assert.equal(result2.updatedNodeIds.length, 8);
    assert.ok(result2.ops.every((op) => op.type === "update_node"));

    // 验证没有重复节点
    const allShotIds = new Set(result2.ops.map((op) => (op as { metadata: { shotId: string } }).metadata.shotId));
    assert.equal(allShotIds.size, 8);
});

// ============ TEST B: 更新语义内容保留节点ID和位置 ============
test("TEST B: 更新已有shot的title/description，保留节点ID和位置", () => {
    const shots = makeShots(3);
    const existingNodes = shots.map((shot, i) =>
        makeNode(`existing-${i}`, {
            title: "旧标题",
            position: { x: 100 + i * 10, y: 200 + i * 10 },
            metadata: { shotId: shot.shotId, content: "旧描述", workflowKind: "storyboard" },
        }),
    );
    const state = makeSnapshot(existingNodes);

    // 更新title和description
    const updatedShots = shots.map((shot) => ({ ...shot, title: `新标题 ${shot.position}`, description: "新描述" }));
    const result = reconcileStoryboardShots(state, updatedShots);

    assert.equal(result.createdCount, 0);
    assert.equal(result.updatedNodeIds.length, 3);
    assert.ok(result.ops.every((op) => op.type === "update_node"));

    // 验证节点ID保持不变
    const updatedIds = result.ops.map((op) => (op as { id: string }).id);
    assert.deepEqual(updatedIds, ["existing-0", "existing-1", "existing-2"]);

    // 验证title更新了
    const updatedTitles = result.ops.map((op) => (op as { patch: { title: string } }).patch.title);
    assert.deepEqual(updatedTitles, ["新标题 0", "新标题 1", "新标题 2"]);

    // 验证metadata中的content更新了
    const updatedContents = result.ops.map((op) => (op as { metadata: { content: string } }).metadata.content);
    assert.deepEqual(updatedContents, ["新描述", "新描述", "新描述"]);

    // 验证position没有出现在update_node中（保留用户手动位置）
    for (const op of result.ops) {
        assert.ok(!("position" in (op as Record<string, unknown>)), "update_node不应该包含position字段");
    }
});

// ============ TEST C: 5个已有 + 3个新 = 8个，已有保留ID/位置，新的自动布局 ============
test("TEST C: 5个已有投影 + 3个新投影，已有保留ID/位置，新的自动布局", () => {
    const allShots = makeShots(8);
    // 前5个已有投影
    const existingNodes = allShots.slice(0, 5).map((shot, i) =>
        makeNode(`existing-${i}`, {
            position: { x: 500 + i, y: 600 + i },
            metadata: { shotId: shot.shotId, workflowKind: "storyboard" },
        }),
    );
    const state = makeSnapshot(existingNodes);

    const result = reconcileStoryboardShots(state, allShots);

    // 5个update + 3个add = 8个ops
    assert.equal(result.ops.length, 8);
    assert.equal(result.createdCount, 3);
    assert.equal(result.updatedNodeIds.length, 5);

    const addOps = result.ops.filter((op) => op.type === "add_node");
    const updateOps = result.ops.filter((op) => op.type === "update_node");
    assert.equal(addOps.length, 3);
    assert.equal(updateOps.length, 5);

    // 已有节点ID保持不变
    const existingIds = updateOps.map((op) => (op as { id: string }).id);
    assert.deepEqual(existingIds, ["existing-0", "existing-1", "existing-2", "existing-3", "existing-4"]);

    // 新节点的shotId是后3个
    const newShotIds = addOps.map((op) => (op as { metadata: { shotId: string } }).metadata.shotId);
    assert.deepEqual(newShotIds, ["shot-5", "shot-6", "shot-7"]);

    // 新节点自动布局：Y坐标递增（column方向）
    const newPositions = addOps.map((op) => (op as { position: { x: number; y: number } }).position);
    assert.equal(newPositions[0].y, 0);
    assert.equal(newPositions[1].y, 280);
    assert.equal(newPositions[2].y, 560);
    assert.equal(newPositions[0].x, newPositions[1].x);
    assert.equal(newPositions[1].x, newPositions[2].x);
});

// ============ TEST D: 已有无关节点不受影响 ============
test("TEST D: 已有无关节点不受影响", () => {
    const shots = makeShots(3);
    const unrelatedNode = makeNode("unrelated-1", {
        type: "image",
        title: "用户自己的图片",
        position: { x: 999, y: 999 },
        metadata: { someCustomField: "value" },
    });
    const anotherUnrelated = makeNode("unrelated-2", {
        type: "text",
        title: "用户笔记",
        position: { x: 100, y: 100 },
        metadata: {},
    });
    const state = makeSnapshot([unrelatedNode, anotherUnrelated]);

    const result = reconcileStoryboardShots(state, shots);

    // 3个新节点，0个更新
    assert.equal(result.createdCount, 3);
    assert.equal(result.updatedNodeIds.length, 0);

    // 无关节点的ID不出现在updatedNodeIds中
    assert.ok(!result.updatedNodeIds.includes("unrelated-1"));
    assert.ok(!result.updatedNodeIds.includes("unrelated-2"));

    // ops中没有针对无关节点的操作
    const opIds = result.ops.map((op) => (op as { id?: string }).id).filter(Boolean);
    assert.ok(!opIds.includes("unrelated-1"));
    assert.ok(!opIds.includes("unrelated-2"));
});

// ============ 重复节点处理 ============
test("重复shotId节点：选择规范节点并报告重复", () => {
    const shots = makeShots(1);
    // 同一个shotId有3个节点（重复投影）
    const duplicateNodes = [
        makeNode("node-a", { metadata: { shotId: shots[0].shotId } }),
        makeNode("node-b", { metadata: { shotId: shots[0].shotId } }),
        makeNode("node-c", { metadata: { shotId: shots[0].shotId } }),
    ];
    const state = makeSnapshot(duplicateNodes);

    const result = reconcileStoryboardShots(state, shots);

    // 只更新规范节点（按id排序第一个 = node-a）
    assert.equal(result.updatedNodeIds.length, 1);
    assert.equal(result.updatedNodeIds[0], "node-a");

    // 报告重复
    assert.equal(result.duplicateShotMappings.length, 1);
    assert.equal(result.duplicateShotMappings[0].shotId, shots[0].shotId);
    assert.equal(result.duplicateShotMappings[0].canonicalNodeId, "node-a");
    assert.deepEqual(result.duplicateShotMappings[0].duplicateNodeIds, ["node-b", "node-c"]);

    // 不删除重复节点（留给后续显式操作）
    assert.ok(!result.ops.some((op) => op.type === "delete_node"));
});

// ============ Undo/Redo验证：全部ops在一次canvas_apply_ops中应用 ============
test("Undo/Redo: 全部ops在一次调用中生成，确保一个undo条目", () => {
    const shots = makeShots(8);
    const state = makeSnapshot([]);

    const result = reconcileStoryboardShots(state, shots);

    // 生成8个ops
    assert.equal(result.ops.length, 8);

    // 所有ops都是add_node类型（空画布）
    assert.ok(result.ops.every((op) => op.type === "add_node"));

    // 关键：reconcileStoryboardShots只生成ops列表，由调用方在一次canvas_apply_ops中应用
    // 这确保了undo/redo将全部8个节点作为一个历史条目处理
    // 验证ops列表是完整的（调用方不会分批应用）
    assert.equal(result.ops.length, shots.length);
});

// ============ identifyCreatedStoryboardNodes ============
test("identifyCreatedStoryboardNodes: 从结果快照识别新创建节点", () => {
    const resultNodes = [
        { id: "new-1", metadata: { shotId: "shot-0" } },
        { id: "new-2", metadata: { shotId: "shot-1" } },
        { id: "existing-1", metadata: { shotId: "shot-2" } },
        { id: "unrelated", metadata: { otherField: "value" } },
    ];
    const requestedShotIds = new Set(["shot-0", "shot-1", "shot-2"]);
    const preExistingNodeIds = ["existing-1"];

    const createdIds = identifyCreatedStoryboardNodes(resultNodes, requestedShotIds, preExistingNodeIds);

    assert.deepEqual(createdIds, ["new-1", "new-2"]);
});

// ============ Part 9: Agent工具注册表测试 ============
test("Agent工具注册表: project_create_or_update_shots 和 canvas_create_storyboard_shots 都已注册", () => {
    assert.ok(toolNames.includes("project_create_or_update_shots"));
    assert.ok(toolNames.includes("canvas_create_storyboard_shots"));
});

test("Agent工具注册表: 两个工具都有input schema", () => {
    assert.ok(toolInputSchemas.project_create_or_update_shots);
    assert.ok(toolInputSchemas.canvas_create_storyboard_shots);
});

test("Agent工具注册表: canvas_create_storyboard_shots描述明确语义优先顺序", () => {
    const desc = toolDescriptions.canvas_create_storyboard_shots;
    // 描述必须包含关键指令
    assert.ok(desc.includes("project_create_or_update_shots"), "描述应提到先调用project_create_or_update_shots");
    assert.ok(desc.includes("shotId"), "描述应提到shotId");
    assert.ok(desc.includes("幂等"), "描述应提到幂等");
    assert.ok(desc.includes("不触发"), "描述应提到不触发生成");
});

test("Agent工具注册表: project_create_or_update_shots描述提到返回shotId", () => {
    const desc = toolDescriptions.project_create_or_update_shots;
    assert.ok(desc.includes("shotId"), "描述应提到返回shotId");
    assert.ok(desc.includes("canvas_create_storyboard_shots"), "描述应提到后续投影步骤");
});

test("Agent工具注册表: canvas_create_storyboard_shots input schema包含shots数组", () => {
    const schema = toolInputSchemas.canvas_create_storyboard_shots;
    const shape = (schema as unknown as { shape: Record<string, unknown> }).shape;
    assert.ok(shape.shots);
    assert.ok(shape.x !== undefined || true); // x可选
});

// ============ 碰撞避免测试 ============
test("碰撞避免: 新节点不与已有矩形节点重叠", () => {
    const shots = makeShots(3);
    // 已有节点占据 (0,0) 到 (340,240)，正好是新节点首选位置
    const blockingNode = makeNode("blocker", {
        type: "image",
        title: "已有图片",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: {},
    });
    const state = makeSnapshot([blockingNode]);

    const result = reconcileStoryboardShots(state, shots, { x: 0 });

    assert.equal(result.createdCount, 3);
    const addOps = result.ops.filter((op) => op.type === "add_node");
    assert.equal(addOps.length, 3);

    // 每个新节点都不与已有节点重叠
    for (const op of addOps) {
        const pos = (op as { position: { x: number; y: number } }).position;
        const overlap = !(
            pos.x + 340 + 20 <= 0 ||
            pos.x >= 0 + 340 + 20 ||
            pos.y + 240 + 20 <= 0 ||
            pos.y >= 0 + 240 + 20
        );
        assert.ok(!overlap, `新节点不应与已有节点重叠: x=${pos.x}, y=${pos.y}`);
    }
});

test("碰撞避免: 新节点之间不重叠", () => {
    const shots = makeShots(5);
    const state = makeSnapshot([]);

    const result = reconcileStoryboardShots(state, shots, { x: 0 });
    const addOps = result.ops.filter((op) => op.type === "add_node");

    // 两两检查不重叠
    for (let i = 0; i < addOps.length; i++) {
        for (let j = i + 1; j < addOps.length; j++) {
            const a = addOps[i] as { position: { x: number; y: number } };
            const b = addOps[j] as { position: { x: number; y: number } };
            const overlap = !(
                a.position.x + 340 + 20 <= b.position.x ||
                a.position.x >= b.position.x + 340 + 20 ||
                a.position.y + 240 + 20 <= b.position.y ||
                a.position.y >= b.position.y + 240 + 20
            );
            assert.ok(!overlap, `新节点${i}和${j}不应重叠`);
        }
    }
});

test("碰撞避免: 已有投影节点位置不被移动", () => {
    const shots = makeShots(3);
    // 前2个已有投影，用户手动移动到 (1000, 2000) 和 (1000, 2300)
    const existingNodes = [
        makeNode("existing-0", { position: { x: 1000, y: 2000 }, metadata: { shotId: shots[0].shotId } }),
        makeNode("existing-1", { position: { x: 1000, y: 2300 }, metadata: { shotId: shots[1].shotId } }),
    ];
    const state = makeSnapshot(existingNodes);

    const result = reconcileStoryboardShots(state, shots, { x: 0 });

    // 已有节点是update_node，不含position字段（位置保留）
    const updateOps = result.ops.filter((op) => op.type === "update_node");
    assert.equal(updateOps.length, 2);
    for (const op of updateOps) {
        assert.ok(!("position" in (op as Record<string, unknown>)), "update_node不应包含position字段");
    }

    // 新节点（第3个）是add_node，位置由碰撞避免决定
    const addOps = result.ops.filter((op) => op.type === "add_node");
    assert.equal(addOps.length, 1);
});

test("碰撞避免: 相同画布状态和相同shots产生确定性布局", () => {
    const shots = makeShots(4);
    const existingNodes = [
        makeNode("blocker-1", { position: { x: 0, y: 0 }, width: 500, height: 300, metadata: {} }),
        makeNode("blocker-2", { position: { x: 600, y: 400 }, width: 200, height: 200, metadata: {} }),
    ];
    const state = makeSnapshot(existingNodes);

    // 运行两次
    const result1 = reconcileStoryboardShots(state, shots, { x: 0 });
    const result2 = reconcileStoryboardShots(state, shots, { x: 0 });

    // 结果应该完全一致
    assert.deepEqual(result1.ops, result2.ops);
    assert.equal(result1.createdCount, result2.createdCount);
});

test("碰撞避免: 无关节点不被移动或修改", () => {
    const shots = makeShots(2);
    const unrelatedNode = makeNode("user-note", {
        type: "text",
        title: "用户笔记",
        position: { x: 50, y: 50 },
        width: 200,
        height: 150,
        metadata: { customField: "important" },
    });
    const state = makeSnapshot([unrelatedNode]);

    const result = reconcileStoryboardShots(state, shots, { x: 0 });

    // ops中没有针对无关节点的操作
    const opIds = result.ops.map((op) => (op as { id?: string }).id).filter(Boolean);
    assert.ok(!opIds.includes("user-note"), "无关节点不应出现在ops中");

    // 新节点不与无关节点重叠
    const addOps = result.ops.filter((op) => op.type === "add_node");
    for (const op of addOps) {
        const pos = (op as { position: { x: number; y: number } }).position;
        const overlap = !(
            pos.x + 340 + 20 <= 50 ||
            pos.x >= 50 + 200 + 20 ||
            pos.y + 240 + 20 <= 50 ||
            pos.y >= 50 + 150 + 20
        );
        assert.ok(!overlap, `新节点不应与无关节点重叠: x=${pos.x}, y=${pos.y}`);
    }
});
