import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { apiClient, compactApiParams, request } from "@/services/api/request";

const api = apiClient;

export type RemoteUserDataSummary = {
    id: string;
    folderId?: string;
    kind?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
};

export type AssetFolder = {
    id: string;
    name: string;
    position: number;
    createdAt: string;
    updatedAt: string;
};

export type RemoteAssetPage = {
    assets: Asset[];
    kindCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
    folderCounts: Record<string, number>;
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
};

export type RemoteUserDataSnapshot = {
    assets: Asset[];
    projects: CanvasProject[];
};

export type CanvasLibrarySummary = Pick<CanvasProject, "id" | "projectId" | "title" | "createdAt" | "updatedAt"> & {
    nodeCount: number;
    previewNodes: CanvasProject["nodes"];
};

export function listRemoteCanvasProjectsPage(options: { page: number; pageSize: number; projectId?: string; query?: string; sort?: string; signal?: AbortSignal }) {
    return request<{ projects: CanvasLibrarySummary[]; page: number; pageSize: number; total: number; hasMore: boolean }>(api.get("/canvas-projects", {
        signal: options.signal,
        params: compactApiParams({ page: options.page, page_size: options.pageSize, project_id: options.projectId, q: options.query, sort: options.sort }),
    }));
}

export function getRemoteUserDataSnapshot() {
    return request<RemoteUserDataSnapshot>(api.get("/user-data/snapshot"));
}

export function listRemoteAssets() {
    return request<{ assets: RemoteUserDataSummary[] }>(api.get("/assets"));
}

export function listRemoteAssetsPage(options: { page: number; pageSize: number; kind?: string; category?: string; folderId?: string; uncategorized?: boolean; status?: string; query?: string; signal?: AbortSignal }) {
    return request<RemoteAssetPage>(api.get("/assets", {
        signal: options.signal,
        params: compactApiParams({
            page: options.page,
            page_size: options.pageSize,
            kind: options.kind,
            category: options.category,
            folder_id: options.folderId,
            uncategorized: options.uncategorized ? 1 : undefined,
            status: options.status,
            q: options.query,
        }),
    }));
}

export function listAssetFolders() {
    return request<{ folders: AssetFolder[] }>(api.get("/asset-folders"));
}

export function createAssetFolder(name: string) {
    return request<{ folder: AssetFolder }>(api.post("/asset-folders", { name }));
}

export function updateAssetFolder(id: string, name: string) {
    return request<{ folder: AssetFolder }>(api.patch(`/asset-folders/${encodeURIComponent(id)}`, { name }));
}

export function deleteAssetFolder(id: string) {
    return request<{ id: string }>(api.delete(`/asset-folders/${encodeURIComponent(id)}`));
}

export function moveRemoteAssetsToFolder(assetIds: string[], folderId = "") {
    return request<{ assetIds: string[]; folderId: string }>(api.patch("/assets/folder", { assetIds, folderId }));
}

export function getRemoteAsset(id: string) {
    return request<{ asset: Asset }>(api.get(`/assets/${encodeURIComponent(id)}`));
}

export function getRemoteAssetsByIds(ids: string[]) {
    return request<{ assets: Asset[] }>(api.post("/assets/batch", { ids }));
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
