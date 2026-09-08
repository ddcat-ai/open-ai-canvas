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

export function buildScriptToScenesPlan(input: { planId: string; scriptNodeId: string; sceneCount?: number }): CanvasPlan {
    const count = input.sceneCount ?? 0;
    if (!input.planId.trim() || !input.scriptNodeId.trim()) throw new Error("拆场景计划必须包含 planId 和剧本节点 id");
    if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error("场景数量必须是 0 到 100 的整数");
    const tasks: CanvasTask[] = [
        { id: `${input.planId}:read`, kind: "analyze", title: "读取剧本", dependsOn: [], inputNodeIds: [input.scriptNodeId], status: "pending", requiresApproval: false },
        { id: `${input.planId}:extract`, kind: "analyze", title: "提取场景", dependsOn: [`${input.planId}:read`], inputNodeIds: [input.scriptNodeId], status: "pending", requiresApproval: false },
    ];
    if (count > 0) {
        tasks.push({ id: `${input.planId}:create`, kind: "canvas_ops", title: `创建 ${count} 个场景节点`, dependsOn: [`${input.planId}:extract`], status: "pending", requiresApproval: false });
        tasks.push({ id: `${input.planId}:connect`, kind: "canvas_ops", title: "连接场景节点", dependsOn: [`${input.planId}:create`], status: "pending", requiresApproval: false });
    }
    return { id: input.planId, title: "根据剧本拆分场景", skill: { name: "script-to-scenes", version: "1" }, tasks, status: "planning" };
}

export type PlannedScene = { title: string; content: string; x?: number; y?: number };

export function buildSceneCanvasOps(planId: string, scenes: PlannedScene[]): Array<Record<string, unknown>> {
    if (!planId.trim()) throw new Error("场景操作计划必须包含 planId");
    if (!scenes.length || scenes.length > 100) throw new Error("场景数量必须是 1 到 100");
    const seen = new Set<string>();
    const ops: Array<Record<string, unknown>> = [];
    const ids: string[] = [];
    scenes.forEach((scene, index) => {
        const title = scene.title.trim(), content = scene.content.trim();
        if (!title || !content) throw new Error("场景标题和内容不能为空");
        if (seen.has(title)) throw new Error(`场景标题重复：${title}`);
        seen.add(title);
        const id = `${planId}:scene:${index + 1}`;
        ids.push(id);
        ops.push({ type: "add_node", id, nodeType: "text", title, position: { x: scene.x ?? index * 460, y: scene.y ?? 0 }, metadata: { content, status: "success", agentPlanId: planId } });
    });
    for (let index = 1; index < ids.length; index += 1) ops.push({ type: "connect_nodes", fromNodeId: ids[index - 1], toNodeId: ids[index] });
    ops.push({ type: "select_nodes", ids });
    return ops;
}

export async function executeCanvasOpsPlan(input: {
    client: { getProject(id: string): Promise<Record<string, unknown>>; validate(id: string, body: unknown): Promise<Record<string, unknown>>; apply(id: string, body: unknown): Promise<Record<string, unknown>> };
    projectId: string;
    plan: CanvasPlan;
    ops: Array<Record<string, unknown>>;
    mode: CanvasExecutionMode;
    approved?: boolean;
}): Promise<{ status: "waiting_approval" | "applied"; plan: CanvasPlan; result?: Record<string, unknown> }> {
    const project = await input.client.getProject(input.projectId);
    const raw = (project.project && typeof project.project === "object" ? project.project : project) as Record<string, unknown>;
    const revision = typeof project.revision === "number" ? project.revision : Number(raw.revision || 0);
    const stateHash = typeof project.stateHash === "string" ? project.stateHash : String(raw.stateHash || "");
    if (!stateHash) throw new Error("远程画布未返回 stateHash，拒绝执行计划");
    const body = { ops: input.ops, expectedRevision: revision, expectedStateHash: stateHash };
    await input.client.validate(input.projectId, body);
    if (input.mode === "ask" && input.approved !== true) return { status: "waiting_approval", plan: { ...input.plan, status: "waiting_approval" } };
    const result = await input.client.apply(input.projectId, body);
    return { status: "applied", plan: { ...input.plan, status: "succeeded" }, result };
}

export async function runScriptToScenes(input: {
    planId: string;
    projectId: string;
    scriptNodeId: string;
    mode: CanvasExecutionMode;
    approved?: boolean;
    analyze: (scriptNodeId: string) => Promise<PlannedScene[]>;
    client: Parameters<typeof executeCanvasOpsPlan>[0]["client"];
}): Promise<Awaited<ReturnType<typeof executeCanvasOpsPlan>>> {
    const plan = buildScriptToScenesPlan({ planId: input.planId, scriptNodeId: input.scriptNodeId });
    const scenes = await input.analyze(input.scriptNodeId);
    const ops = buildSceneCanvasOps(input.planId, scenes);
    return executeCanvasOpsPlan({ client: input.client, projectId: input.projectId, plan, ops, mode: input.mode, approved: input.approved });
}
