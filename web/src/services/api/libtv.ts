import type { CanvasConnection } from "@/types/canvas";
import { http } from "@/services/api/request";

export type AdminLibTVSetting = {
    enabled: boolean;
    hasToken: boolean;
    updatedAt?: string;
};

export type LibTVImportIssue = { id?: string; name?: string; reason: string };
export type LibTVImportWarning = { id?: string; message: string };

export type LibTVImportMediaResult = {
    sourceIndex: number;
    content: string;
    naturalWidth?: number;
    naturalHeight?: number;
    durationMs?: number;
    mimeType?: string;
};

export type LibTVImportNode = {
    id: string;
    // 私有画布导入只返回 image/video；公开模板导入还会返回 audio/text/frame。
    type: "image" | "video" | "audio" | "text" | "frame";
    title: string;
    // 模板导入的 x/y 是世界坐标绝对值，带 parentId 的子节点不能再叠加父级偏移。
    x: number;
    y: number;
    width: number;
    height: number;
    parentId?: string;
    aspectRatio?: string;
    content: string;
    results?: LibTVImportMediaResult[];
    prompt?: string;
    model?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    durationMs?: number;
    mimeType?: string;
    status?: "idle" | "success" | "error";
    errorDetails?: string;
    metadata: {
        provider: "libtv";
        projectUuid: string;
        nodeKey: string;
        batchId: string;
        sourceType?: string;
        styleAssetUuid?: string;
        styleVersionUuid?: string;
        styleName?: string;
        templateUuid?: string;
        snapshotId?: number;
    };
};

export type LibTVImportResult = {
    batchId: string;
    batchCreatedAt: string;
    projectUuid: string;
    projectName: string;
    nodes: LibTVImportNode[];
    connections: CanvasConnection[];
    importedNodeCount: number;
    importedConnectionCount: number;
    skippedNodes: LibTVImportIssue[];
    skippedConnections: LibTVImportIssue[];
    warnings: LibTVImportWarning[];
    multiResultNodeCount: number;
    staleNodeCount: number;
    reusedFailedNodeCount: number;
    placeholderNodeCount: number;
    convertedSpecialCount: number;
};

export function getAdminLibTVSetting() {
    return http.get<{ setting: AdminLibTVSetting }>("/admin/settings/libtv");
}

export function updateAdminLibTVSetting(input: { enabled: boolean; token?: string; clearToken?: boolean }) {
    return http.patch<{ setting: AdminLibTVSetting }>("/admin/settings/libtv", input);
}

export function testAdminLibTV(uuid: string) {
    return http.post<{ ok: boolean }>("/admin/settings/libtv/test", { uuid });
}

export function importLibTVCanvas(projectId: string, uuid: string) {
    return http.post<LibTVImportResult>(`/canvas-projects/${encodeURIComponent(projectId)}/import/libtv`, { uuid });
}

/** 公开灵感模板：只做预览转换，不写入画布；确认后仍由画布页强保存。 */
export function importLibTVTemplate(projectId: string, templateUuid: string) {
    return http.post<LibTVImportResult>(`/canvas-projects/${encodeURIComponent(projectId)}/import/libtv-template`, { uuid: templateUuid });
}
