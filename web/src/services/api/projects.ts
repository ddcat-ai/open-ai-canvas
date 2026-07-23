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
