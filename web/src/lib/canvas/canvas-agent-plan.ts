export type CanvasAgentPlanStatus = "pending" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "blocked";

export type CanvasAgentTask = {
    id: string;
    type: string;
    toolName: string;
    status: CanvasAgentPlanStatus;
    dependsOn: string[];
    inputNodeIds: string[];
    outputNodeIds: string[];
    retryCount: number;
};

export type CanvasAgentPlan = {
    id: string;
    goal: string;
    status: CanvasAgentPlanStatus;
    tasks: CanvasAgentTask[];
    createdAt: string;
};

export type CanvasAgentPlanToolCall = { id?: string; function?: { name?: string; arguments?: string } };

export function createCanvasAgentPlan(toolCalls: CanvasAgentPlanToolCall[], goal = "执行画布操作", now = new Date().toISOString()): CanvasAgentPlan {
    const tasks = toolCalls.map((call, index) => {
        const toolName = call.function?.name?.trim() || "unknown_tool";
        let inputNodeIds: string[] = [];
        try {
            const args = JSON.parse(call.function?.arguments || "{}");
            inputNodeIds = [args.nodeId, args.id, ...(Array.isArray(args.ids) ? args.ids : []), ...(Array.isArray(args.referenceNodeIds) ? args.referenceNodeIds : [])].filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
        } catch { /* malformed tool input remains visible as a task and fails at execution */ }
        const id = call.id?.trim() || `task-${index + 1}`;
        return { id, type: toolName.replace(/^canvas_/, ""), toolName, status: "waiting_approval" as const, dependsOn: index ? [toolCalls[index - 1].id?.trim() || `task-${index}`] : [], inputNodeIds, outputNodeIds: [], retryCount: 0 };
    });
    return { id: `plan-${now.replace(/\D/g, "").slice(-16) || "0"}`, goal: goal.trim() || "执行画布操作", status: "waiting_approval", tasks, createdAt: now };
}

export function transitionCanvasAgentPlan(plan: CanvasAgentPlan, status: CanvasAgentPlanStatus, taskId?: string): CanvasAgentPlan {
    if (!taskId) return { ...plan, status };
    const tasks = plan.tasks.map((task) => task.id === taskId ? { ...task, status } : task);
    const nextStatus = tasks.some((task) => task.status === "failed" || task.status === "blocked") ? "blocked" : tasks.every((task) => task.status === "succeeded") ? "succeeded" : plan.status;
    return { ...plan, status: nextStatus, tasks };
}

export function completeCanvasAgentPlanTasks(plan: CanvasAgentPlan, results: Array<{ ok: boolean }>): CanvasAgentPlan {
    const tasks = plan.tasks.map((task, index) => ({ ...task, status: results[index] ? (results[index].ok ? "succeeded" : "failed") : task.status }));
    const status: CanvasAgentPlanStatus = tasks.some((task) => task.status === "failed") ? "blocked" : tasks.every((task) => task.status === "succeeded") ? "succeeded" : "running";
    return { ...plan, status, tasks };
}

export function retryCanvasAgentPlanTask(plan: CanvasAgentPlan, taskId: string): CanvasAgentPlan {
    const retryable = new Set([taskId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const task of plan.tasks) {
            if (task.dependsOn.some((dependency) => retryable.has(dependency)) && !retryable.has(task.id)) {
                retryable.add(task.id);
                changed = true;
            }
        }
    }
    const tasks = plan.tasks.map((task) => retryable.has(task.id) ? { ...task, status: "pending" as const, retryCount: task.retryCount + (task.id === taskId ? 1 : 0) } : task);
    return { ...plan, status: "running", tasks };
}
