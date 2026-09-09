import { describe, expect, test } from "bun:test";
import { createCanvasAgentPlan, transitionCanvasAgentPlan } from "../src/lib/canvas/canvas-agent-plan";

describe("canvas Agent plan contract", () => {
    test("turns tool calls into ordered approval tasks", () => {
        const plan = createCanvasAgentPlan([
            { id: "call-1", function: { name: "canvas_find_nodes", arguments: '{"query":"角色"}' } },
            { id: "call-2", function: { name: "canvas_update_node", arguments: '{"nodeId":"node-a"}' } },
        ], "更新角色卡", "2026-01-01T00:00:00.000Z");
        expect(plan.status).toBe("waiting_approval");
        expect(plan.tasks.map((task) => task.dependsOn)).toEqual([[], ["call-1"]]);
        expect(plan.tasks[1].inputNodeIds).toEqual(["node-a"]);
    });

    test("blocks a plan when one task fails and completes after all tasks succeed", () => {
        const plan = createCanvasAgentPlan([{ id: "a", function: { name: "canvas_apply_ops", arguments: "{}" } }], "x", "2026-01-01T00:00:00.000Z");
        expect(transitionCanvasAgentPlan(plan, "succeeded", "a").status).toBe("succeeded");
        expect(transitionCanvasAgentPlan(plan, "failed", "a").status).toBe("blocked");
    });
});
