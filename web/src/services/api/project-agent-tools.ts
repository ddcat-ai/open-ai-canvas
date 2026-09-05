import {
    confirmProjectAssetCandidate,
    createProjectAssetVersion,
    createProjectAssetCandidates,
    getProject,
    linkProjectAsset,
    linkShotAsset,
    registerProjectTaskOutput,
    saveProjectShot,
    updateWorkflowStep,
    type ProjectDetail,
    type ShotAssetReference,
} from "./projects";
import { normalizeAssetCategory, type AssetCategory } from "@/lib/asset-category";
import { regenerateShot, reviewShot, retryShotTask, selectShotArtifact } from "./generation-task";
import { distillShotContext, latestShotTask } from "./shot-context";

export { distillShotContext, latestShotTask } from "./shot-context";
export type { ShotContextSummary } from "./shot-context";

export const projectAgentToolNames = [
    "project_get_context",
    "project_list_units",
    "project_extract_asset_candidates",
    "project_confirm_asset_candidate",
    "project_create_or_update_shots",
    "project_link_shot_asset",
    "project_start_workflow_step",
    "project_link_asset",
    "project_upsert_asset_version",
    "project_register_task_output",
    "project_get_shot",
    "project_retry_shot",
    "project_regenerate_shot",
    "project_select_artifact",
    "project_review_shot",
] as const;

export type ProjectAgentToolName = (typeof projectAgentToolNames)[number];

export function isProjectAgentToolName(value: string): value is ProjectAgentToolName {
    return projectAgentToolNames.includes(value as ProjectAgentToolName);
}

export function isProjectAgentReadTool(value: string) {
    return value === "project_get_context" || value === "project_list_units" || value === "project_get_shot";
}

export async function runProjectAgentTool(name: ProjectAgentToolName, rawInput: Record<string, unknown>, fallbackProjectId?: string) {
    const projectId = String(rawInput.projectId || fallbackProjectId || "").trim();
    if (!projectId) throw new Error("当前画布没有关联短剧项目");
    if (name === "project_get_context") return getProject(projectId);
    if (name === "project_list_units") {
        const detail = await getProject(projectId);
        const kind = String(rawInput.kind || "").trim();
        const status = String(rawInput.status || "").trim();
        return { units: detail.units.filter((unit) => (!kind || unit.kind === kind) && (!status || unit.status === status)) };
    }
    if (name === "project_extract_asset_candidates") {
        const candidates = Array.isArray(rawInput.candidates) ? rawInput.candidates : [];
        return createProjectAssetCandidates(projectId, candidates.map(normalizeAgentCandidateInput).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)), "agent");
    }
    if (name === "project_confirm_asset_candidate") {
        return confirmProjectAssetCandidate(projectId, String(rawInput.candidateId || ""), String(rawInput.assetId || "") || undefined);
    }
    if (name === "project_create_or_update_shots") {
        const shots = Array.isArray(rawInput.shots) ? rawInput.shots : [];
        const result = [];
        for (const shot of shots) {
            if (!isShotInput(shot)) continue;
            result.push((await saveProjectShot(projectId, shot)).shot);
        }
        return { shots: result };
    }
    if (name === "project_link_shot_asset") {
        return linkShotAsset(projectId, String(rawInput.shotId || ""), { assetVersionId: String(rawInput.assetVersionId || ""), role: String(rawInput.role || "reference") as ShotAssetReference["role"] });
    }
    if (name === "project_start_workflow_step") {
        return updateWorkflowStep(projectId, String(rawInput.stepId || ""), { status: "running" });
    }
    if (name === "project_link_asset") {
        return linkProjectAsset(projectId, { assetId: String(rawInput.assetId || ""), category: normalizeAssetCategory(rawInput.category) });
    }
    if (name === "project_upsert_asset_version") {
        return createProjectAssetVersion(projectId, String(rawInput.assetId || ""), { prompt: String(rawInput.prompt || ""), definitionJson: typeof rawInput.definitionJson === "string" ? rawInput.definitionJson : undefined, note: String(rawInput.note || "") });
    }
    if (name === "project_register_task_output") {
        return registerProjectTaskOutput(projectId, String(rawInput.stepId || ""), { taskId: String(rawInput.taskId || ""), assetVersionId: String(rawInput.assetVersionId || "") || undefined, resourceId: String(rawInput.resourceId || "") || undefined, mediaType: String(rawInput.mediaType || "") || undefined, role: String(rawInput.role || "output"), metadataJson: typeof rawInput.metadataJson === "string" ? rawInput.metadataJson : undefined, outputJson: typeof rawInput.outputJson === "string" ? rawInput.outputJson : undefined });
    }
    /* ------------------------------------------------------------------
     * W1-B-01 Domain Tools v0.1（D-046）：意图接口第一批。
     * retry / regenerate 严格复用 W1-01 #53 既有 API，不新增第二套后端端点；
     * retry = 同一 GenerationTask 新 attempt；regenerate = 新建 GenerationTask。
     * ------------------------------------------------------------------ */
    if (name === "project_get_shot") {
        const detail = await getProject(projectId);
        const shotId = String(rawInput.shotId || "").trim();
        const summary = distillShotContext(detail, shotId);
        if (!summary) throw new Error(`镜头不存在或不属于该项目：${shotId || "(空)"}`);
        return summary;
    }
    if (name === "project_retry_shot") {
        const shotId = String(rawInput.shotId || "").trim();
        let taskId = String(rawInput.taskId || "").trim();
        if (!taskId) {
            const detail = await getProject(projectId);
            const latest = latestShotTask(detail, shotId);
            if (!latest) throw new Error(`镜头 ${shotId} 还没有生成任务，无法重试；请先提交生成`);
            taskId = latest.id;
        }
        return { task: await retryShotTask(projectId, shotId, taskId) };
    }
    if (name === "project_regenerate_shot") {
        const shotId = String(rawInput.shotId || "").trim();
        return { task: await regenerateShot(projectId, shotId) };
    }
    if (name === "project_select_artifact") {
        const shotId = String(rawInput.shotId || "").trim();
        const artifactId = String(rawInput.artifactId || "").trim();
        return { artifact: await selectShotArtifact(projectId, shotId, artifactId) };
    }
    if (name === "project_review_shot") {
        const shotId = String(rawInput.shotId || "").trim();
        const action = String(rawInput.action || "").trim();
        if (action !== "approve" && action !== "reject") {
            throw new Error("审核结论必须是 approve（通过）或 reject（打回）");
        }
        const reason = String(rawInput.reason || "").trim() || undefined;
        return { review: await reviewShot(projectId, shotId, action, reason) };
    }
    throw new Error(`未知项目工具：${name}`);
}

const agentCandidateCategories = new Set<AssetCategory>(["environment", "prop", "material", "other"]);

function normalizeAgentCandidateInput(value: unknown): { unitId?: string; shotId?: string; name: string; category: AssetCategory; details?: Record<string, unknown> } | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.category !== "string") return null;
    const category = normalizeAssetCategory(item.category);
    if (!agentCandidateCategories.has(category)) return null;
    return {
        name: item.name,
        category,
        ...(typeof item.unitId === "string" ? { unitId: item.unitId } : {}),
        ...(typeof item.shotId === "string" ? { shotId: item.shotId } : {}),
        ...(item.details && typeof item.details === "object" && !Array.isArray(item.details) ? { details: item.details as Record<string, unknown> } : {}),
    };
}

function isShotInput(value: unknown): value is { id?: string; unitId?: string; title: string; description?: string; position?: number; durationMs?: number; status?: string } {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.title === "string";
}

export type ProjectAgentContext = ProjectDetail;
