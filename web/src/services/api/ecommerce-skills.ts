import { http } from "./request";

export type EcommerceManagedSkill = {
    id: string;
    name: string;
    description: string;
    group: string;
    version: string;
    domain: string;
    sourceUrl: string;
    sourceCommit: string;
    license: string;
    origin: string;
    terms: string[];
    types: string[];
    categories: string[];
    platforms: string[];
    enabled: boolean;
    instructions: string;
    contentHash: string;
};

export const listEcommerceManagedSkills = () => http.get<{ skills: EcommerceManagedSkill[] }>("/admin/ecommerce/skills");
export const setEcommerceManagedSkillEnabled = (id: string, enabled: boolean) => http.patch<{ enabled: boolean }>(`/admin/ecommerce/skills/${encodeURIComponent(id)}`, { enabled });
