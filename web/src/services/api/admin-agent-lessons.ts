import { compactApiParams, http } from "./request";
import { agentMemoryCategoryLabel, AGENT_MEMORY_CATEGORIES, type AgentMemory, type AgentMemoryStep } from "./agent-memories";

export type AdminAgentLesson = AgentMemory & {
    authorUserId?: string;
    authorUsername?: string;
    authorDisplayName?: string;
};

export type { AgentMemoryStep };

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

export const AGENT_LESSON_CATEGORIES = AGENT_MEMORY_CATEGORIES;
export const agentLessonCategoryLabel = agentMemoryCategoryLabel;
