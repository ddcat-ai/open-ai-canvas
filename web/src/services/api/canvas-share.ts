import axios from "axios";

import type { BackendEnvelope } from "@/services/api/task-center";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

export type CanvasShareStatus = {
    enabled: boolean;
    token?: string;
    expiresAt?: string;
    createdAt?: string;
};

export type PublicCanvasShare = {
    project: CanvasProject;
    expiresAt?: string;
};

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    const response = await promise;
    if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
    return response.data.data;
}

export function getCanvasShare(projectId: string) {
    return request<{ share: CanvasShareStatus }>(api.get(`/canvas-projects/${encodeURIComponent(projectId)}/share`));
}

export function createCanvasShare(projectId: string, params: { expiresDays: number; rotate?: boolean }) {
    return request<{ share: CanvasShareStatus }>(api.post(`/canvas-projects/${encodeURIComponent(projectId)}/share`, params));
}

export function deleteCanvasShare(projectId: string) {
    return request<{ id: string }>(api.delete(`/canvas-projects/${encodeURIComponent(projectId)}/share`));
}

export function getPublicCanvasShare(token: string) {
    return request<PublicCanvasShare>(api.get(`/public/canvas-shares/${encodeURIComponent(token)}`));
}
