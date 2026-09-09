import { describe, expect, test } from "bun:test";
import { cancelCanvasAgentPlan, completeCanvasAgentPlanTasks, createCanvasAgentPlan, retryCanvasAgentPlanTask, transitionCanvasAgentPlan } from "../src/lib/canvas/canvas-agent-plan";

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

    test("maps tool results back to task statuses", () => {
        const plan = createCanvasAgentPlan([
            { id: "a", function: { name: "canvas_find_nodes" } },
            { id: "b", function: { name: "canvas_apply_ops" } },
        ]);
        expect(completeCanvasAgentPlanTasks(plan, [{ ok: true }, { ok: true }]).status).toBe("succeeded");
        expect(completeCanvasAgentPlanTasks(plan, [{ ok: true }, { ok: false }]).tasks.map((task) => task.status)).toEqual(["succeeded", "failed"]);
    });

    test("retries a failed task and its dependent tasks without resetting unrelated work", () => {
        const plan = createCanvasAgentPlan([
            { id: "a", function: { name: "canvas_apply_ops" } },
            { id: "b", function: { name: "canvas_generate_image" } },
            { id: "c", function: { name: "canvas_get_generation_tasks" } },
        ]);
        const failed = completeCanvasAgentPlanTasks(plan, [{ ok: true }, { ok: false }, { ok: false }]);
        const retried = retryCanvasAgentPlanTask(failed, "b");
        expect(retried.status).toBe("running");
        expect(retried.tasks.map((task) => task.status)).toEqual(["succeeded", "pending", "pending"]);
        expect(retried.tasks[1].retryCount).toBe(1);
    });

    test("cancels unfinished tasks while preserving completed work", () => {
        const plan = createCanvasAgentPlan([{ id: "a", function: { name: "canvas_apply_ops" } }, { id: "b", function: { name: "canvas_generate_image" } }]);
        const running = transitionCanvasAgentPlan(transitionCanvasAgentPlan(plan, "succeeded", "a"), "running");
        const cancelled = cancelCanvasAgentPlan(running);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.tasks.map((task) => task.status)).toEqual(["succeeded", "cancelled"]);
        expect(cancelCanvasAgentPlan(cancelled)).toBe(cancelled);
    });
});
