import type { CanvasConnection } from "@/types/canvas";
import { apiClient, request } from "@/services/api/request";

export type TapNowImportIssue = { id?: string; name?: string; reason: string };
export type TapNowImportWarning = { id?: string; message: string };

export type TapNowImportNode = {
    id: string;
    type: "image" | "video" | "audio" | "text";
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    content: string;
    prompt?: string;
    model?: string;
    size?: string;
    quality?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    durationMs?: number;
    mimeType?: string;
    status?: "idle" | "success" | "error";
    errorDetails?: string;
    metadata: {
        provider: "tapnow";
        shareId: string;
        nodeId: string;
        batchId: string;
        sourceType?: string;
    };
};

export type TapNowImportResult = {
    batchId: string;
    batchCreatedAt: string;
    shareId: string;
    projectName: string;
    nodes: TapNowImportNode[];
    connections: CanvasConnection[];
    importedNodeCount: number;
    importedConnectionCount: number;
    skippedNodes: TapNowImportIssue[];
    skippedConnections: TapNowImportIssue[];
    warnings: TapNowImportWarning[];
    multiResultNodeCount: number;
    reusedFailedNodeCount: number;
    placeholderNodeCount: number;
};

export function importTapNowCanvas(projectId: string, shareId: string) {
    return request<TapNowImportResult>(apiClient.post(`/canvas-projects/${encodeURIComponent(projectId)}/import/tapnow`, { shareId }));
}
