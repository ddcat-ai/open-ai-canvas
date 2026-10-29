import { http, compactApiParams } from "./request";

/** 长期记忆文件：每个用户一份，分「关于用户」和「工作笔记」，Agent 自己维护，每次修改可撤销。 */
export type AgentMemorySection = "user" | "notes";

export type AgentMemoryMode = "auto" | "review" | "off";

export type AgentMemoryEntry = {
    id: string;
    section: AgentMemorySection;
    text: string;
    source?: string;
    originRunId?: string;
    createdAt: string;
    updatedAt: string;
};

export type AgentMemoryDocument = {
    mode: AgentMemoryMode;
    capacity: number;
    charCount: number;
    revision: number;
    entries: AgentMemoryEntry[];
    pendingCount: number;
    updatedAt: string;
};

export type AgentMemoryDocChange = {
    kind: "add" | "replace" | "remove";
    id: string;
    section: AgentMemorySection;
    before?: string;
    after?: string;
};

export type AgentMemoryDocRevision = {
    id: string;
    actor: "agent" | "user" | "restore" | "seed" | string;
    runId?: string;
    status: "applied" | "pending" | "rejected";
    summary: string;
    baseRevision: number;
    revision: number;
    changes: AgentMemoryDocChange[];
    canUndo: boolean;
    createdAt: string;
    decidedAt?: string;
    restoredAt?: string;
};

export type AgentMemoryEntryInput = { id?: string; section: AgentMemorySection; text: string };

export const AGENT_MEMORY_SECTIONS: Array<{ key: AgentMemorySection; label: string; hint: string }> = [
    { key: "user", label: "关于用户", hint: "称呼、偏好、习惯、常用规格" },
    { key: "notes", label: "工作笔记", hint: "验证过的做法、踩过的坑、项目约定" },
];

export const AGENT_MEMORY_MODES: Array<{ value: AgentMemoryMode; label: string; description: string }> = [
    { value: "auto", label: "自动生效", description: "Agent 记下的内容立即生效，可随时撤销" },
    { value: "review", label: "需我确认", description: "Agent 的修改先等你确认" },
    { value: "off", label: "关闭", description: "不使用也不修改记忆，已有内容保留" },
];

export function getAgentMemory(signal?: AbortSignal) {
    return http.get<AgentMemoryDocument>("/agent/memory", { signal, timeout: 15_000 });
}

export function saveAgentMemory(revision: number, entries: AgentMemoryEntryInput[]) {
    return http.put<AgentMemoryDocument>("/agent/memory", { revision, entries }, { timeout: 15_000 });
}

export function updateAgentMemoryMode(mode: AgentMemoryMode) {
    return http.patch<AgentMemoryDocument>("/agent/memory/settings", { mode }, { timeout: 15_000 });
}

export function listAgentMemoryRevisions(status?: AgentMemoryDocRevision["status"], limit = 50, signal?: AbortSignal) {
    return http.get<{ revisions: AgentMemoryDocRevision[] }>("/agent/memory/revisions", {
        params: compactApiParams({ status, limit }),
        signal,
        timeout: 15_000,
    });
}

export function undoAgentMemoryRevision(id: string) {
    return http.post<AgentMemoryDocument>(`/agent/memory/revisions/${encodeURIComponent(id)}/undo`, {}, { timeout: 15_000 });
}

export function decideAgentMemoryRevision(id: string, decision: "approve" | "reject") {
    return http.post<AgentMemoryDocument>(`/agent/memory/revisions/${encodeURIComponent(id)}/decide`, { decision }, { timeout: 15_000 });
}
