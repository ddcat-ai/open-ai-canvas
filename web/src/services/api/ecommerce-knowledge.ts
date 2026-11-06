import { http } from "./request";
import type { ThinkingRequest } from "@/lib/text-thinking";

export type CommerceKnowledgeSource = {
    id: string;
    name: string;
    repository: string;
    commit: string;
    license: string;
    licenseText?: string;
    status: string;
    lastSyncedAt?: string;
    errorMessage?: string;
    lastDuplicateCount: number;
};
export type CommerceKnowledgeEntry = {
    id: string;
    title: string;
    knowledgeType: string;
    category: string;
    sourceId: string;
    sourceUrl: string;
    sourceCommit: string;
    license: string;
    reviewStatus: string;
    trustLevel: string;
    contentJson: string;
    updatedAt: string;
};
export type CommerceKnowledgeStats = {
    sourceCount: number;
    entryCount: number;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
    expiredCount: number;
    categoryCoverage: Record<string, number>;
    /** Counts only approved, non-expired entries assigned to a KB01-KB10 domain. */
    domainCoverage?: Record<string, number>;
    lastSyncDuplicateCount: number;
    sources: CommerceKnowledgeSource[];
};
export type CommerceKnowledgePage = { entries: CommerceKnowledgeEntry[]; total: number; page: number; limit: number };

export const getCommerceKnowledgeStats = () => http.get<CommerceKnowledgeStats>("/ecommerce/knowledge/stats");
export type CommerceAgentModelRef = { logicalModelId?: string; channelModelId?: string; channelId?: string; modelKey?: string };
/** Resolved from the stage models: top-level fields are the planning model, `vision` the recognition and direction model (absent = same as planning). */
export type CommerceAgentSetting = { logicalModelId: string; channelModelId?: string; channelId?: string; modelKey?: string; vision?: CommerceAgentModelRef; thinkingLevel?: ThinkingRequest; visionThinkingLevel?: ThinkingRequest };
export const getCommerceAgentSetting = () => http.get<CommerceAgentSetting>("/ecommerce/agent-setting");
export type CommerceOrchestrationModel = { logicalModelId?: string; channelModelId?: string };
export type CommerceOrchestrationRole = { model: CommerceOrchestrationModel; fallback: CommerceOrchestrationModel; reuse?: string; thinkingLevel?: ThinkingRequest };
/** vision = 商品识别与视觉方向；director = 整套策划（reuse="marketing" 时沿用旧的营销策划阶段 marketing）。 */
export type CommerceOrchestrationSetting = { version: 1; enabled: false; vision: CommerceOrchestrationRole; marketing: CommerceOrchestrationRole; director: CommerceOrchestrationRole };
export const getCommerceOrchestrationSetting = () => http.get<CommerceOrchestrationSetting>("/ecommerce/knowledge/orchestration");
export const updateCommerceOrchestrationSetting = (value: CommerceOrchestrationSetting) => http.put<CommerceOrchestrationSetting>("/ecommerce/knowledge/orchestration", value);
export const syncCommerceKnowledge = () => http.post<{ imported: number; duplicates: number; failed: string[] }>("/ecommerce/knowledge/sync", {});
export const setCommerceKnowledgeSourceEnabled = (id: string, enabled: boolean) => http.patch<{ enabled: boolean }>(`/ecommerce/knowledge/sources/${encodeURIComponent(id)}`, { enabled });
export const listCommerceKnowledgeEntries = (page: number, limit: number, status: string, keyword: string) =>
    http.get<CommerceKnowledgePage>(`/ecommerce/knowledge/entries?page=${page}&limit=${limit}&status=${encodeURIComponent(status)}&keyword=${encodeURIComponent(keyword)}`);
export const reviewCommerceKnowledgeEntry = (id: string, status: "approved" | "rejected" | "pending") => http.patch<{ status: string }>(`/ecommerce/knowledge/entries/${encodeURIComponent(id)}/review`, { status });
