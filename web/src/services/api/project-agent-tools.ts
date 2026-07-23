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
] as const;

export type ProjectAgentToolName = (typeof projectAgentToolNames)[number];

export function isProjectAgentToolName(value: string): value is ProjectAgentToolName {
    return projectAgentToolNames.includes(value as ProjectAgentToolName);
}

export function isProjectAgentReadTool(value: string) {
    return value === "project_get_context" || value === "project_list_units";
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
        return createProjectAssetCandidates(projectId, candidates.filter(isCandidateInput));
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
        return linkProjectAsset(projectId, { assetId: String(rawInput.assetId || ""), category: String(rawInput.category || "other") });
    }
    if (name === "project_upsert_asset_version") {
        return createProjectAssetVersion(projectId, String(rawInput.assetId || ""), { prompt: String(rawInput.prompt || ""), definitionJson: typeof rawInput.definitionJson === "string" ? rawInput.definitionJson : undefined, note: String(rawInput.note || "") });
    }
    if (name === "project_register_task_output") {
        return registerProjectTaskOutput(projectId, String(rawInput.stepId || ""), { taskId: String(rawInput.taskId || ""), assetVersionId: String(rawInput.assetVersionId || "") || undefined, resourceId: String(rawInput.resourceId || "") || undefined, mediaType: String(rawInput.mediaType || "") || undefined, role: String(rawInput.role || "output"), metadataJson: typeof rawInput.metadataJson === "string" ? rawInput.metadataJson : undefined, outputJson: typeof rawInput.outputJson === "string" ? rawInput.outputJson : undefined });
    }
    throw new Error(`未知项目工具：${name}`);
}

function isCandidateInput(value: unknown): value is { unitId?: string; shotId?: string; name: string; category: string; details?: Record<string, unknown> } {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.name === "string" && typeof item.category === "string";
}

function isShotInput(value: unknown): value is { id?: string; unitId?: string; title: string; description?: string; position?: number; durationMs?: number; status?: string } {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.title === "string";
}

export type ProjectAgentContext = ProjectDetail;
