import { http, compactApiParams } from "./request";

export type AgentMemoryStep = { tool: string; action: string; note?: string };

export type AgentMemoryStatus = "pending" | "approved" | "rejected" | string;

export type AgentMemory = {
    id: string;
    topic: string;
    category?: string;
    situation: string;
    lesson?: string;
    steps?: AgentMemoryStep[];
    source?: string;
    status: AgentMemoryStatus;
    injected: number;
    hits: number;
    lastVerifiedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type AgentMemoryRequest = {
    topic: string;
    category: string;
    situation: string;
    lesson?: string;
    steps?: AgentMemoryStep[];
    source?: string;
};

export type AgentMemoryBundle = {
    version: number;
    kind: string;
    exportedAt: string;
    memories: Array<{
        topic: string;
        category: string;
        situation: string;
        lesson?: string;
        steps?: AgentMemoryStep[];
        source?: string;
        status?: string;
    }>;
};

export type AgentMemoryImportResult = {
    imported: number;
    merged: number;
    skipped: number;
};

export type AgentMemoryCompactInterval = "off" | "daily" | "weekly" | "monthly" | string;

export type AgentMemoryCompactStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | string;

export type AgentMemoryCompactSummary = {
    rewritten: number;
    merged: number;
    removed: number;
    skipped: number;
};

export type AgentMemoryCompactView = {
    compactInterval: AgentMemoryCompactInterval;
    logicalModelId?: string;
    channelId?: string;
    channelModelKey?: string;
    model?: string;
    lastCompactAt?: string;
    lastStatus: AgentMemoryCompactStatus;
    lastError?: string;
    taskId?: string;
    summary?: AgentMemoryCompactSummary;
};

export type AgentMemoryCompactRequest = {
    logicalModelId?: string;
    channelId?: string;
    channelModelKey?: string;
    model?: string;
};

export type AgentMemorySettingRequest = AgentMemoryCompactRequest & {
    compactInterval: AgentMemoryCompactInterval;
};

export const AGENT_MEMORY_CATEGORIES = [
    { key: "storyboard", label: "分镜" },
    { key: "video", label: "视频生成" },
    { key: "image", label: "图像生成" },
    { key: "canvas", label: "画布操作" },
    { key: "asset", label: "资产" },
    { key: "model", label: "模型选择" },
    { key: "workflow", label: "流程顺序" },
    { key: "billing", label: "计费" },
    { key: "other", label: "其他" },
] as const;

export function agentMemoryCategoryLabel(key?: string) {
    return AGENT_MEMORY_CATEGORIES.find((entry) => entry.key === key)?.label || "其他";
}

export function listAgentMemories(status?: string, limit = 200) {
    return http.get<{ memories: AgentMemory[] }>("/agent/memories", {
        params: compactApiParams({ status, limit }),
        timeout: 15_000,
    });
}

export function createAgentMemory(input: AgentMemoryRequest) {
    return http.post<AgentMemory>("/agent/memories", input, { timeout: 15_000 });
}

export function updateAgentMemory(id: string, input: AgentMemoryRequest) {
    return http.patch<AgentMemory>(`/agent/memories/${encodeURIComponent(id)}`, input, { timeout: 15_000 });
}

export function decideAgentMemory(id: string, decision: "approve" | "reject") {
    return http.post<{ id: string; decision: string }>(`/agent/memories/${encodeURIComponent(id)}/decide`, { decision }, { timeout: 15_000 });
}

export function deleteAgentMemory(id: string) {
    return http.delete<{ id: string }>(`/agent/memories/${encodeURIComponent(id)}`, { timeout: 15_000 });
}

export function exportAgentMemories() {
    return http.get<AgentMemoryBundle>("/agent/memories/export", { timeout: 30_000 });
}

export function importAgentMemories(bundle: AgentMemoryBundle) {
    return http.post<AgentMemoryImportResult>("/agent/memories/import", bundle, { timeout: 30_000 });
}

export function getAgentMemorySettings() {
    return http.get<AgentMemoryCompactView>("/agent/memories/settings", { timeout: 15_000 });
}

export function updateAgentMemorySettings(input: AgentMemorySettingRequest) {
    return http.patch<AgentMemoryCompactView>("/agent/memories/settings", input, { timeout: 15_000 });
}

export function compactAgentMemories(input: AgentMemoryCompactRequest = {}) {
    return http.post<AgentMemoryCompactView>("/agent/memories/compact", input, { timeout: 30_000 });
}
