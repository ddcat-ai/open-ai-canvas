import type { CanvasConnection } from "@/types/canvas";
import { http } from "@/services/api/request";
import { resourceFileUrl, resourceStorageKey, type RemoteResource } from "@/services/api/resources";
import type { StoredJimengMedia } from "@/lib/canvas/jimeng-import";

export type JimengImportIssue = { id?: string; name?: string; reason: string };
export type JimengImportWarning = { id?: string; message: string };

export type JimengImportNode = {
    id: string;
    type: "image" | "video" | "frame";
    title: string;
    parentId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    content: string;
    previewContent?: string;
    prompt?: string;
    model?: string;
    size?: string;
    quality?: string;
    seconds?: string;
    vquality?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    durationMs?: number;
    mimeType?: string;
    status?: "idle" | "success";
    metadata: {
        provider: "jimeng";
        projectId: string;
        nodeId: string;
        mediaResourceId?: string;
        batchId: string;
        sourceType?: string;
        expiresAt?: string;
    };
};

export type JimengImportResult = {
    batchId: string;
    batchCreatedAt: string;
    projectId: string;
    projectName: string;
    nodes: JimengImportNode[];
    connections: CanvasConnection[];
    importedNodeCount: number;
    importedConnectionCount: number;
    skippedNodes: JimengImportIssue[];
    skippedConnections: JimengImportIssue[];
    warnings: JimengImportWarning[];
    multiResultNodeCount: number;
    placeholderNodeCount: number;
    frameNodeCount: number;
    /** 本批临时媒体地址中最早的过期时间；视频约一小时后失效。 */
    mediaExpiresAt?: string;
};

export type JimengImportMediaResult = {
    items: { resourceId: string; resource?: RemoteResource; deferred?: boolean; retryable?: boolean; error?: string }[];
    /** 大于 0 表示站点每分钟远程导入次数已用完，等待该秒数后继续。 */
    retryAfterSeconds: number;
};

export function importJimengCanvas(projectId: string, jimengProjectId: string) {
    return http.post<JimengImportResult>(`/canvas-projects/${encodeURIComponent(projectId)}/import/jimeng`, { projectId: jimengProjectId });
}

export function storeJimengImportMedia(projectId: string, jimengProjectId: string, resourceIds: string[]) {
    return http.post<JimengImportMediaResult>(`/canvas-projects/${encodeURIComponent(projectId)}/import/jimeng/media`, { projectId: jimengProjectId, resourceIds }, { timeout: 60_000 });
}

export function storedJimengMedia(resource: RemoteResource): StoredJimengMedia {
    return {
        url: resource.publicUrl || resourceFileUrl(resource.id),
        storageKey: resourceStorageKey(resource.id),
        width: resource.width || undefined,
        height: resource.height || undefined,
        durationMs: resource.durationMs || undefined,
        mimeType: resource.mimeType || undefined,
        bytes: resource.size || undefined,
    };
}
