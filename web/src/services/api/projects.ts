import axios from "axios";

import type { BackendEnvelope } from "@/services/api/task-center";

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

export type Project = {
    id: string;
    userId: string;
    name: string;
    type: string;
    aspectRatio: string;
    sourceType: string;
    description: string;
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
    unitCount: number;
    completedUnitCount: number;
};

export type ProjectDetail = {
    project: Project;
    units: ProjectUnit[];
    canvases: ProjectCanvas[];
    assets: ProjectAsset[];
    workflows: ProjectWorkflow[];
	shots: ProjectShot[];
	shotReferences: ShotAssetReference[];
	assetCandidates: ProjectAssetCandidate[];
};

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    try {
        const response = await promise;
        if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
        return response.data.data;
    } catch (error) {
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) throw new Error(error.response?.data?.msg || error.message || "请求失败");
        throw error;
    }
}

export function listProjects() {
    return request<{ projects: ProjectSummary[] }>(api.get("/projects"));
}

export function getProject(id: string) {
    return request<ProjectDetail>(api.get(`/projects/${encodeURIComponent(id)}`));
}

export function createProject(input: { name: string; type: string; aspectRatio: string; sourceType: string }) {
    return request<{ project: Project }>(api.post("/projects", input));
}

export function createProjectUnit(projectId: string, input: { kind: string; title: string; sourceText?: string; position?: number }) {
    return request<{ unit: ProjectUnit }>(api.post(`/projects/${encodeURIComponent(projectId)}/units`, input));
}

export function linkCanvasUnit(projectId: string, input: { canvasId: string; unitId: string; role?: string }) {
    return request<{ link: { id: string; projectId: string; canvasId: string; unitId: string; role: string } }>(api.post(`/projects/${encodeURIComponent(projectId)}/canvas-links`, input));
}

export function linkProjectAsset(projectId: string, input: { assetId: string; category: string }) {
    return request<{ asset: ProjectAsset }>(api.post(`/projects/${encodeURIComponent(projectId)}/assets`, input));
}

export function unlinkProjectAsset(projectId: string, assetId: string) {
    return request<{ id: string }>(api.delete(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`));
}

export function createProjectAssetVersion(projectId: string, assetId: string, input: { prompt?: string; definitionJson?: string; note?: string }) {
    return request<{ version: { id: string; assetId: string; version: number; status: string } }>(api.post(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/versions`, input));
}

export function createUnitWorkflow(projectId: string, unitId: string) {
    return request<{ workflow: ProjectWorkflow }>(api.post(`/projects/${encodeURIComponent(projectId)}/workflows`, { unitId }));
}

export function saveProjectShot(projectId: string, input: { id?: string; unitId?: string; title: string; description?: string; position?: number; durationMs?: number; status?: string }) {
    return request<{ shot: ProjectShot }>(api.post(`/projects/${encodeURIComponent(projectId)}/shots`, input));
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
