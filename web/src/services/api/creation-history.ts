import { http } from "./request";

export type HistoryMetadata = { revision: number; title: string; canvasId?: string };
export type HistoryMessage = { id: string; revision: number; data: Record<string, unknown>; deleted?: boolean };
export type HistorySummary = { id: string; title: string; canvasId?: string; revision: number; metadataRevision: number; deleted: boolean; updatedAt: string };
export type HistoryDetail = HistorySummary & { messages: HistoryMessage[]; conflicts: string[] };
export type HistoryMutation = { metadata?: HistoryMetadata; messages?: HistoryMessage[]; delete?: boolean };

export function creationHistoryAPI(scope: string, signal: AbortSignal) {
    const config = { signal, headers: { "X-Canvas-Expected-User": scope } };
    return {
        list: (after: string) => http.get<{ items: HistorySummary[]; next: string }>("/creation-conversations", { ...config, params: { after } }),
        get: (id: string) => http.get<HistoryDetail>(`/creation-conversations/${encodeURIComponent(id)}`, config),
        sync: (id: string, mutation: HistoryMutation) => http.post<HistoryDetail>(`/creation-conversations/${encodeURIComponent(id)}/sync`, mutation, config),
    };
}
