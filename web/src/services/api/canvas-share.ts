import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { apiClient, request } from "@/services/api/request";

const api = apiClient;

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
