import { createHash } from "node:crypto";
import { z } from "zod";
import { toolNames } from "./schemas.js";
import { RemoteMcpError } from "./remote-client.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

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

const canvasTools = new Set<string>([...toolNames.filter((name) => name.startsWith("canvas_")), "canvas_prepare_scene_plan", "canvas_apply_scene_plan"]);

export function assertCanvasSkill(skill: CanvasSkillDefinition): void {
    if (!skill.name.trim() || !skill.version.trim()) throw new Error("画布 Skill 必须包含 name 和 version");
    if (skill.allowedTools.some((tool) => !canvasTools.has(tool))) throw new Error("画布 Skill 只能使用已注册的 canvas_ 工具");
    if (skill.allowGeneration && !skill.allowedTools.some((tool) => tool.startsWith("canvas_generate_") || tool === "canvas_run_generation" || tool === "canvas_create_image_prompt_flow" || tool === "canvas_create_generation_flow")) {
        throw new Error("允许媒体生成的 Skill 必须声明生成工具");
    }
}

export function taskNeedsApproval(task: Pick<CanvasTask, "kind" | "requiresApproval">, mode: CanvasExecutionMode): boolean {
    if (task.requiresApproval) return true;
    if (mode === "ask") return task.kind === "canvas_ops" || task.kind === "generation";
    return false;
}

export function nextRunnableTasks(plan: CanvasPlan, mode: CanvasExecutionMode): CanvasTask[] {
    if (plan.status !== "running") return [];
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

export const plannedScenesSchema = z.array(z.object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20000),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
}).strict()).min(1).max(100).refine((scenes) => scenes.reduce((sum, scene) => sum + scene.content.length, 0) <= 100000, "场景正文合计不能超过 100000 字符");
export type PlannedScene = z.infer<typeof plannedScenesSchema>[number];

export function buildSceneCanvasOps(planId: string, scenes: PlannedScene[]): Array<Record<string, unknown>> {
    if (!planId.trim()) throw new Error("场景操作计划必须包含 planId");
    scenes = plannedScenesSchema.parse(scenes);
    const ops: Array<Record<string, unknown>> = [];
    const ids: string[] = [];
    const seen = new Set<string>();
    scenes.forEach((scene, index) => {
        const title = scene.title.trim(), content = scene.content.trim();
        if (seen.has(title)) throw new Error(`场景标题重复：${title}`);
        seen.add(title);
        if (!title || !content) throw new Error("场景标题和内容不能为空");
        const id = `${planId}:scene:${index + 1}`;
        ids.push(id);
        ops.push({ type: "add_node", id, nodeType: "text", title, width: 420, height: 300, position: { x: scene.x ?? index * 460, y: scene.y ?? 0 }, metadata: { content, status: "success", agentPlanId: planId } });
    });
    for (let index = 1; index < ids.length; index += 1) ops.push({ type: "connect_nodes", fromNodeId: ids[index - 1], toNodeId: ids[index] });
    ops.push({ type: "select_nodes", ids });
    return ops;
}

export type CanvasPlanClient = {
    getProject(id: string): Promise<Record<string, unknown>>;
    validate(id: string, body: unknown): Promise<Record<string, unknown>>;
    apply(id: string, body: unknown): Promise<Record<string, unknown>>;
};

export type PreparedCanvasPlan = {
    projectId: string;
    plan: CanvasPlan;
    ops: Array<Record<string, unknown>>;
    expectedRevision: number;
    expectedStateHash: string;
    approvalDigest: string;
};

export function remoteCanvasVersion(project: Record<string, unknown>) {
    if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0 || typeof project.stateHash !== "string" || !project.stateHash.trim()) {
        throw new Error("远程画布缺少有效 revision/stateHash，拒绝执行计划");
    }
    return { expectedRevision: project.revision as number, expectedStateHash: project.stateHash };
}

export function assertCanvasVersion(project: Record<string, unknown>, expected: Pick<PreparedCanvasPlan, "expectedRevision" | "expectedStateHash">) {
    const actual = remoteCanvasVersion(project);
    if (actual.expectedRevision !== expected.expectedRevision || actual.expectedStateHash !== expected.expectedStateHash) {
        throw new RemoteMcpError(409, "画布已变化，请重新读取并规划；不能给旧操作换上新版本");
    }
}

export function scriptFromProject(project: Record<string, unknown>, scriptNodeId: string): CanvasNode {
    const snapshot = project.project as CanvasSnapshot | undefined;
    const node = snapshot?.nodes?.find((item) => item.id === scriptNodeId);
    if (!node || !["script", "text"].includes(node.type)) throw new Error("请选择当前画布中真实的剧本或文本节点");
    if (typeof node.metadata?.content !== "string" || !node.metadata.content.trim()) throw new Error("剧本节点正文为空");
    return node;
}

function approvalDigest(value: Omit<PreparedCanvasPlan, "approvalDigest">): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function prepareSceneCanvasPlan(input: { planId: string; projectId: string; scriptNodeId: string; project: Record<string, unknown>; scenes: PlannedScene[] }): PreparedCanvasPlan {
    const version = remoteCanvasVersion(input.project);
    const source = scriptFromProject(input.project, input.scriptNodeId);
    const scenes = plannedScenesSchema.parse(input.scenes);
    const nodes = (input.project.project as CanvasSnapshot).nodes || [];
    const startX = nodes.reduce((max, node) => Math.max(max, (node.position?.x || 0) + (node.width || 420)), 0) + 80;
    const ops = buildSceneCanvasOps(input.planId, scenes.map((scene, index) => ({ ...scene, x: startX + index * 460, y: source.position?.y || 0 })));
    const ids = ops.filter((op) => op.type === "add_node").map((op) => String(op.id));
    if (nodes.some((node) => ids.includes(node.id))) throw new Error("计划节点已存在，请检查先前执行结果");
    ops.splice(ops.length - 1, 0, { type: "connect_nodes", fromNodeId: source.id, toNodeId: ids[0] });
    const plan = buildScriptToScenesPlan({ planId: input.planId, scriptNodeId: source.id, sceneCount: scenes.length });
    plan.tasks.forEach((task) => {
        if (task.kind === "analyze") task.status = "succeeded";
        else { task.outputNodeIds = ids; task.inputNodeIds = [source.id]; }
    });
    plan.status = "waiting_approval";
    const value = { projectId: input.projectId, plan, ops, ...version };
    return { ...value, approvalDigest: approvalDigest(value) };
}

export async function validatePreparedPlan(client: CanvasPlanClient, prepared: PreparedCanvasPlan) {
    const validation = await client.validate(prepared.projectId, {
        ops: prepared.ops, expectedRevision: prepared.expectedRevision, expectedStateHash: prepared.expectedStateHash,
    });
    if (validation.ok !== true) throw new RemoteMcpError(422, "画布操作校验未通过", validation);
    if (validation.currentStateHash !== prepared.expectedStateHash) throw new RemoteMcpError(409, "校验期间画布已变化，请重新规划");
}

export async function executeCanvasOpsPlan(input: {
    client: CanvasPlanClient;
    prepared: PreparedCanvasPlan;
    mode: CanvasExecutionMode;
    approvedDigest?: string;
}): Promise<{ status: "waiting_approval" | "applied"; prepared: PreparedCanvasPlan; plan: CanvasPlan; result?: Record<string, unknown> }> {
    // Bind approval to the exact preview; a subsequent mutation must not inherit consent.
    const { approvalDigest: digest, ...preview } = structuredClone(input.prepared);
    if (approvalDigest(preview) !== digest) throw new Error("计划内容已改变，必须重新预览");
    const prepared = { ...preview, approvalDigest: digest };
    const project = await input.client.getProject(prepared.projectId);
    assertCanvasVersion(project, prepared);
    await validatePreparedPlan(input.client, prepared);
    const sensitive = prepared.ops.some((op) => !["add_node", "connect_nodes", "select_nodes"].includes(String(op.type)));
    const needsApproval = input.mode === "ask" || sensitive || prepared.plan.tasks.some((task) => task.requiresApproval);
    if (input.approvedDigest !== undefined && input.approvedDigest !== digest) throw new Error("批准摘要与计划不匹配");
    if (needsApproval && input.approvedDigest !== digest) return { status: "waiting_approval", prepared, plan: prepared.plan };
    const result = await input.client.apply(prepared.projectId, { ops: prepared.ops, expectedRevision: prepared.expectedRevision, expectedStateHash: prepared.expectedStateHash });
    const plan: CanvasPlan = { ...prepared.plan, status: "succeeded", tasks: prepared.plan.tasks.map((task) => ({ ...task, status: "succeeded" })) };
    return { status: "applied", prepared, plan, result };
}

export async function runScriptToScenes(input: {
    planId: string;
    projectId: string;
    scriptNodeId: string;
    mode: CanvasExecutionMode;
    analyze: (script: { id: string; title?: string; content: string }) => Promise<PlannedScene[]>;
    client: CanvasPlanClient;
}): Promise<Awaited<ReturnType<typeof executeCanvasOpsPlan>>> {
    const project = await input.client.getProject(input.projectId);
    remoteCanvasVersion(project);
    const node = scriptFromProject(project, input.scriptNodeId);
    const scenes = await input.analyze({ id: node.id, title: node.title, content: node.metadata!.content as string });
    const prepared = prepareSceneCanvasPlan({ ...input, project, scenes });
    return executeCanvasOpsPlan({ client: input.client, prepared, mode: input.mode });
}
