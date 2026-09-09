import type { CanvasAgentPlan } from "./canvas-agent-plan";

export type CanvasPlanStopReason = "paused" | "cancelled";

// One controller owns one batch. An in-flight write cannot be undone by aborting
// the browser; its task remains blocked until the caller reconciles server state.
export class CanvasAgentPlanRunner {
    readonly controller = new AbortController();
    private current: CanvasAgentPlan;
    private started = false;

    constructor(plan: CanvasAgentPlan, private readonly onUpdate: (plan: CanvasAgentPlan) => void) {
        this.current = plan;
    }

    get plan() { return this.current; }
    get signal() { return this.controller.signal; }

    stop(reason: CanvasPlanStopReason) {
        if (this.signal.aborted || this.current.status === "succeeded") return;
        this.controller.abort();
        this.publish({ ...this.current, status: reason === "cancelled" ? "cancelled" : "blocked", stopReason: reason,
            tasks: this.current.tasks.map((task) => task.status === "succeeded" || task.status === "failed" ? task : {
                ...task, status: task.status === "running" || reason === "paused" ? "blocked" : "cancelled",
                ...(task.status === "running" ? { resultUnknown: true } : {}),
            }),
        });
    }

    async run<T extends { ok: boolean }>(execute: (index: number, signal: AbortSignal) => Promise<T>): Promise<T[]> {
        if (this.started) throw new Error("计划不能重复执行");
        this.started = true;
        this.signal.throwIfAborted();
        const results: T[] = [];
        this.publish({ ...this.current, status: "running", tasks: this.current.tasks.map((task) => ({ ...task, status: "pending" })) });
        for (let index = 0; index < this.current.tasks.length; index++) {
            this.signal.throwIfAborted();
            this.publish({ ...this.current, tasks: this.current.tasks.map((task, i) => i === index ? { ...task, status: "running" } : task) });
            let result: T;
            try { result = await execute(index, this.signal); }
            catch (error) {
                if (!this.signal.aborted) {
                    this.publish({ ...this.current, status: "blocked", stopReason: "failed", tasks: this.current.tasks.map((task, i) =>
                        i < index ? task : { ...task, status: "blocked", ...(i === index ? { resultUnknown: true } : {}) }) });
                }
                throw error;
            }
            // A late result must never overwrite a stopped plan or launch its successor.
            this.signal.throwIfAborted();
            results.push(result);
            this.publish({ ...this.current, status: result.ok ? (index === this.current.tasks.length - 1 ? "succeeded" : "running") : "blocked",
                ...(!result.ok ? { stopReason: "failed" as const } : {}),
                tasks: this.current.tasks.map((task, i) => i === index ? { ...task, status: result.ok ? "succeeded" : "failed" }
                    : !result.ok && i > index ? { ...task, status: "blocked" } : task),
            });
            if (!result.ok) break;
        }
        return results;
    }

    private publish(plan: CanvasAgentPlan) { this.current = plan; this.onUpdate(plan); }
}
