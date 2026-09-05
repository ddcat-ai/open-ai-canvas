import type { ToolName } from "./schemas.js";
import type { CanvasContext } from "./canvas-context.js";
import type { CanvasSnapshot } from "./types.js";

/* ------------------------------------------------------------------ *
 * W1-02 #2 Agent Context v1（D-042）：影策项目域蒸馏摘要。
 *
 * 架构决策（本轮定稿）：
 * - 复用既有 requestCanvasTool WS 回传通道 + project_get_context 工具
 *   （前端 runProjectAgentTool → 影策 8080 ProjectDetail），canvas-agent
 *   不直连 8080、不扩 CanvasSnapshot 推送结构（避开 Canvas 数据模型改动）。
 * - 蒸馏原则：不全量塞 JSON——只投影 Agent 决策所需字段（章节/镜头序列/
 *   角色场景清单/最新任务与产物状态），prompt 正文一律不下发。
 * - 降级原则：项目段拉取失败只追加 warning，不阻塞纯画布上下文。
 * ------------------------------------------------------------------ */

/** 影策项目蒸馏后的单镜摘要（不含 prompt 正文）。 */
export type ProjectShotSummary = {
    shotId: string;
    unitId: string;
    /** 单元内序号（position + 1） */
    ordinal: number;
    title: string;
    status: string;
    /** 关联画布节点 id——命中当前选中节点即视为「当前镜头」 */
    canvasNodeId?: string;
    plannedDurationMs: number;
    effectiveDurationMs?: number;
    latestTask?: { id: string; status: string };
    latestArtifact?: { version: number; type: string; status: string; selected: boolean };
};

export type ProjectContextSummary = {
    projectId: string;
    projectTitle: string;
    units: Array<{ id: string; title: string; kind?: string; status?: string }>;
    shotCount: number;
    shots: ProjectShotSummary[];
    characters: Array<{ assetId: string; name: string }>;
    locations: Array<{ assetId: string; name: string }>;
    /** 由选中节点 ↔ shot.canvasNodeId 匹配得出 */
    currentShotId?: string;
    prevShotId?: string;
    nextShotId?: string;
    warnings: string[];
};

/** project_get_context 注入 canvas_get_context 后的返回类型 */
export type CanvasContextWithProject = CanvasContext & { project?: ProjectContextSummary };

export type RequestCanvasTool = (name: ToolName, input: Record<string, unknown>) => Promise<unknown>;

/** 单镜摘要上限：防止超长分镜把 Agent 上下文撑爆；超出部分截断并告警。 */
const MAX_SHOT_SUMMARIES = 60;

type ProjectDetailLike = {
    project?: { id?: string; title?: string };
    units?: Array<Record<string, unknown>>;
    shots?: Array<Record<string, unknown>>;
    assets?: Array<Record<string, unknown>>;
    shotArtifacts?: Array<Record<string, unknown>>;
    tasks?: Array<Record<string, unknown>>;
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** 拉取并蒸馏影策项目上下文；失败抛出，由 withProjectContext 统一降级。 */
export async function buildProjectContextSummary(requestTool: RequestCanvasTool, projectId: string, state: CanvasSnapshot | null): Promise<ProjectContextSummary> {
    const detail = (await requestTool("project_get_context", { projectId })) as ProjectDetailLike;
    const warnings: string[] = [];

    const units = (detail.units || []).map((unit) => ({
        id: str(unit.id),
        title: str(unit.title),
        kind: str(unit.kind) || undefined,
        status: str(unit.status) || undefined,
    }));
    const unitOrder = new Map(units.map((unit, index) => [unit.id, index]));

    // 镜头按单元顺序 + 单元内 position 排序
    const shots = (detail.shots || []).slice().sort((left, right) => {
        const unitDiff = (unitOrder.get(str(left.unitId)) ?? 9_999) - (unitOrder.get(str(right.unitId)) ?? 9_999);
        return unitDiff !== 0 ? unitDiff : num(left.position) - num(right.position);
    });

    // 每镜最新任务：clientContext.shotId 匹配，updatedAt 最新者优先
    const latestTaskByShot = new Map<string, { id: string; status: string; updatedAt: string }>();
    for (const task of detail.tasks || []) {
        const clientContext = (task.clientContext && typeof task.clientContext === "object" ? task.clientContext : {}) as Record<string, unknown>;
        const shotId = str(clientContext.shotId);
        if (!shotId) continue;
        const candidate = { id: str(task.id), status: str(task.status), updatedAt: str(task.updatedAt) };
        const current = latestTaskByShot.get(shotId);
        if (!current || candidate.updatedAt > current.updatedAt) latestTaskByShot.set(shotId, candidate);
    }

    // 每镜最新产物：selected 优先，其次 version 最大
    const latestArtifactByShot = new Map<string, { version: number; type: string; status: string; selected: boolean }>();
    for (const artifact of detail.shotArtifacts || []) {
        const shotId = str(artifact.shotId);
        if (!shotId) continue;
        const candidate = { version: num(artifact.version), type: str(artifact.type), status: str(artifact.status), selected: artifact.selected === true };
        const current = latestArtifactByShot.get(shotId);
        if (!current || candidate.selected || candidate.version > current.version) latestArtifactByShot.set(shotId, candidate);
    }

    const shotSummaries: ProjectShotSummary[] = shots.map((shot, index) => {
        const shotId = str(shot.id);
        const latestTask = latestTaskByShot.get(shotId);
        return {
            shotId,
            unitId: str(shot.unitId),
            ordinal: num(shot.position) + 1,
            title: str(shot.title),
            status: str(shot.status),
            canvasNodeId: str(shot.canvasNodeId) || undefined,
            plannedDurationMs: num(shot.durationMs),
            effectiveDurationMs: num(shot.effectiveDurationMs) || undefined,
            latestTask: latestTask ? { id: latestTask.id, status: latestTask.status } : undefined,
            latestArtifact: latestArtifactByShot.get(shotId),
        };
    });
    if (shotSummaries.length > MAX_SHOT_SUMMARIES) {
        warnings.push(`镜头数量 ${shotSummaries.length} 超过上下文摘要上限 ${MAX_SHOT_SUMMARIES}，已截断；需要完整序列时用 project_list_units / project_get_context 分页读取。`);
    }
    const boundedShots = shotSummaries.slice(0, MAX_SHOT_SUMMARIES);

    // 角色 / 场景清单（只列 id + 名称）
    const characters: Array<{ assetId: string; name: string }> = [];
    const locations: Array<{ assetId: string; name: string }> = [];
    for (const asset of detail.assets || []) {
        const category = str(asset.category);
        if (category !== "character" && category !== "location") continue;
        const entry = { assetId: str(asset.id), name: str(asset.name) || str(asset.title) || str(asset.id) };
        (category === "character" ? characters : locations).push(entry);
    }

    // 当前镜头：选中画布节点 ↔ shot.canvasNodeId
    const selectedIds = new Set(state?.selectedNodeIds || []);
    let currentShotId: string | undefined;
    let prevShotId: string | undefined;
    let nextShotId: string | undefined;
    const matchedIndex = boundedShots.findIndex((shot) => shot.canvasNodeId && selectedIds.has(shot.canvasNodeId));
    if (matchedIndex >= 0) {
        currentShotId = boundedShots[matchedIndex].shotId;
        prevShotId = boundedShots[matchedIndex - 1]?.shotId;
        nextShotId = boundedShots[matchedIndex + 1]?.shotId;
    }

    return {
        projectId,
        projectTitle: str(detail.project?.title) || projectId,
        units,
        shotCount: shotSummaries.length,
        shots: boundedShots,
        characters,
        locations,
        currentShotId,
        prevShotId,
        nextShotId,
        warnings,
    };
}

/**
 * canvas_get_context 的项目段组装入口：在既有纯画布上下文之上追加
 * project 段。任何失败都降级为纯画布上下文 + warning（不阻塞 Agent）。
 */
export async function withProjectContext(context: CanvasContext, state: CanvasSnapshot | null, requestTool: RequestCanvasTool): Promise<CanvasContextWithProject> {
    const projectId = state?.domainProjectId;
    if (!projectId) return context; // 画布未关联短剧项目：维持纯画布上下文
    try {
        const project = await buildProjectContextSummary(requestTool, projectId, state);
        return { ...context, project };
    } catch (error) {
        return { ...context, warnings: [...context.warnings, `短剧项目上下文拉取失败，已降级为纯画布上下文：${error instanceof Error ? error.message : String(error)}`] };
    }
}
