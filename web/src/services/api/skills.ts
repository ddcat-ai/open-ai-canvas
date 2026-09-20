import { ApiError, http, apiBaseURL, compactApiParams, serializeApiParams, type ApiParams } from "@/services/api/request";
import { getActiveUserScope } from "@/lib/user-scope";


let addedSkillsRequest: { scope: string; promise: Promise<{ skills: Skill[] }> } | null = null;
let addedSkillsCache: { scope: string; value: { skills: Skill[] }; expiresAt: number } | null = null;

export type SkillSort = "popular" | "new" | "updated";
export type SkillScope = "public" | "mine" | "created" | "favorites";
export type SkillMediaType = "image" | "video";

export type SkillShowcaseMedia = {
    type: SkillMediaType;
    showcaseUri: string;
    showcaseUrl: string;
};

export type Skill = {
    skillId: string;
    skillName: string;
    description: string;
    instruction?: string;
    versionId: string;
    version: string;
    contentHash: string;
    fileCount: number;
    totalBytes: number;
    sourceType: "builtin" | "markdown" | "zip" | "github" | string;
    sourceUrl: string;
    sourceRef: string;
    sourceSubdir: string;
    sourceCommit: string;
    syncStatus: "synced" | "failed" | "syncing" | string;
    syncError?: string;
    autoUpdate: boolean;
    lastCheckedAt?: string;
    lastSyncedAt?: string;
    status: number;
    markdownUrl: string;
    createdAt: string;
    updatedAt: string;
    source: number;
    tag: string;
    sortWeight: number;
    isPrivate: boolean;
    likeCount: number;
    isLike: boolean;
    ownerUid: string;
    effectiveUser: { name: string; avatarUrl: string; uid: string };
    originalSkillId: string | null;
    showcaseMedia: SkillShowcaseMedia[];
    addedCount: number;
    isTest: boolean;
    extraInfo: string;
    isAdded: boolean;
    isOwner: boolean;
};

export type SkillCategory = { value: string; label: string };

export type SkillList = {
    skills: Skill[];
    totalCount: number;
    hasMore: boolean;
    nextOffset: number;
    page: number;
    pageSize: number;
    categories: SkillCategory[];
};

export type ListSkillsInput = {
    page?: number;
    pageSize?: number;
    scope?: SkillScope;
    sort?: SkillSort;
    search?: string;
    tag?: string;
};

export type SkillMutationInput = {
    skillName: string;
    description: string;
    instruction?: string;
    tag: string;
    isPrivate: boolean;
    markdownUrl: string;
    showcaseMedia: SkillShowcaseMedia[];
    extraInfo: string;
};

export type SkillPackageFile = {
    path: string;
    kind: "markdown" | "code" | "text" | "image" | "video" | "audio" | "binary" | string;
    mimeType: string;
    size: number;
    sha256: string;
};

export type SkillPackageFileContent = {
    file: SkillPackageFile;
    content: string;
    binary: boolean;
};

export type SkillPackageBundle = {
    skillId: string;
    name: string;
    description: string;
    versionId: string;
    version: string;
    contentHash: string;
    files: Array<{ path: string; mimeType: string; contentBase64: string }>;
};

export type SkillFileSearchResult = { path: string; line: number; snippet: string };

export type InstallSkillUploadInput = {
    file: File;
    sourceType?: "markdown" | "zip";
    name?: string;
    description?: string;
    tag?: string;
    isPrivate?: boolean;
};

export type InstallGitHubSkillInput = {
    url: string;
    ref?: string;
    subdir?: string;
    tag?: string;
    isPrivate?: boolean;
    autoUpdate?: boolean;
};


export function listSkills(input: ListSkillsInput = {}) {
    const params = serializeApiParams(compactApiParams(input as ApiParams));
    return http.get<SkillList>(`/skills?${params.toString()}`);
}

export function getSkill(id: string) {
    return http.get<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`);
}

export function listAddedSkills() {
    const scope = getActiveUserScope();
    const now = Date.now();
    if (addedSkillsCache?.scope === scope && addedSkillsCache.expiresAt > now) return Promise.resolve(addedSkillsCache.value);
    if (addedSkillsRequest?.scope === scope) return addedSkillsRequest.promise;
    const promise = readAddedSkillsWithRetry()
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

async function readAddedSkillsWithRetry() {
    const retryDelays = [300, 900, 1800];
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await http.get<{ skills: Skill[] }>("/skills/added");
        } catch (cause) {
            if (!(cause instanceof ApiError) || !cause.retryable || attempt >= retryDelays.length) throw cause;
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, retryDelays[attempt]));
        }
    }
}

function invalidateAddedSkillsCache() {
    addedSkillsCache = null;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("canvas-skills-changed"));
}

export function createSkill(input: SkillMutationInput) {
    return http.post<{ skill: Skill }>("/skills", input).finally(invalidateAddedSkillsCache);
}

export function installSkillUpload(input: InstallSkillUploadInput) {
    const form = new FormData();
    form.append("file", input.file);
    if (input.sourceType) form.append("sourceType", input.sourceType);
    if (input.name) form.append("name", input.name);
    if (input.description) form.append("description", input.description);
    if (input.tag) form.append("tag", input.tag);
    form.append("isPrivate", String(Boolean(input.isPrivate)));
    return http.post<{ skill: Skill }>("/skills/install", form).finally(invalidateAddedSkillsCache);
}

export function installGitHubSkill(input: InstallGitHubSkillInput) {
    return http.post<{ skill: Skill }>("/skills/install/github", input).finally(invalidateAddedSkillsCache);
}

export function listSkillFiles(id: string) {
    return http.get<{ files: SkillPackageFile[] }>(`/skills/${encodeURIComponent(id)}/files`);
}

export function getSkillFile(id: string, path: string) {
    return http.get<{ file: SkillPackageFileContent }>(`/skills/${encodeURIComponent(id)}/file`, { params: { path } });
}

export function getSkillBundle(id: string) {
    return http.get<{ bundle: SkillPackageBundle }>(`/skills/${encodeURIComponent(id)}/bundle`);
}

export function searchSkillFiles(id: string, query: string) {
    return http.get<{ results: SkillFileSearchResult[] }>(`/skills/${encodeURIComponent(id)}/search`, { params: { q: query } });
}

export function syncSkill(id: string) {
    return http.post<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/sync`).finally(invalidateAddedSkillsCache);
}

export function skillFileRawURL(id: string, path: string) {
    const base = String(apiBaseURL).replace(/\/$/, "");
    return `${base}/skills/${encodeURIComponent(id)}/file/raw?path=${encodeURIComponent(path)}`;
}

export function updateSkill(id: string, input: SkillMutationInput) {
    return http.put<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`, input).finally(invalidateAddedSkillsCache);
}

export function deleteSkill(id: string) {
    return http.delete<{ deleted: boolean }>(`/skills/${encodeURIComponent(id)}`).finally(invalidateAddedSkillsCache);
}

export function addSkill(id: string) {
    return http.post<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/add`).finally(invalidateAddedSkillsCache);
}

export function removeSkill(id: string) {
    return http.delete<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/add`).finally(invalidateAddedSkillsCache);
}

export function likeSkill(id: string) {
    return http.post<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/like`);
}

export function unlikeSkill(id: string) {
    return http.delete<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/like`);
}
