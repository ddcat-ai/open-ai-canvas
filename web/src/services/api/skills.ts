import { ApiError, http, apiBaseURL, compactApiParams, serializeApiParams, type ApiParams } from "@/services/api/request";
import { getActiveUserScope } from "@/lib/user-scope";
import { captureSkillLibraryAccess, hasSkillLibraryAccess, isSkillLibraryAccessCurrent } from "@/lib/skill-access";
import { useUserStore } from "@/stores/use-user-store";

let addedSkillsRequest: { scope: string; promise: Promise<{ skills: Skill[] }> } | null = null;
let addedSkillsCache: { scope: string; value: { skills: Skill[] }; expiresAt: number } | null = null;
let addedSkillsCacheVersion = 0;
let addedSkillsAbort: AbortController | null = null;

export async function withSkillLibraryAccess<T>(request: () => Promise<T>): Promise<T> {
    const access = captureSkillLibraryAccess();
    if (!access) throw new ApiError("技能库仅供管理员访问", { status: 403, reason: "admin_required", retryable: false });
    const result = await request();
    if (!isSkillLibraryAccessCurrent(access)) throw new DOMException("技能访问权限已变更", "AbortError");
    return result;
}

useUserStore.subscribe((state, previous) => {
    if (state.hydrated !== previous.hydrated || state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role) invalidateAddedSkillsCache();
});

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
    sourceType: "builtin" | "markdown" | "zip" | string;
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
    libraryCategoryId?: string;
    /** 已安装或自建技能的 Agent 使用方式：auto 可被 Agent 自动发现，manual 只在点名或固定时使用。 */
    agentMode?: SkillAgentMode;
};

export type SkillAgentMode = "auto" | "manual";

/** /skills/added 只返回运行时目录需要的引用字段，不携带编辑器和同步详情。 */
export type AddedSkillReference = Pick<Skill, "skillId" | "skillName" | "description" | "versionId" | "version" | "tag" | "isLike" | "isAdded" | "isOwner" | "libraryCategoryId" | "agentMode">;

/** 按行业推荐的内置技能（GET /skills/recommendations）。 */
export type SkillRecommendationItem = {
    skillId: string;
    skillName: string;
    description: string;
    tag: string;
    reason: string;
    isAdded: boolean;
};

export type SkillRecommendationIndustry = {
    industryId: string;
    name: string;
    description: string;
    icon: string;
    skills: SkillRecommendationItem[];
    installedCount: number;
};

export type SkillRecommendationList = {
    industries: SkillRecommendationIndustry[];
    /** 用户技能库里可用技能总数，前端据此决定是否主动展示推荐入口。 */
    installedTotal: number;
};

export type SkillRecommendationInstallResult = {
    industryId: string;
    installed: string[];
    skipped: string[];
};

export type SkillCategory = { value: string; label: string; count?: number };

export type SkillLibraryCategory = {
    id: string;
    name: string;
    scope: "personal" | "platform";
    count: number;
};

export type SkillLibraryCategoryList = {
    categories: SkillLibraryCategory[];
    totalCount: number;
    uncategorizedCount: number;
};

export type SkillLibraryCategoryMutationInput = {
    name: string;
    scope?: "personal" | "platform";
};

/**
 * 场景预设：平台只读目录（GET /skills/presets，随二进制内置）。
 * 内容是「一个起步场景 → 一组已上架技能 ID」，不含任何技能正文，也不占用用户配额。
 * 预设目录只读；选中技能作用于当前会话，缺失技能会持久安装到用户技能库。
 */
export type SkillPreset = {
    presetId: string;
    name: string;
    scene: string;
    skillIds: string[];
    rationale: string;
    source: string;
    evidence: string;
    upgrade: string;
};

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
    platformRootId?: string;
    platformCategoryId?: string;
    platformUncategorized?: boolean;
    page?: number;
    pageSize?: number;
    scope?: SkillScope;
    sort?: SkillSort;
    search?: string;
    tag?: string;
    libraryCategoryId?: string;
    libraryUncategorized?: boolean;
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
    return withSkillLibraryAccess(() => http.get<SkillList>(`/skills?${params.toString()}`));
}

export function listSkillLibraryCategories(scope: "mine" | "created" = "mine") {
    return withSkillLibraryAccess(() => http.get<SkillLibraryCategoryList>("/skills/library-categories", { params: { scope } }));
}

export function createSkillLibraryCategory(input: SkillLibraryCategoryMutationInput) {
    return withSkillLibraryAccess(() => http.post<{ category: SkillLibraryCategory }>("/skills/library-categories", input).finally(invalidateAddedSkillsCache));
}

export function deleteSkillLibraryCategory(id: string) {
    return withSkillLibraryAccess(() => http.delete<{ deleted: boolean }>(`/skills/library-categories/${encodeURIComponent(id)}`).finally(invalidateAddedSkillsCache));
}

export function setSkillLibraryCategory(skillId: string, categoryId: string) {
    return withSkillLibraryAccess(() => http.patch<{ skill: Skill }>(`/skills/${encodeURIComponent(skillId)}/library-category`, { categoryId }).finally(invalidateAddedSkillsCache));
}

export function getSkill(id: string) {
    return withSkillLibraryAccess(() => http.get<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`));
}

/** 管理员场景预设目录；普通创作不依赖技能接口。 */
export function listSkillPresets() {
    if (!hasSkillLibraryAccess()) return Promise.resolve({ presets: [] as SkillPreset[] });
    return withSkillLibraryAccess(() => http.get<{ presets: SkillPreset[] }>("/skills/presets"));
}

export function listAddedSkills() {
    if (!hasSkillLibraryAccess()) return Promise.resolve({ skills: [] as Skill[] });
    const scope = getActiveUserScope();
    const version = addedSkillsCacheVersion;
    const now = Date.now();
    if (addedSkillsCache?.scope === scope && addedSkillsCache.expiresAt > now) return Promise.resolve(addedSkillsCache.value);
    if (addedSkillsRequest?.scope === scope) return addedSkillsRequest.promise;
    const access = captureSkillLibraryAccess();
    const controller = new AbortController();
    addedSkillsAbort = controller;
    const promise = readAddedSkillsWithRetry(access, controller.signal)
        .then((value) => {
            if (version === addedSkillsCacheVersion && isSkillLibraryAccessCurrent(access)) addedSkillsCache = { scope, value, expiresAt: Date.now() + 15_000 };
            return value;
        })
        .finally(() => {
            if (addedSkillsRequest?.promise === promise) addedSkillsRequest = null;
        });
    addedSkillsRequest = { scope, promise };
    return promise;
}

async function readAddedSkillsWithRetry(access: ReturnType<typeof captureSkillLibraryAccess>, signal: AbortSignal) {
    const retryDelays = [300, 900, 1800];
    for (let attempt = 0; ; attempt += 1) {
        if (!isSkillLibraryAccessCurrent(access) || signal.aborted) return { skills: [] as Skill[] };
        try {
            const response = await http.get<{ skills: AddedSkillReference[] }>("/skills/added", { signal });
            if (!isSkillLibraryAccessCurrent(access)) return { skills: [] as Skill[] };
            return { skills: response.skills.map(normalizeAddedSkillReference) };
        } catch (cause) {
            if (!(cause instanceof ApiError) || !cause.retryable || attempt >= retryDelays.length) throw cause;
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, retryDelays[attempt]));
        }
    }
}

function normalizeAddedSkillReference(skill: AddedSkillReference): Skill {
    // 兼容旧后端/测试桩返回的最小关系对象；正式接口返回完整的轻量引用时
    // 才补齐宽 Skill 类型的展示默认值。
    if (!skill.skillName && !skill.versionId) return skill as unknown as Skill;
    return {
        skillId: skill.skillId,
        skillName: skill.skillName,
        description: skill.description,
        versionId: skill.versionId,
        version: skill.version,
        contentHash: "",
        fileCount: 0,
        totalBytes: 0,
        sourceType: "",
        sourceUrl: "",
        sourceRef: "",
        sourceSubdir: "",
        sourceCommit: "",
        syncStatus: "synced",
        autoUpdate: false,
        status: 1,
        markdownUrl: "",
        createdAt: "",
        updatedAt: "",
        source: 0,
        tag: skill.tag,
        sortWeight: 0,
        isPrivate: false,
        likeCount: 0,
        isLike: skill.isLike,
        ownerUid: "",
        effectiveUser: { name: "", avatarUrl: "", uid: "" },
        originalSkillId: null,
        showcaseMedia: [],
        addedCount: 0,
        isTest: false,
        extraInfo: "",
        isAdded: skill.isAdded,
        isOwner: skill.isOwner,
        libraryCategoryId: skill.libraryCategoryId || "",
        agentMode: skill.agentMode,
    };
}

/** 技能写入后清空已加入技能缓存并通知页面刷新；后台技能管理同样需要调用。 */
export function invalidateAddedSkillsCache() {
    addedSkillsAbort?.abort();
    addedSkillsAbort = null;
    addedSkillsCacheVersion += 1;
    addedSkillsCache = null;
    addedSkillsRequest = null;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("canvas-skills-changed"));
}

export function createSkill(input: SkillMutationInput) {
    return withSkillLibraryAccess(() => http.post<{ skill: Skill }>("/skills", input).finally(invalidateAddedSkillsCache));
}

export function installSkillUpload(input: InstallSkillUploadInput) {
    const form = new FormData();
    form.append("file", input.file);
    if (input.sourceType) form.append("sourceType", input.sourceType);
    if (input.name) form.append("name", input.name);
    if (input.description) form.append("description", input.description);
    if (input.tag) form.append("tag", input.tag);
    form.append("isPrivate", String(Boolean(input.isPrivate)));
    return withSkillLibraryAccess(() => http.post<{ skill: Skill }>("/skills/install", form).finally(invalidateAddedSkillsCache));
}

export function installGitHubSkill(input: InstallGitHubSkillInput) {
    return withSkillLibraryAccess(() => http.post<{ skill: Skill }>("/skills/install/github", input).finally(invalidateAddedSkillsCache));
}

export function listSkillFiles(id: string) {
    return withSkillLibraryAccess(() => http.get<{ files: SkillPackageFile[] }>(`/skills/${encodeURIComponent(id)}/files`));
}

export function getSkillFile(id: string, path: string) {
    return withSkillLibraryAccess(() => http.get<{ file: SkillPackageFileContent }>(`/skills/${encodeURIComponent(id)}/file`, { params: { path } }));
}

export function getSkillBundle(id: string) {
    return withSkillLibraryAccess(() => http.get<{ bundle: SkillPackageBundle }>(`/skills/${encodeURIComponent(id)}/bundle`));
}

export type SkillFileOperationInput = { op: "write"; path: string; content: string } | { op: "rename"; path: string; to: string } | { op: "delete"; path: string };

export type SaveSkillFilesInput = {
    /** 编辑开始时的 versionId；服务端版本已前进时返回 409 skill_version_conflict。 */
    baseVersionId: string;
    operations: SkillFileOperationInput[];
};

export type SaveSkillFilesResult = { skill: Skill; files: SkillPackageFile[]; changed: boolean };

export const SKILL_VERSION_CONFLICT_REASON = "skill_version_conflict";

/** 作者批量保存技能包文件：后端按顺序应用操作并原子生成新版本。 */
export function saveSkillFiles(id: string, input: SaveSkillFilesInput) {
    return withSkillLibraryAccess(() => http.put<SaveSkillFilesResult>(`/skills/${encodeURIComponent(id)}/files`, input).finally(invalidateAddedSkillsCache));
}

export function searchSkillFiles(id: string, query: string) {
    return withSkillLibraryAccess(() => http.get<{ results: SkillFileSearchResult[] }>(`/skills/${encodeURIComponent(id)}/search`, { params: { q: query } }));
}

export function syncSkill(id: string) {
    return withSkillLibraryAccess(() => http.post<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/sync`).finally(invalidateAddedSkillsCache));
}

export function skillFileRawURL(id: string, path: string) {
    if (!hasSkillLibraryAccess()) throw new ApiError("技能库仅供管理员访问", { status: 403, reason: "admin_required", retryable: false });
    const base = String(apiBaseURL).replace(/\/$/, "");
    return `${base}/skills/${encodeURIComponent(id)}/file/raw?path=${encodeURIComponent(path)}`;
}

export function updateSkill(id: string, input: SkillMutationInput) {
    return withSkillLibraryAccess(() => http.put<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`, input).finally(invalidateAddedSkillsCache));
}

export function deleteSkill(id: string) {
    return withSkillLibraryAccess(() => http.delete<{ deleted: boolean }>(`/skills/${encodeURIComponent(id)}`).finally(invalidateAddedSkillsCache));
}

export function addSkill(id: string) {
    return withSkillLibraryAccess(() => http.post<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/add`).finally(invalidateAddedSkillsCache));
}

export function removeSkill(id: string) {
    return withSkillLibraryAccess(() => http.delete<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/add`).finally(invalidateAddedSkillsCache));
}

export function likeSkill(id: string) {
    return withSkillLibraryAccess(() => http.post<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/like`));
}

export function unlikeSkill(id: string) {
    return withSkillLibraryAccess(() => http.delete<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/like`));
}

/** 设置已安装技能是否允许 Agent 自动发现。 */
export function setSkillAgentMode(id: string, mode: SkillAgentMode) {
    return withSkillLibraryAccess(() => http.patch<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/agent-mode`, { mode }).finally(invalidateAddedSkillsCache));
}

export function listSkillRecommendations(signal?: AbortSignal) {
    return withSkillLibraryAccess(() => http.get<SkillRecommendationList>("/skills/recommendations", { signal }));
}

/** 安装某个行业的推荐技能；skillIds 为空时安装该行业全部推荐。 */
export function installSkillRecommendations(industryId: string, skillIds: string[] = []) {
    return withSkillLibraryAccess(() => http.post<SkillRecommendationInstallResult>(`/skills/recommendations/${encodeURIComponent(industryId)}/install`, { skillIds }).finally(invalidateAddedSkillsCache));
}
