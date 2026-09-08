import assert from "node:assert/strict";
import test from "node:test";
import { assertCanvasSkill, buildSceneCanvasOps, buildScriptToScenesPlan, executeCanvasOpsPlan, nextRunnableTasks, planRequiresApproval, taskNeedsApproval, type CanvasPlan } from "../src/orchestration.js";

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

test("scene results become stable canvas operations", () => {
    const ops = buildSceneCanvasOps("p1", [{ title: "场景一", content: "宿舍深夜" }, { title: "场景二", content: "长安清晨", x: 500 }]);
    assert.deepEqual(ops.map((op) => op.type), ["add_node", "add_node", "connect_nodes", "select_nodes"]);
    assert.equal(ops[0].id, "p1:scene:1");
    assert.deepEqual(ops[2], { type: "connect_nodes", fromNodeId: "p1:scene:1", toNodeId: "p1:scene:2" });
    assert.deepEqual(ops[3].ids, ["p1:scene:1", "p1:scene:2"]);
});

test("scene operation planning rejects empty or duplicate results", () => {
    assert.throws(() => buildSceneCanvasOps("p1", [{ title: "", content: "x" }]), /不能为空/);
    assert.throws(() => buildSceneCanvasOps("p1", [{ title: "场景一", content: "x" }, { title: "场景一", content: "y" }]), /重复/);
});

test("execution validates against the latest remote revision before applying", async () => {
    const calls: string[] = [];
    const client = {
        async getProject() { calls.push("get"); return { revision: 7, stateHash: "hash-7" }; },
        async validate(_id: string, body: any) { calls.push(`validate:${body.expectedRevision}:${body.expectedStateHash}`); return {}; },
        async apply(_id: string, body: any) { calls.push(`apply:${body.expectedRevision}:${body.expectedStateHash}`); return { ok: true }; },
    };
    const plan = buildScriptToScenesPlan({ planId: "p1", scriptNodeId: "script-1", sceneCount: 1 });
    const pending = await executeCanvasOpsPlan({ client, projectId: "c1", plan, ops: [], mode: "ask" });
    assert.equal(pending.status, "waiting_approval");
    assert.deepEqual(calls, ["get", "validate:7:hash-7"]);
    const applied = await executeCanvasOpsPlan({ client, projectId: "c1", plan, ops: [], mode: "ask", approved: true });
    assert.equal(applied.status, "applied");
    assert.deepEqual(calls.slice(2), ["get", "validate:7:hash-7", "apply:7:hash-7"]);
});
