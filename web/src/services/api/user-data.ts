import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { http, compactApiParams } from "@/services/api/request";


export type RemoteUserDataSummary = {
    id: string;
    folderId?: string;
    kind?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision?: number;
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

export type CanvasLibrarySummary = Pick<CanvasProject, "id" | "projectId" | "title" | "revision" | "createdAt" | "updatedAt"> & {
    nodeCount: number;
    previewNodes: CanvasProject["nodes"];
};

export function listRemoteCanvasProjectsPage(options: { page: number; pageSize: number; projectId?: string; query?: string; sort?: string; signal?: AbortSignal }) {
    return http.get<{ projects: CanvasLibrarySummary[]; page: number; pageSize: number; total: number; hasMore: boolean }>("/canvas-projects", {
        signal: options.signal,
        params: compactApiParams({ page: options.page, pageSize: options.pageSize, projectId: options.projectId, q: options.query, sort: options.sort }),
    });
}

export function getRemoteUserDataSnapshot() {
    return http.get<RemoteUserDataSnapshot>("/user-data/snapshot");
}

export function listRemoteAssets() {
    return http.get<{ assets: RemoteUserDataSummary[] }>("/assets");
}

export function listRemoteAssetsPage(options: { page: number; pageSize: number; kind?: string; category?: string; folderId?: string; uncategorized?: boolean; status?: string; query?: string; signal?: AbortSignal }) {
    return http.get<RemoteAssetPage>("/assets", {
        signal: options.signal,
        params: compactApiParams({
            page: options.page,
            pageSize: options.pageSize,
            kind: options.kind,
            category: options.category,
            folderId: options.folderId,
            uncategorized: options.uncategorized ? 1 : undefined,
            status: options.status,
            q: options.query,
        }),
    });
}

export function listAssetFolders() {
    return http.get<{ folders: AssetFolder[] }>("/asset-folders");
}

export function createAssetFolder(name: string) {
    return http.post<{ folder: AssetFolder }>("/asset-folders", { name });
}

export function updateAssetFolder(id: string, name: string) {
    return http.patch<{ folder: AssetFolder }>(`/asset-folders/${encodeURIComponent(id)}`, { name });
}

export function deleteAssetFolder(id: string) {
    return http.delete<{ id: string }>(`/asset-folders/${encodeURIComponent(id)}`);
}

export function moveRemoteAssetsToFolder(assetIds: string[], folderId = "") {
    return http.patch<{ assetIds: string[]; folderId: string }>("/assets/folder", { assetIds, folderId });
}

export function getRemoteAsset(id: string) {
    return http.get<{ asset: Asset }>(`/assets/${encodeURIComponent(id)}`);
}

export function getRemoteAssetsByIds(ids: string[]) {
    return http.post<{ assets: Asset[] }>("/assets/batch", { ids });
}

export function upsertRemoteAsset(asset: Asset) {
    return http.put<{ asset: RemoteUserDataSummary }>(`/assets/${encodeURIComponent(asset.id)}`, { asset });
}

export function deleteRemoteAsset(id: string) {
    return http.delete<{ id: string }>(`/assets/${encodeURIComponent(id)}`);
}

export function deleteRemoteAssets(ids: string[]) {
    return http.post<{ ids: string[] }>("/assets/batch-delete", ids);
}

export function listRemoteCanvasProjects() {
    return http.get<{ projects: RemoteUserDataSummary[] }>("/canvas-projects");
}

export function getRemoteCanvasProject(id: string) {
    return http.get<{ project: CanvasProject }>(`/canvas-projects/${encodeURIComponent(id)}`);
}

export function upsertRemoteCanvasProject(project: CanvasProject) {
    const { viewport: _viewport, remoteContentHash: _hash, ...content } = project;
    return http.put<{ project: RemoteUserDataSummary & { revision: number } }>(`/canvas-projects/${encodeURIComponent(project.id)}`, { project: content });
}

export function deleteRemoteCanvasProject(id: string) {
    return http.delete<{ id: string }>(`/canvas-projects/${encodeURIComponent(id)}`);
}

export type CanvasHistoryEntry = {
    id: string;
    canvasId: string;
    revision: number;
    title: string;
    nodeCount: number;
    connectionCount: number;
    payloadBytes: number;
    reason: "automatic" | "before_restore";
    createdAt: string;
    contentUpdatedAt: string;
};

export function listCanvasHistory(id: string, signal?: AbortSignal) {
    return http.get<{ snapshots: CanvasHistoryEntry[]; currentRevision: number }>(`/canvas-projects/${encodeURIComponent(id)}/history`, { signal });
}

export function getCanvasHistoryEntry(id: string, snapshotId: string, signal?: AbortSignal) {
    return http.get<{ snapshot: CanvasHistoryEntry; project: CanvasProject }>(`/canvas-projects/${encodeURIComponent(id)}/history/${encodeURIComponent(snapshotId)}`, { signal });
}

export function restoreRemoteCanvasHistory(id: string, snapshotId: string, revision: number) {
    return http.post<{ project: RemoteUserDataSummary & { revision: number } }>(`/canvas-projects/${encodeURIComponent(id)}/history/${encodeURIComponent(snapshotId)}/restore`, { revision });
}
