import assert from "node:assert/strict";
import test from "node:test";
import { assertCanvasSkill, nextRunnableTasks, planRequiresApproval, taskNeedsApproval, type CanvasPlan } from "../src/orchestration.js";

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
