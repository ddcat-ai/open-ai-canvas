import axios from "axios";

import { compactApiParams, serializeApiParams, type ApiParams } from "@/services/api/request";
import type { BackendEnvelope } from "@/services/api/task-center";

const apiBaseURL = import.meta.env.VITE_CANVAS_BACKEND_URL || "/api";
const api = axios.create({ baseURL: apiBaseURL, withCredentials: true });

export type UpdreamSkillSort = "hot" | "top_rated" | "new";

export type UpdreamSkill = {
    dir: string;
    name: string;
    description: string;
    icon_url: string;
    cover_url: string;
    detail_content: string;
    detail_text: string;
    categories: string[];
    version: number;
    uploader_id: number;
    uploader_name: string;
    uploader_avatar: string;
    is_private: boolean;
    review_status: string;
    ctime: string;
    mtime: string;
    featured_label?: string;
    activation_count: number;
    like_count: number;
    usage_count: number;
    comment_count: number;
    rating_count: number;
    avg_rating: number | null;
    hot_score?: number;
    liked: boolean;
    activated: boolean;
    user_rating?: number | null;
    share_scope?: string;
    share_team_id?: unknown;
};

export type CommunitySkillList = {
    skills: UpdreamSkill[];
    total: number;
    page: number;
    page_size: number;
    categories: string[];
};

export type SkillIntegrationCapabilities = {
    provider: "updream";
    publicCommunity: boolean;
    categoryFilter: boolean;
    publicRankings: boolean;
    privateAuthorization: "not_configured" | "configured";
    upload: boolean;
    comments: boolean;
};

export type ListCommunitySkillsInput = {
    page?: number;
    page_size?: number;
    sort?: UpdreamSkillSort;
    search?: string;
    categories?: string[];
};

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    const response = await promise;
    if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
    return response.data.data;
}

export function listCommunitySkills(input: ListCommunitySkillsInput = {}) {
    const params = serializeApiParams(compactApiParams(input as ApiParams));
    return request<CommunitySkillList>(api.get(`/skills/community?${params.toString()}`));
}

export function getSkillIntegrationCapabilities() {
    return request<{ capabilities: SkillIntegrationCapabilities }>(api.get("/skills/capabilities"));
}

export function getCommunitySkill(dir: string) {
    return request<{ skill: UpdreamSkill }>(api.get(`/skills/community/${encodeURIComponent(dir)}`));
}

export function listActivatedSkills() {
    return request<{ skills: UpdreamSkill[] }>(api.get("/skills/activated"));
}

export function listFavoriteSkills() {
    return request<{ skills: UpdreamSkill[] }>(api.get("/skills/favorites"));
}

export function activateSkill(dir: string) {
    return request<{ skill: UpdreamSkill }>(api.post(`/skills/${encodeURIComponent(dir)}/activate`));
}

export function deactivateSkill(dir: string) {
    return request<{ skill: UpdreamSkill }>(api.delete(`/skills/${encodeURIComponent(dir)}/activate`));
}

export function favoriteSkill(dir: string) {
    return request<{ skill: UpdreamSkill }>(api.post(`/skills/${encodeURIComponent(dir)}/favorite`));
}

export function unfavoriteSkill(dir: string) {
    return request<{ skill: UpdreamSkill }>(api.delete(`/skills/${encodeURIComponent(dir)}/favorite`));
}

export function skillImageUrl(value?: string) {
    if (!value || !/^https?:\/\//i.test(value)) return value || "";
    return `${apiBaseURL.replace(/\/$/, "")}/skills/image?url=${encodeURIComponent(value)}`;
}
