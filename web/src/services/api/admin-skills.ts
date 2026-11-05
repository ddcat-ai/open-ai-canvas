import { apiBaseURL, compactApiParams, http } from "@/services/api/request";
import { invalidateAddedSkillsCache, type SaveSkillFilesInput, type Skill, type SkillCategory, type SkillPackageFile, type SkillPackageFileContent, type SkillShowcaseMedia } from "@/services/api/skills";

/** 后台技能条目：在用户端 Skill 上增加上架状态、可否编辑内容和管理员修改时间。 */
export type AdminSkill = Skill & {
    enabled: boolean;
    /** GitHub 技能以仓库为准，后台只能浏览文件。 */
    contentEditable: boolean;
    adminInfoEditedAt?: string;
    adminContentEditedAt?: string;
};

export type AdminSkillStatusFilter = "" | "enabled" | "disabled";
export type AdminSkillSourceFilter = "" | "builtin" | "markdown" | "zip" | "github";

export type AdminSkillListParams = {
    keyword?: string;
    status?: AdminSkillStatusFilter;
    sourceType?: AdminSkillSourceFilter;
    tag?: string;
    page?: number;
    pageSize?: number;
};

export type AdminSkillList = {
    skills: AdminSkill[];
    total: number;
    page: number;
    pageSize: number;
    categories: SkillCategory[];
};

/** 后台可改的基本信息：正文走文件编辑，公开状态由作者决定。 */
export type AdminSkillInfoInput = {
    skillName: string;
    description: string;
    tag: string;
    markdownUrl: string;
    showcaseMedia: SkillShowcaseMedia[];
    extraInfo: string;
};

export type AdminSaveSkillFilesResult = { skill: AdminSkill; files: SkillPackageFile[]; changed: boolean };

function skillPath(id: string) {
    return `/admin/skills/${encodeURIComponent(id)}`;
}

export function listAdminSkills(params: AdminSkillListParams, signal?: AbortSignal) {
    return http.get<AdminSkillList>("/admin/skills", { params: compactApiParams(params), signal });
}

export function getAdminSkill(id: string) {
    return http.get<{ skill: AdminSkill }>(skillPath(id));
}

export function updateAdminSkillInfo(id: string, input: AdminSkillInfoInput) {
    return http.put<{ skill: AdminSkill }>(skillPath(id), input).finally(invalidateAddedSkillsCache);
}

export function setAdminSkillEnabled(id: string, enabled: boolean) {
    return http.patch<{ skill: AdminSkill }>(`${skillPath(id)}/status`, { enabled }).finally(invalidateAddedSkillsCache);
}

export function deleteAdminSkill(id: string) {
    return http.delete<{ deleted: boolean }>(skillPath(id)).finally(invalidateAddedSkillsCache);
}

export function listAdminSkillFiles(id: string) {
    return http.get<{ files: SkillPackageFile[] }>(`${skillPath(id)}/files`);
}

export function getAdminSkillFile(id: string, path: string) {
    return http.get<{ file: SkillPackageFileContent }>(`${skillPath(id)}/file`, { params: { path } });
}

export function saveAdminSkillFiles(id: string, input: SaveSkillFilesInput) {
    return http.put<AdminSaveSkillFilesResult>(`${skillPath(id)}/files`, input).finally(invalidateAddedSkillsCache);
}

export function adminSkillFileRawURL(id: string, path: string) {
    const base = String(apiBaseURL).replace(/\/$/, "");
    return `${base}${skillPath(id)}/file/raw?path=${encodeURIComponent(path)}`;
}
