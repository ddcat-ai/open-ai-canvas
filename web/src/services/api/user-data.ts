import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { compactApiParams, http } from "@/services/api/request";

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

export type CanvasOperation =
    | { type: "create_canvas"; id: string; patch?: Record<string, unknown> }
    | { type: "create_node"; node: CanvasProject["nodes"][number] }
    | { type: "patch_node"; id: string; patch: Record<string, unknown>; before?: Record<string, unknown> }
    | { type: "remove_node"; id: string; expected?: CanvasProject["nodes"][number] }
    | { type: "create_connection"; connection: CanvasProject["connections"][number] }
    | { type: "update_connection"; id: string; connection: CanvasProject["connections"][number]; expected: CanvasProject["connections"][number] }
    | { type: "remove_connection"; id: string; expected?: CanvasProject["connections"][number] }
    | { type: "set_field"; field: "title" | "projectId" | "chatSessions" | "activeChatId" | "starterMode" | "appearance" | "backgroundMode" | "showImageInfo" | "previsScenes" | "timeline"; value: unknown; beforeValue: unknown };

export type CanvasOperationsRequest = {
    mutationId: string;
    baseRevision?: number;
    operations: CanvasOperation[];
    editProofs?: CanvasEditProof[];
};

export type CanvasEditProof = { nodeId: string; sessionId: string; token: string };
export type CanvasEditLease = { nodeId: string; sessionId: string; expiresAt: string };
export type CanvasAgentActivity = { runId: string; status: string; cleanupPending: boolean };
export type CanvasSyncStatus = { revision: number; serverTime: string; leases: CanvasEditLease[]; agent?: CanvasAgentActivity | null };

export function getCanvasSyncStatus(id: string, signal?: AbortSignal) {
    return http.get<CanvasSyncStatus>(`/canvas-projects/${encodeURIComponent(id)}/sync-status`, { signal, timeout: 8000 });
}

export function changeCanvasEditLease(id: string, proof: CanvasEditProof, action: "acquire" | "renew" | "release") {
    return http.post<{ serverTime: string; lease?: CanvasEditLease; token?: string }>(`/canvas-projects/${encodeURIComponent(id)}/edit-lease`, { ...proof, action }, { timeout: 8000 });
}

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

export function getRemoteCanvasProject(id: string, knownProject?: CanvasProject) {
    if (!knownProject || knownProject.id !== id || !Number.isSafeInteger(knownProject.revision)) {
        return http.get<{ project: CanvasProject }>(`/canvas-projects/${encodeURIComponent(id)}`).then((result) => ({ ...result, notModified: false }));
    }
    const etag = `"canvas-${knownProject.revision}"`;
    return http
        .get<{ project: CanvasProject } | { notModified: true }>(`/canvas-projects/${encodeURIComponent(id)}`, {
            headers: { "If-None-Match": etag },
            validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
            allowNotModified: true,
        })
        .then((result) => ("notModified" in result ? { project: knownProject, notModified: true } : { ...result, notModified: false }));
}

export function applyRemoteCanvasOperations(id: string, request: CanvasOperationsRequest) {
    return http.patch<{ project: RemoteUserDataSummary & { revision: number }; mutationId: string }>(`/canvas-projects/${encodeURIComponent(id)}/operations`, request);
}

export function deleteRemoteCanvasProject(id: string) {
    return http.delete<{ id: string }>(`/canvas-projects/${encodeURIComponent(id)}`);
}
