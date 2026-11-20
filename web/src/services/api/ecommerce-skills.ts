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
    autoUpdate: boolean;
    lastCheckedAt: string;
    syncError: string;
};

export const listEcommerceManagedSkills = () => http.get<{ skills: EcommerceManagedSkill[] }>("/admin/ecommerce/skills");
export const installEcommerceSkillFile = (file: File, onProgress: (value: number) => void) => {
    const body = new FormData();
    body.append("file", file);
    return http.post("/admin/ecommerce/skills/install", body, { timeout: 30 * 60 * 1000, onUploadProgress: (event) => onProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 0) });
};
export const installEcommerceSkillGitHub = (url: string, subdir: string) => http.post("/admin/ecommerce/skills/install/github", { url, subdir }, { timeout: 20 * 60 * 1000 });
export const renameEcommerceSkill = (id: string, name: string) => http.patch(`/admin/ecommerce/skills/${encodeURIComponent(id)}/name`, { name });
export const setEcommerceManagedSkillEnabled = (id: string, enabled: boolean) => http.patch<{ enabled: boolean }>(`/admin/ecommerce/skills/${encodeURIComponent(id)}`, { enabled });
