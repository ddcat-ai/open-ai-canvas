import { compactApiParams, http } from "@/services/api/request";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export const workCategories = ["drama", "animation", "commercial", "music", "documentary", "education", "creative", "other"] as const;
export type WorkCategory = (typeof workCategories)[number];
export type WorkStatus = "pending" | "published" | "rejected" | "withdrawn" | "unlisted";
export type CommunityWork = {
    id: string;
    title: string;
    description: string;
    category: WorkCategory;
    tags: string[];
    author: string;
    kind: "image" | "video";
    mediaResourceId: string;
    coverResourceId: string;
    mediaUrl: string;
    coverUrl: string;
    projectId?: string;
    hasProject: boolean;
    status: WorkStatus;
    featured: boolean;
    reviewReason?: string;
    createdAt: string;
    updatedAt: string;
};
export type CommunityWorkInput = Pick<CommunityWork, "title" | "description" | "category" | "tags" | "mediaResourceId" | "coverResourceId" | "projectId"> & { rightsConfirmed: boolean };
export type WorkReviewAction = "approve" | "reject" | "feature" | "unfeature" | "unlist";
export type CommunityWorkReaction = { count: number; liked: boolean };
export type WorkListParams = { page?: number; pageSize?: number; status?: WorkStatus };
export type CommunityWorksPage = { items: CommunityWork[]; page: number; pageSize: number; total: number };

export const communityWorksQueryKey = ["community-works"] as const;

export function getCommunityWorkReaction(id: string, signedIn: boolean, signal?: AbortSignal) {
    return http.get<CommunityWorkReaction>(`${signedIn ? "" : "/public"}/works/${encodeURIComponent(id)}/reaction`, { signal });
}

export function setCommunityWorkLiked(id: string, liked: boolean) {
    const path = `/works/${encodeURIComponent(id)}/like`;
    return liked ? http.put<CommunityWorkReaction>(path) : http.delete<CommunityWorkReaction>(path);
}
export function getMyWorks(params: WorkListParams = {}, signal?: AbortSignal) {
    return http.get<CommunityWorksPage>("/works", { params: compactApiParams(params), signal });
}
export function submitWork(input: CommunityWorkInput) {
    return http.post<CommunityWork>("/works", input);
}
export function updateWork(id: string, input: CommunityWorkInput) {
    return http.put<CommunityWork>(`/works/${encodeURIComponent(id)}`, input);
}
export function withdrawWork(id: string) {
    return http.post<CommunityWork>(`/works/${encodeURIComponent(id)}/withdraw`);
}
export function getPublicWorks(signal?: AbortSignal, featured = true) {
    return http.get<{ items: CommunityWork[] }>("/public/works", { params: { featured }, signal });
}
export function getPublicWork(id: string, signal?: AbortSignal) {
    return http.get<CommunityWork>(`/public/works/${encodeURIComponent(id)}`, { signal });
}
export function getWorkProject(id: string, privatePreview = false, signal?: AbortSignal) {
    return http.get<{ project: CanvasProject }>(`${privatePreview ? "" : "/public"}/works/${encodeURIComponent(id)}/project`, { signal });
}
export function copyCommunityWork(id: string) {
    return http.post<{ project: CanvasProject }>(`/public/works/${encodeURIComponent(id)}/copy`);
}
export function getAdminWorks(params: WorkListParams = {}, signal?: AbortSignal) {
    return http.get<CommunityWorksPage>("/admin/works", { params: compactApiParams(params), signal });
}
export function reviewWork(id: string, action: WorkReviewAction, reason?: string) {
    return http.patch<CommunityWork>(`/admin/works/${encodeURIComponent(id)}/review`, { action, ...(reason ? { reason } : {}) });
}
