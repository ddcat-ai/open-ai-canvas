import { http } from "./request";

export type CurationCategory = { id: string; rootTag: string; name: string; sortOrder: number; enabled: boolean };
export type CurationRoot = { id: string; name: string; iconKey: string; sortOrder: number; enabled: boolean };
export type SkillCuration = { enabled: boolean; revision: number; categories: CurationCategory[]; assignments: { skillId: string; categoryId: string }[]; roots?: CurationRoot[]; rootAssignments?: { skillId: string; rootId: string }[] };
export type CurationChange = { enabled: boolean } | { category: CurationCategory } | { root: CurationRoot } | { assignment: { skillId: string; categoryIds: string[]; rootId?: string } };
export function getSkillCuration(admin = false) { return http.get<SkillCuration>(admin ? "/admin/skill-curation" : "/skills/curation"); }
export function updateSkillCuration(expectedRevision: number, change: CurationChange) {
    return http.put<SkillCuration>("/admin/skill-curation", { expectedRevision, ...change });
}
