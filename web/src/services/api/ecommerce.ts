import { http } from "@/services/api/request";

export type EcommerceReferenceRole = "primary" | "detail" | "sku" | "style" | "logo" | "package" | "competitor" | "model";
export type EcommerceReference = { resourceId: string; role: EcommerceReferenceRole; name?: string; catalogId?: string; width?: number; height?: number };
export type EcommerceReferenceMode = "product" | "style" | "detail";
export type EcommerceReferenceScreen = {
    sourceResourceId: string;
    screenIndex: number;
    top: number;
    bottom: number;
    content: string;
    layout: string;
    visual: string;
    sourceCopy?: string;
    resourceId?: string;
};
export type EcommerceSku = { id: string; name: string; color: string; spec: string; packaging: string; claims: string; price: string; resourceId?: string; count: number };
export type EcommerceCreativeOptions = {
    textMode: "auto" | "rich" | "concise" | "none";
    copyTone: "professional" | "brand" | "lifestyle" | "technical" | "editorial" | "campaign";
    fontStyle: "auto" | "modern-sans" | "geometric" | "editorial-serif" | "rounded" | "display";
    colorRhythm: "unified" | "tonal" | "alternating" | "contrast" | "scene";
    informationDensity: "auto" | "airy" | "balanced" | "detailed";
    layoutStyle: "auto" | "editorial" | "feature-cards" | "immersive" | "minimal" | "comparison";
};
export const defaultEcommerceCreativeOptions: EcommerceCreativeOptions = {
    textMode: "auto",
    copyTone: "professional",
    fontStyle: "auto",
    colorRhythm: "unified",
    informationDensity: "balanced",
    layoutStyle: "auto",
};
export type EcommerceDraft = {
    productName: string;
    category: string;
    brand: string;
    description: string;
    claims: string;
    materials: string;
    colors: string;
    specifications: string;
    packaging: string;
    dimensions: string;
    audience: string;
    scene: string;
    pricePosition: string;
    lockedDetails: string;
    platform: string;
    region: string;
    imageType: string;
    count: number;
    language: string;
    noText: boolean;
    agentModel: string;
    imageModel: string;
    ratio: string;
    resolution: string;
    style: string;
    stylePrompt: string;
    fidelity: string;
    instruction: string;
    skillIds: string[];
    planningTaskId?: string;
    modelEnabled: boolean;
    primaryModelResourceId?: string;
    references: EcommerceReference[];
    layoutReferences?: EcommerceReference[];
    skus: EcommerceSku[];
    typeOptions?: Record<string, string>;
    creativeOptions?: EcommerceCreativeOptions;
    cloneOptions?: { copyMode: string; ratioMode: string };
    referenceMode?: EcommerceReferenceMode;
    directionsTaskId?: string;
    creativeRecommendationId?: string;
    creativeDirectionId?: string;
    layoutReferenceId?: string;
};
export type EcommercePlanImage = {
    id: string;
    imageType: string;
    platform: string;
    language: string;
    goal: string;
    theme: string;
    composition: string;
    displayAssignment?: string;
    mainVisual: string;
    verifiedClaims: string;
    performanceAngle?: string;
    informationComponent?: string;
    copy: string;
    lighting: string;
    fidelity: string;
    prompt: string;
    negativePrompt: string;
    imageModel: string;
    ratio: string;
    resolution: string;
    skuId?: string;
    taskId?: string;
    manualPrompt?: boolean;
    assetId?: string;
    resourceId?: string;
    deliveryStatus?: "pending" | "delivered";
    referenceScreen?: EcommerceReferenceScreen;
    sourceDraft?: EcommerceDraft;
};
export type EcommercePlan = {
    productSummary: string;
    confirmedFacts: string[];
    uncertainFacts: string[];
    visualStrategy: string;
    qualityChecks: string[];
    images: EcommercePlanImage[];
    inputSignature?: string;
    referenceSummary?: string;
    previousImages?: EcommercePlanImage[];
};
/** Reviewable execution details of a recommended style; absent on older recommendations. */
export type EcommerceDirectionVisual = {
    style: string;
    why: string;
    palette: string[];
    typography?: string;
    layout?: string;
    scene?: string;
    lighting?: string;
    camera?: string;
    props?: string;
    colorGrade?: string;
    benchmark?: string;
};
/** `group` is set on style library entries ("preset:<key>"); recommended directions have none. */
export type EcommerceCreativeDirection = { id: string; name: string; summary: string; tags: string[]; categoryFit?: string; visual?: EcommerceDirectionVisual; group?: string };
export type EcommerceKnowledgeEvidence = { title: string; knowledgeType: string; sourceUrl: string; license: string; trustLevel: string };
export type EcommerceCreativeDirectionsResponse = {
    recommendationId: string;
    directions: EcommerceCreativeDirection[];
    evidence: EcommerceKnowledgeEvidence[];
    retrievalStatus: "ready" | "degraded";
    productCategory: string;
    /** Ready-made styles grouped by `group`; absent on older recommendations. */
    styleLibrary?: EcommerceCreativeDirection[];
};
/** `direction` is the confirmed style as the server stored it (a preset or a typed style is expanded there). */
export type EcommerceCreativeDirectionSelection = { recommendationId: string; directionId: string; status: string; planningContext?: Record<string, unknown>; direction?: EcommerceCreativeDirection };
/** The user's own wording of the confirmed style; sent only when it differs from the stored one. */
export type EcommerceStyleRewrite = { name: string; description: string };
export type EcommerceProject = {
    id: string;
    name: string;
    status: string;
    revision: number;
    draftJson: string;
    planJson: string;
    createdAt: string;
    updatedAt: string;
};

export const emptyEcommerceDraft = (): EcommerceDraft => ({
    productName: "",
    category: "",
    brand: "",
    description: "",
    claims: "",
    materials: "",
    colors: "",
    specifications: "",
    packaging: "",
    dimensions: "",
    audience: "",
    scene: "",
    pricePosition: "",
    lockedDetails: "",
    platform: "taobao",
    region: "",
    imageType: "set",
    count: 1,
    language: "zh-CN",
    noText: false,
    agentModel: "",
    imageModel: "",
    ratio: "1:1",
    resolution: "1k",
    style: "commercial",
    fidelity: "standard",
    stylePrompt: "",
    instruction: "",
    skillIds: [],
    modelEnabled: false,
    references: [],
    layoutReferences: [],
    skus: [],
    creativeOptions: { ...defaultEcommerceCreativeOptions },
    referenceMode: "product",
});

/** Keep product identity separate from inspiration, including when reopening older projects. */
export function normalizeEcommerceReferenceGroups(draft: EcommerceDraft): EcommerceDraft {
    const references = Array.isArray(draft.references) ? draft.references : [];
    const isLayout = (reference: EcommerceReference) => reference.role === "style" || reference.role === "competitor";
    const layoutReferences = Array.isArray(draft.layoutReferences) ? draft.layoutReferences : references.filter(isLayout);
    return { ...draft, references: references.filter((reference) => !isLayout(reference)), layoutReferences: layoutReferences.filter(isLayout) };
}

export function projectDraft(project: EcommerceProject): EcommerceDraft {
    try {
        const saved = JSON.parse(project.draftJson);
        return { ...emptyEcommerceDraft(), ...normalizeEcommerceReferenceGroups(saved), creativeOptions: { ...defaultEcommerceCreativeOptions, ...saved.creativeOptions } };
    } catch {
        return emptyEcommerceDraft();
    }
}
export function projectPlan(project: EcommerceProject): EcommercePlan | null {
    try {
        const plan = JSON.parse(project.planJson) as EcommercePlan;
        return Array.isArray(plan.images) ? plan : null;
    } catch {
        return null;
    }
}
export function listEcommerceProjects() {
    return http.get<{ projects: EcommerceProject[] }>("/ecommerce/projects").then(({ projects }) => projects || []);
}
export function listEcommerceProjectPage(page: number, pageSize: 20 | 50 | 100) {
    return http.get<{ projects: EcommerceProject[]; total: number; page: number; pageSize: number }>(`/ecommerce/projects?page=${page}&pageSize=${pageSize}`);
}
export function deleteEcommerceProjects(request: { ids?: string[]; all?: boolean; expectedTotal: number }) {
    return http.deleteWithBody<{ deleted: number }>("/ecommerce/projects", request);
}
export function createEcommerceProject() {
    return http.post<EcommerceProject>("/ecommerce/projects", {});
}
export function getEcommerceProject(id: string) {
    return http.get<EcommerceProject>(`/ecommerce/projects/${encodeURIComponent(id)}`);
}
export function saveEcommerceProject(project: EcommerceProject, draft: EcommerceDraft, plan: EcommercePlan | null) {
    return http.put<EcommerceProject>(`/ecommerce/projects/${encodeURIComponent(project.id)}`, {
        revision: project.revision,
        name: draft.productName || project.name,
        draft,
        ...(plan ? { plan } : {}),
    });
}

export function getEcommerceSkillPrompt(skillIds: string[]) {
    return http.post<{ prompt: string }>("/ecommerce/skills/prompt", { skillIds }).then(({ prompt }) => prompt);
}

// The analysis model is chosen by the administrator; the server rejects a
// client-supplied model for this endpoint.
export function recommendEcommerceCreativeDirections(draft: EcommerceDraft, projectId: string) {
    return http.post<EcommerceCreativeDirectionsResponse>("/ecommerce/creative-directions", {
        projectId,
        productName: draft.productName,
        category: draft.category,
        description: draft.description,
        claims: draft.claims,
        materials: draft.materials,
        colors: draft.colors,
        specifications: draft.specifications,
        platform: draft.platform,
        region: draft.region,
        language: draft.language,
        imageType: draft.imageType,
        count: draft.count,
        instruction: draft.instruction,
        style: draft.style,
        stylePrompt: draft.stylePrompt,
        referenceMode: draft.referenceMode === "detail" ? "detail" : draft.layoutReferences?.length ? "style" : draft.referenceMode,
        materialPlan: draft.typeOptions?.materialPlan || "",
        referenceCount: draft.references.length,
    });
}

/** `directionId` is a recommended direction, a library style ("preset:<key>") or "custom". */
export function selectEcommerceCreativeDirection(recommendationId: string, directionId: string, rewrite?: EcommerceStyleRewrite) {
    return http.post<EcommerceCreativeDirectionSelection>(`/ecommerce/creative-directions/${encodeURIComponent(recommendationId)}/select`, { directionId, ...rewrite });
}
