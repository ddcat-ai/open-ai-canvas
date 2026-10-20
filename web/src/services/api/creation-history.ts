import { http } from "./request";
import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";

export type CreationHistoryMessage = {
    id: string;
    role: "user" | "assistant";
    mode: "text" | "image" | "video";
    content: string;
    createdAt: string;
    model?: string;
    settings?: Record<string, string>;
    attachments?: Array<{ id: string; storageKey: string; name: string; type: string; role?: string }>;
    references?: Array<{ id: string; kind: CanvasResourceKind; label: string; mentionToken: string; attachmentId?: string }>;
    taskIds?: string[];
    clientOperationId?: string;
};
export type CreationHistory = { version: 1; sourceConversationId: string; messages: CreationHistoryMessage[] };
export type CreationHistoryInput = Omit<CreationHistory, "version"> & { title?: string };

export function getCreationHistory(sessionId: string, signal?: AbortSignal) {
    return http.get<CreationHistory>(`/agent/sessions/${encodeURIComponent(sessionId)}/creation-history`, { signal, timeout: 15_000 });
}

export function saveCreationHistory(sessionId: string, input: CreationHistoryInput) {
    return http.put<{ saved: boolean }>(`/agent/sessions/${encodeURIComponent(sessionId)}/creation-history`, input, { timeout: 15_000 });
}
