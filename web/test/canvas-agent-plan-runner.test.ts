import { expect, test } from "bun:test";
import { createCanvasAgentPlan } from "../src/lib/canvas/canvas-agent-plan";
import { CanvasAgentPlanRunner } from "../src/lib/canvas/canvas-agent-plan-runner";

function fixture() {
    return createCanvasAgentPlan(["read", "write", "next"].map((id) => ({ id, function: { name: id } })));
}

for (const reason of ["paused", "cancelled"] as const) {
    test(`${reason} stops dispatch and ignores a late write result`, async () => {
        let release!: (value: { ok: boolean }) => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const pending = new Promise<{ ok: boolean }>((resolve) => { release = resolve; });
        const calls: number[] = [];
        const runner = new CanvasAgentPlanRunner(fixture(), () => {});
        const execution = runner.run(async (index) => {
            calls.push(index);
            if (index === 1) { entered(); return pending; }
            return { ok: true };
        });
        await started;
        runner.stop(reason);
        const stopped = runner.plan;
        release({ ok: true });
        const observed = execution.then(() => null, (error) => error);
        expect(await observed).toMatchObject({ name: "AbortError" });
        expect(calls).toEqual([0, 1]);
        expect(runner.plan).toBe(stopped);
        expect(stopped.tasks[0].status).toBe("succeeded");
        expect(stopped.tasks[1].resultUnknown).toBe(true);
        expect(stopped.tasks[2].status).toBe(reason === "paused" ? "blocked" : "cancelled");
    });
}

test("failure blocks successors without executing them", async () => {
    const calls: number[] = [];
    const runner = new CanvasAgentPlanRunner(fixture(), () => {});
    await runner.run(async (index) => { calls.push(index); return { ok: index !== 1 }; });
    expect(calls).toEqual([0, 1]);
    expect(runner.plan.tasks.map((task) => task.status)).toEqual(["succeeded", "failed", "blocked"]);
    expect(runner.plan.stopReason).toBe("failed");
    await expect(runner.run(async () => ({ ok: true }))).rejects.toThrow("计划不能重复执行");
});
