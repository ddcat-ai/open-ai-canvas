import axios from "axios";

import type { BackendEnvelope } from "@/services/api/task-center";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

export type RemoteUserDataSummary = {
    id: string;
    kind?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
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

export function listRemoteAssets() {
    return request<{ assets: RemoteUserDataSummary[] }>(api.get("/assets"));
}

export function getRemoteAsset(id: string) {
    return request<{ asset: Asset }>(api.get(`/assets/${encodeURIComponent(id)}`));
}

export function upsertRemoteAsset(asset: Asset) {
    return request<{ asset: RemoteUserDataSummary }>(api.put(`/assets/${encodeURIComponent(asset.id)}`, { asset }));
}

export function deleteRemoteAsset(id: string) {
    return request<{ id: string }>(api.delete(`/assets/${encodeURIComponent(id)}`));
}

export function listRemoteCanvasProjects() {
    return request<{ projects: RemoteUserDataSummary[] }>(api.get("/canvas-projects"));
}

export function getRemoteCanvasProject(id: string) {
    return request<{ project: CanvasProject }>(api.get(`/canvas-projects/${encodeURIComponent(id)}`));
}

export function upsertRemoteCanvasProject(project: CanvasProject) {
    return request<{ project: RemoteUserDataSummary }>(api.put(`/canvas-projects/${encodeURIComponent(project.id)}`, { project }));
}

export function deleteRemoteCanvasProject(id: string) {
    return request<{ id: string }>(api.delete(`/canvas-projects/${encodeURIComponent(id)}`));
}
