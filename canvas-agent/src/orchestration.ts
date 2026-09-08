export type CanvasExecutionMode = "ask" | "auto";
export type CanvasSkillRisk = "read" | "write" | "destructive" | "generation";
export type CanvasTaskKind = "analyze" | "canvas_ops" | "generation" | "approval" | "wait";
export type CanvasTaskStatus = "pending" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "blocked";

export type CanvasSkillDefinition = {
    name: string;
    version: string;
    description: string;
    allowedTools: readonly string[];
    risk: CanvasSkillRisk;
    requiresSelection?: boolean;
    allowReferences?: boolean;
    allowGeneration?: boolean;
};

export type CanvasTask = {
    id: string;
    kind: CanvasTaskKind;
    title: string;
    dependsOn: string[];
    inputNodeIds?: string[];
    outputNodeIds?: string[];
    status: CanvasTaskStatus;
    requiresApproval: boolean;
    operation?: Record<string, unknown>;
};

export type CanvasPlan = {
    id: string;
    title: string;
    skill: Pick<CanvasSkillDefinition, "name" | "version">;
    tasks: CanvasTask[];
    status: "planning" | "waiting_approval" | "running" | "succeeded" | "failed" | "cancelled";
};

const CANVAS_TOOL_PREFIX = "canvas_";

export function assertCanvasSkill(skill: CanvasSkillDefinition): void {
    if (!skill.name.trim() || !skill.version.trim()) throw new Error("画布 Skill 必须包含 name 和 version");
    if (skill.allowedTools.some((tool) => !tool.startsWith(CANVAS_TOOL_PREFIX))) throw new Error("画布 Skill 只能使用 canvas_ 工具");
    if (skill.allowGeneration && !skill.allowedTools.some((tool) => tool.startsWith("canvas_generate_") || tool === "canvas_run_generation")) {
        throw new Error("允许媒体生成的 Skill 必须声明生成工具");
    }
}

export function taskNeedsApproval(task: Pick<CanvasTask, "kind" | "requiresApproval">, mode: CanvasExecutionMode): boolean {
    if (task.requiresApproval) return true;
    if (mode === "ask") return task.kind === "canvas_ops" || task.kind === "generation";
    return false;
}

export function nextRunnableTasks(plan: CanvasPlan, mode: CanvasExecutionMode): CanvasTask[] {
    const completed = new Set(plan.tasks.filter((task) => task.status === "succeeded").map((task) => task.id));
    return plan.tasks.filter((task) => task.status === "pending" && task.dependsOn.every((id) => completed.has(id)) && !taskNeedsApproval(task, mode));
}

export function planRequiresApproval(plan: CanvasPlan, mode: CanvasExecutionMode): boolean {
    return plan.tasks.some((task) => task.status === "pending" && taskNeedsApproval(task, mode));
}
