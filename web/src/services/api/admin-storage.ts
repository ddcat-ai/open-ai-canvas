import { apiBaseURL, apiClient, request } from "@/services/api/request";

export type AdminResourceFilter = {
    keyword?: string;
    kind?: string;
    status?: string;
    provider?: string;
    userId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
};

export type AdminResourceItem = {
    id: string;
    userId: string;
    userName: string;
    kind: string;
    status: string;
    provider: string;
    endpoint?: string;
    bucket?: string;
    objectKey: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
    durationMs: number;
    error?: string;
    storageLocation: string;
    storageBytes: number;
    fileUrl: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminStorageStats = {
    resourceCount: number;
    byKind: Array<{ kind: string; count: number; bytes: number }>;
    byProvider: Array<{ provider: string; count: number; logicalBytes: number; physicalBytes: number }>;
    totalBytes: number;
    localBytes: number;
    remoteBytes: number;
};

export function listAdminResources(params: AdminResourceFilter = {}) {
    return request<{ items: AdminResourceItem[]; total: number; page: number; limit: number }>(apiClient.get("/admin/resources", { params }));
}

export function getAdminStorageStats() {
    return request<{ stats: AdminStorageStats }>(apiClient.get("/admin/storage/stats"));
}

export function deleteAdminResource(id: string) {
    return request<{ ok: boolean }>(apiClient.delete(`/admin/resources/${encodeURIComponent(id)}`));
}

export function adminResourceFileUrl(id: string, download = false) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/admin/resources/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}`;
}
