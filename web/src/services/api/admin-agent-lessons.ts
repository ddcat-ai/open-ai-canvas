import { compactApiParams, http } from "./request";
import type { AgentMemoryDocument } from "./agent-memory";
import { agentMemoryCategoryLabel, AGENT_MEMORY_CATEGORIES, type AgentMemory, type AgentMemoryStep } from "./agent-memories";

export type AdminAgentLesson = AgentMemory & {
    authorUserId?: string;
    authorUsername?: string;
    authorDisplayName?: string;
};

export type { AgentMemoryStep };

/** 管理员只读查看的用户长期记忆文件（GET /admin/agent-memory-documents）。 */
export type AdminAgentMemoryDocument = AgentMemoryDocument & {
    userId: string;
    username?: string;
    displayName?: string;
};

export function listAdminAgentLessons(params: { status?: string; userId?: string; keyword?: string; limit?: number } = {}) {
    const { status, userId, keyword, limit = 100 } = params;
    return http.get<{ lessons: AdminAgentLesson[] }>("/admin/agent-lessons", {
        params: compactApiParams({ status, userId, keyword, limit }),
        timeout: 15_000,
    });
}

export function deleteAdminAgentLesson(id: string) {
    return http.delete<{ id: string }>(`/admin/agent-lessons/${encodeURIComponent(id)}`, { timeout: 15_000 });
}

/** 按最近更新排序；userId 为空时列出全部用户，后端单次最多 200 份。 */
export function listAdminAgentMemoryDocuments(params: { userId?: string; limit?: number } = {}, signal?: AbortSignal) {
    const { userId, limit = 50 } = params;
    return http.get<{ documents: AdminAgentMemoryDocument[] }>("/admin/agent-memory-documents", {
        params: compactApiParams({ userId, limit }),
        signal,
        timeout: 15_000,
    });
}

export const AGENT_LESSON_CATEGORIES = AGENT_MEMORY_CATEGORIES;
export const agentLessonCategoryLabel = agentMemoryCategoryLabel;
