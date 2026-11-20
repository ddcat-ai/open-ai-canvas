import { http } from "./request";

export type IndustryCategory = { id: string; parentId: string; rootId: string; name: string; nameEn: string; path: string; pathEn: string; depth: number; children: number; descendants: number };
export type IndustryCategoryMatch = { node: IndustryCategory; methodAncestorId: string; methodScope: "specific" | "inherited"; group: string; playbook: { scene: string; focus: string; typography: string; layout: string; story: string } };
export type IndustryCategoryPage = {
    nodes: IndustryCategoryMatch[];
    total: number;
    page: number;
    limit: number;
    lineage: IndustryCategory[] | null;
    coverage: { source: { version: string; url: string; nodes: number; roots: number; leaves: number; level2: number }; indexedNodes: number; industryMethods: number; specializedAncestors: number; coverageBoundary: string };
};

export const getIndustryCategories = (parentId: string, q: string, page: number) => http.get<IndustryCategoryPage>(`/admin/ecommerce/categories?${new URLSearchParams({ parentId, q, page: String(page), limit: "40" })}`);
