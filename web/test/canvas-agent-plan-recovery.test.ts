import { expect, test } from "bun:test";
import { createCanvasAgentPlan, recoverCanvasAgentPlan } from "../src/lib/canvas/canvas-agent-plan";

test("recovers an interrupted plan without replaying it", () => {
    const plan = createCanvasAgentPlan(["a", "b", "c"].map((id) => ({ id, function: { name: id } })));
    const running = { ...plan, status: "running" as const, tasks: plan.tasks.map((task, index) => ({ ...task, status: index === 0 ? "succeeded" as const : index === 1 ? "running" as const : "pending" as const })) };
    const recovered = recoverCanvasAgentPlan(running);
    expect(recovered.status).toBe("blocked");
    expect(recovered.stopReason).toBe("recovered");
    expect(recovered.tasks.map((task) => task.status)).toEqual(["succeeded", "blocked", "blocked"]);
    expect(recovered.tasks[1].resultUnknown).toBe(true);
    expect(recoverCanvasAgentPlan(recovered)).toBe(recovered);
});

test("does not alter terminal plans", () => {
    const plan = createCanvasAgentPlan([{ id: "a", function: { name: "a" } }]);
    const succeeded = { ...plan, status: "succeeded" as const, tasks: plan.tasks.map((task) => ({ ...task, status: "succeeded" as const })) };
    expect(recoverCanvasAgentPlan(succeeded)).toBe(succeeded);
});
