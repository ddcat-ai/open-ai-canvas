import assert from "node:assert/strict";
import test from "node:test";
import { assertCanvasSkill, buildScriptToScenesPlan, nextRunnableTasks, planRequiresApproval, taskNeedsApproval, type CanvasPlan } from "../src/orchestration.js";

test("canvas skills reject non-canvas tools", () => {
    assert.throws(() => assertCanvasSkill({ name: "x", version: "1", description: "", allowedTools: ["terminal"], risk: "read" }), /canvas_/);
});

test("generation skills must declare a generation tool", () => {
    assert.throws(() => assertCanvasSkill({ name: "x", version: "1", description: "", allowedTools: ["canvas_get_context"], risk: "generation", allowGeneration: true }), /生成工具/);
});

test("ask mode pauses writes and generation while auto mode runs them", () => {
    assert.equal(taskNeedsApproval({ kind: "canvas_ops", requiresApproval: false }, "ask"), true);
    assert.equal(taskNeedsApproval({ kind: "generation", requiresApproval: false }, "ask"), true);
    assert.equal(taskNeedsApproval({ kind: "canvas_ops", requiresApproval: false }, "auto"), false);
});

test("only tasks with completed dependencies are runnable", () => {
    const plan: CanvasPlan = {
        id: "p1", title: "拆场景", skill: { name: "script-to-scenes", version: "1" }, status: "running",
        tasks: [
            { id: "read", kind: "analyze", title: "读取剧本", dependsOn: [], status: "succeeded", requiresApproval: false },
            { id: "create", kind: "canvas_ops", title: "创建场景", dependsOn: ["read"], status: "pending", requiresApproval: false },
            { id: "generate", kind: "generation", title: "生成视频", dependsOn: ["create"], status: "pending", requiresApproval: false },
        ],
    };
    assert.deepEqual(nextRunnableTasks(plan, "auto").map((task) => task.id), ["create"]);
    assert.equal(planRequiresApproval(plan, "ask"), true);
});

test("script-to-scenes plan has ordered analysis and canvas tasks", () => {
    const plan = buildScriptToScenesPlan({ planId: "p1", scriptNodeId: "script-1", sceneCount: 3 });
    assert.deepEqual(plan.tasks.map((task) => [task.id, task.dependsOn]), [
        ["p1:read", []], ["p1:extract", ["p1:read"]], ["p1:create", ["p1:extract"]], ["p1:connect", ["p1:create"]],
    ]);
    assert.equal(plan.tasks[2].requiresApproval, false);
    assert.equal(plan.status, "planning");
});

test("script-to-scenes plan rejects invalid scene counts", () => {
    assert.throws(() => buildScriptToScenesPlan({ planId: "p1", scriptNodeId: "script-1", sceneCount: 1.5 }), /整数/);
    assert.throws(() => buildScriptToScenesPlan({ planId: "p1", scriptNodeId: "script-1", sceneCount: 101 }), /0 到 100/);
});
