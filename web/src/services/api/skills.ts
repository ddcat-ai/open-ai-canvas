import { compactApiParams, serializeApiParams, type ApiParams } from "@/services/api/request";
import { apiClient, request } from "@/services/api/request";
import { getActiveUserScope } from "@/lib/user-scope";

const api = apiClient;

let addedSkillsRequest: { scope: string; promise: Promise<{ skills: Skill[] }> } | null = null;
let addedSkillsCache: { scope: string; value: { skills: Skill[] }; expiresAt: number } | null = null;

export type SkillSort = "popular" | "new" | "updated";
export type SkillScope = "public" | "mine" | "created" | "favorites";
export type SkillMediaType = "image" | "video";

export type SkillShowcaseMedia = {
    type: SkillMediaType;
    showcase_uri: string;
    showcase_url: string;
};

export type Skill = {
    skill_id: string;
    skill_name: string;
    description: string;
    instruction?: string;
    status: number;
    markdown_url: string;
    create_time: number;
    update_time: number;
    source: number;
    tag: string;
    sort_weight: number;
    is_private: boolean;
    like_count: number;
    is_like: boolean;
    owner_uid: string;
    effective_user: { name: string; avatar_url: string; uid: string };
    original_skill_id: string | null;
    showcase_media: SkillShowcaseMedia[];
    added_count: number;
    is_test: boolean;
    extra_info: string;
    is_added: boolean;
    is_owner: boolean;
};

export type SkillCategory = { value: string; label: string };

export type SkillList = {
    skills: Skill[];
    total_count: number;
    has_more: boolean;
    next_offset: number;
    page: number;
    page_size: number;
    categories: SkillCategory[];
};

export type ListSkillsInput = {
    page?: number;
    page_size?: number;
    scope?: SkillScope;
    sort?: SkillSort;
    search?: string;
    tag?: string;
};

export type SkillMutationInput = {
    skill_name: string;
    description: string;
    instruction: string;
    tag: string;
    is_private: boolean;
    markdown_url: string;
    showcase_media: SkillShowcaseMedia[];
    extra_info: string;
};


export function listSkills(input: ListSkillsInput = {}) {
    const params = serializeApiParams(compactApiParams(input as ApiParams));
    return request<SkillList>(api.get(`/skills?${params.toString()}`));
}

export function getSkill(id: string) {
    return request<{ skill: Skill }>(api.get(`/skills/${encodeURIComponent(id)}`));
}

export function listAddedSkills() {
    const scope = getActiveUserScope();
    const now = Date.now();
    if (addedSkillsCache?.scope === scope && addedSkillsCache.expiresAt > now) return Promise.resolve(addedSkillsCache.value);
    if (addedSkillsRequest?.scope === scope) return addedSkillsRequest.promise;
    const promise = request<{ skills: Skill[] }>(api.get("/skills/added"))
        .then((value) => {
            addedSkillsCache = { scope, value, expiresAt: Date.now() + 15_000 };
            return value;
        })
        .finally(() => {
            if (addedSkillsRequest?.promise === promise) addedSkillsRequest = null;
        });
    addedSkillsRequest = { scope, promise };
    return promise;
}

function invalidateAddedSkillsCache() {
    addedSkillsCache = null;
}

export function createSkill(input: SkillMutationInput) {
    return request<{ skill: Skill }>(api.post("/skills", input)).finally(invalidateAddedSkillsCache);
}

export function updateSkill(id: string, input: SkillMutationInput) {
    return request<{ skill: Skill }>(api.put(`/skills/${encodeURIComponent(id)}`, input)).finally(invalidateAddedSkillsCache);
}

export function deleteSkill(id: string) {
    return request<{ deleted: boolean }>(api.delete(`/skills/${encodeURIComponent(id)}`)).finally(invalidateAddedSkillsCache);
}

export function addSkill(id: string) {
    return request<{ skill: Skill }>(api.post(`/skills/${encodeURIComponent(id)}/add`)).finally(invalidateAddedSkillsCache);
}

export function removeSkill(id: string) {
    return request<{ skill: Skill }>(api.delete(`/skills/${encodeURIComponent(id)}/add`)).finally(invalidateAddedSkillsCache);
}

export function likeSkill(id: string) {
    return request<{ skill: Skill }>(api.post(`/skills/${encodeURIComponent(id)}/like`));
}

export function unlikeSkill(id: string) {
    return request<{ skill: Skill }>(api.delete(`/skills/${encodeURIComponent(id)}/like`));
}
