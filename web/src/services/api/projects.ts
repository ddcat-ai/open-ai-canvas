import { apiClient, request } from "@/services/api/request";

const api = apiClient;

export type Project = {
    id: string;
    userId: string;
    name: string;
    type: string;
    aspectRatio: string;
    sourceType: string;
    description: string;
    stylePresetId: string;
    styleProfileJson?: string;
    status: "active" | "archived" | string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type ProjectCanvas = {
    id: string;
    projectId?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
};

export type CanvasUnitLink = {
    id: string;
    projectId: string;
    canvasId: string;
    unitId: string;
    role: string;
    createdAt: string;
};

export type ProjectUnit = {
    id: string;
    projectId: string;
    kind: "chapter" | "episode" | string;
    title: string;
    sourceText: string;
    status: "draft" | "ready" | "completed" | string;
    position: number;
    createdAt: string;
    updatedAt: string;
};

export type ProjectAsset = {
    id: string;
    title: string;
    mediaType: string;
    category: string;
    status: string;
    primaryVersionId?: string;
    versionCount: number;
    usages: string[];
    updatedAt: string;
    character?: CharacterCardSummary;
};

export type CharacterRepresentation = {
    id: string;
    resourceId: string;
    mediaType: string;
    role: "primary" | "front" | "side" | "back" | "turnaround_sheet" | "expression_sheet" | string;
};

export type VoiceProfile = {
    id: string;
    name: string;
    provider: string;
    voiceKey: string;
    language: string;
    timbre: string;
    sampleResourceId?: string;
    compatibleModels: string[];
    status: string;
};

export type CharacterCardSummary = {
    versionId: string;
    version: number;
    definition: Record<string, unknown>;
    representations: CharacterRepresentation[];
    voice?: { profile: VoiceProfile; instructions: string };
    visualStatus: "missing" | "partial" | "ready" | string;
    voiceStatus: "missing" | "ready" | "unavailable" | string;
};

export type ProjectCharacterDetail = {
    asset: ProjectAsset;
    character: CharacterCardSummary;
};

export type ProjectAssetCandidate = {
    id: string;
    projectId: string;
    unitId?: string;
    shotId?: string;
    name: string;
    category: string;
    status: "pending_confirmation" | "confirmed" | "ignored" | string;
    detailsJson: string;
    resolvedAssetId?: string;
    createdAt: string;
    updatedAt: string;
};

export type ProjectShot = {
    id: string;
    projectId: string;
    unitId?: string;
    title: string;
    description: string;
    position: number;
    durationMs: number;
    status: string;
    createdAt: string;
    updatedAt: string;
};

export type ShotAssetReference = {
    id: string;
    shotId: string;
    assetVersionId: string;
    role: "reference" | "start_frame" | "end_frame" | "keyframe" | "storyboard" | "output" | string;
    status: string;
    createdAt: string;
};

export type WorkflowStep = {
    id: string;
    workflowInstanceId: string;
    stepKey: string;
    name: string;
    position: number;
    status: "pending" | "ready" | "running" | "review" | "completed" | "failed" | "skipped" | string;
    error?: string;
    updatedAt: string;
};

export type ProjectWorkflow = {
    instance: { id: string; projectId: string; unitId?: string; scope: string; status: string; revision: number };
    steps: WorkflowStep[];
};

export type ProjectSummary = {
    project: Project;
    canvasCount: number;
    assetCount: number;
    unitCount: number;
    completedUnitCount: number;
};

export type ProjectDetail = {
    project: Project;
    units: ProjectUnit[];
    canvases: ProjectCanvas[];
    canvasUnitLinks: CanvasUnitLink[];
    assets: ProjectAsset[];
    workflows: ProjectWorkflow[];
    shots: ProjectShot[];
    shotReferences: ShotAssetReference[];
    assetCandidates: ProjectAssetCandidate[];
};


export function listProjects() {
    return request<{ projects: ProjectSummary[] }>(api.get("/projects"));
}

export function getProject(id: string) {
    return request<ProjectDetail>(api.get(`/projects/${encodeURIComponent(id)}`));
}

export function createProject(input: { name: string; type: string; aspectRatio: string; sourceType: string; description?: string; stylePresetId?: string; styleProfileJson?: string }) {
    return request<{ project: Project }>(api.post("/projects", input));
}

export function updateProject(projectId: string, input: Partial<Pick<Project, "name" | "type" | "aspectRatio" | "sourceType" | "description" | "stylePresetId" | "styleProfileJson" | "status">>) {
    return request<{ project: Project }>(api.patch(`/projects/${encodeURIComponent(projectId)}`, input));
}

export function deleteProject(projectId: string) {
    return request<{ id: string }>(api.delete(`/projects/${encodeURIComponent(projectId)}`));
}

export function createProjectUnit(projectId: string, input: { kind: string; title: string; sourceText?: string; position?: number }) {
    return request<{ unit: ProjectUnit }>(api.post(`/projects/${encodeURIComponent(projectId)}/units`, input));
}

export function getProjectUnit(projectId: string, unitId: string) {
    return request<{ unit: ProjectUnit }>(api.get(`/projects/${encodeURIComponent(projectId)}/units/${encodeURIComponent(unitId)}`));
}

export function importProjectUnits(projectId: string, units: Array<{ kind: string; title: string; sourceText?: string }>) {
    return request<{ units: ProjectUnit[] }>(api.post(`/projects/${encodeURIComponent(projectId)}/units/import`, { units }));
}

export function reorderProjectUnits(projectId: string, unitIds: string[]) {
    return request<{ unitIds: string[] }>(api.patch(`/projects/${encodeURIComponent(projectId)}/units/reorder`, { unitIds }));
}

export function updateProjectUnit(projectId: string, unitId: string, input: { title?: string; sourceText: string; status?: ProjectUnit["status"] }) {
    return request<{ unit: ProjectUnit }>(api.patch(`/projects/${encodeURIComponent(projectId)}/units/${encodeURIComponent(unitId)}`, input));
}

export function deleteProjectUnit(projectId: string, unitId: string) {
    return request<{ id: string }>(api.delete(`/projects/${encodeURIComponent(projectId)}/units/${encodeURIComponent(unitId)}`));
}

export function linkCanvasUnit(projectId: string, input: { canvasId: string; unitId: string; role?: string }) {
    return request<{ link: { id: string; projectId: string; canvasId: string; unitId: string; role: string } }>(api.post(`/projects/${encodeURIComponent(projectId)}/canvas-links`, input));
}

export function unlinkCanvasUnit(projectId: string, canvasId: string, unitId: string) {
    return request<{ canvasId: string; unitId: string }>(api.delete(`/projects/${encodeURIComponent(projectId)}/canvas-links/${encodeURIComponent(canvasId)}/units/${encodeURIComponent(unitId)}`));
}

export function unlinkCanvasProject(projectId: string, canvasId: string) {
    return request<{ canvasId: string }>(api.delete(`/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}`));
}

export function linkProjectAsset(projectId: string, input: { assetId: string; category: string }) {
    return request<{ asset: ProjectAsset }>(api.post(`/projects/${encodeURIComponent(projectId)}/assets`, input));
}

export function unlinkProjectAsset(projectId: string, assetId: string) {
    return request<{ id: string }>(api.delete(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`));
}

export function updateProjectAssetCategory(projectId: string, assetId: string, category: string) {
    return request<{ asset: ProjectAsset }>(api.patch(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, { category }));
}

export function createProjectAssetVersion(projectId: string, assetId: string, input: { prompt?: string; definitionJson?: string; note?: string }) {
    return request<{ version: { id: string; assetId: string; version: number; status: string } }>(api.post(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/versions`, input));
}

export function listVoiceProfiles() {
    return request<{ profiles: VoiceProfile[] }>(api.get("/voice-profiles"));
}

export function createProjectCharacter(projectId: string, input: { name: string; definition?: Record<string, unknown> }) {
    return request<ProjectCharacterDetail>(api.post(`/projects/${encodeURIComponent(projectId)}/characters`, input));
}

export function getProjectCharacter(projectId: string, assetId: string) {
    return request<ProjectCharacterDetail>(api.get(`/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(assetId)}`));
}

export function updateProjectCharacter(projectId: string, assetId: string, input: { name: string; definition: Record<string, unknown> }) {
    return request<ProjectCharacterDetail>(api.patch(`/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(assetId)}`, input));
}

export function replaceProjectCharacterRepresentations(projectId: string, assetId: string, representations: Array<{ role: string; resourceId: string; metadata?: Record<string, unknown> }>) {
    return request<ProjectCharacterDetail>(api.put(`/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(assetId)}/representations`, { representations }));
}

export function bindProjectCharacterVoice(projectId: string, assetId: string, input: { voiceProfileId: string; instructions?: string }) {
    return request<ProjectCharacterDetail>(api.put(`/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(assetId)}/voice`, input));
}

export function unbindProjectCharacterVoice(projectId: string, assetId: string) {
    return request<ProjectCharacterDetail>(api.delete(`/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(assetId)}/voice`));
}

export function createUnitWorkflow(projectId: string, unitId: string) {
    return request<{ workflow: ProjectWorkflow }>(api.post(`/projects/${encodeURIComponent(projectId)}/workflows`, { unitId }));
}

export function saveProjectShot(projectId: string, input: { id?: string; unitId?: string; title: string; description?: string; position?: number; durationMs?: number; status?: string }) {
    return request<{ shot: ProjectShot }>(api.post(`/projects/${encodeURIComponent(projectId)}/shots`, input));
}

export function replaceProjectUnitShots(projectId: string, unitId: string, shots: Array<{ title: string; description: string; durationMs: number }>) {
    return request<{ shots: ProjectShot[] }>(api.put(`/projects/${encodeURIComponent(projectId)}/units/${encodeURIComponent(unitId)}/shots`, { shots }));
}

export function linkShotAsset(projectId: string, shotId: string, input: { assetVersionId: string; role: ShotAssetReference["role"] }) {
    return request<{ reference: ShotAssetReference }>(api.post(`/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/assets`, input));
}

export function createProjectAssetCandidates(projectId: string, candidates: Array<{ unitId?: string; shotId?: string; name: string; category: string; details?: Record<string, unknown> }>) {
    return request<{ candidates: ProjectAssetCandidate[] }>(api.post(`/projects/${encodeURIComponent(projectId)}/asset-candidates`, { candidates }));
}

export function confirmProjectAssetCandidate(projectId: string, candidateId: string, assetId?: string) {
    return request<{ asset: ProjectAsset }>(api.post(`/projects/${encodeURIComponent(projectId)}/asset-candidates/${encodeURIComponent(candidateId)}/confirm`, { assetId: assetId || "" }));
}

export function updateWorkflowStep(projectId: string, stepId: string, input: { status: string; outputJson?: string; error?: string }) {
    return request<{ step: WorkflowStep }>(api.patch(`/projects/${encodeURIComponent(projectId)}/workflow-steps/${encodeURIComponent(stepId)}`, input));
}

export function registerProjectTaskOutput(projectId: string, stepId: string, input: { taskId: string; assetVersionId?: string; resourceId?: string; mediaType?: string; role?: string; metadataJson?: string; outputJson?: string }) {
    return request<{ step: WorkflowStep }>(api.post(`/projects/${encodeURIComponent(projectId)}/workflow-steps/${encodeURIComponent(stepId)}/task-output`, input));
}
