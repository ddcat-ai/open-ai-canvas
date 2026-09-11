import { http } from "@/services/api/request";

export type InputConstraint = { min: number; max: number };
export type OptionConstraint = { values?: unknown[]; min?: number; max?: number; step?: number };
export type CapabilityImageSizePreset = {
    size: string;
    tier: "1k" | "2k" | "4k";
    ratio: string;
    width: number;
    height: number;
};
export type CapabilityImageSize = {
    parameter?: "size" | "aspect_ratio";
    allowCustom?: boolean;
    presets?: CapabilityImageSizePreset[];
};
export type CapabilitySpec = {
    version: 1;
    capability: "text" | "image" | "video" | "audio";
    operations?: string[];
    inputs?: Record<string, InputConstraint>;
    options?: Record<string, OptionConstraint>;
    imageSize?: CapabilityImageSize;
};

export type ModelRequestIntent = {
    capability: CapabilitySpec["capability"];
    operation?: string;
    inputs?: Record<string, number>;
    options?: Record<string, unknown>;
};

export type PublicLogicalModel = {
    id: string;
    code: string;
    name: string;
    icon?: string;
    description: string;
    capability: CapabilitySpec["capability"];
    sortOrder: number;
    pricePolicy: "channel" | "unified";
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    inputPriceMicrocredits: number;
    outputPriceMicrocredits: number;
    cachedPriceMicrocredits: number;
    priceTiers: PublicLogicalModelPriceTier[];
    legacyModelIds: string[];
    capabilitySpec: CapabilitySpec;
    capabilityProfiles: CapabilitySpec[];
    defaultOptions: Record<string, unknown>;
    available: boolean;
};

export type PublicLogicalModelPriceTier = {
    selector: Record<string, string>;
    resolution: string;
    videoSeconds: number;
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
};

export type AdminLogicalRoute = {
    id: string;
    channelModelId: string;
    channelId: string;
    channelModelKey: string;
    channelModelName: string;
    enabled: boolean;
    priority: number;
    weight: number;
    available: boolean;
    capabilitySpec: CapabilitySpec;
};

export type AdminLogicalModel = PublicLogicalModel & {
    enabled: boolean;
    activeRevisionId: string;
    revisionVersion: number;
    configurationError?: string;
    availabilityError?: string;
    routes: AdminLogicalRoute[];
};

/**
 * Keep admin model responses usable when a server is upgraded before its
 * existing process or historical response shape has caught up with the
 * current contract. Collection fields must always be arrays for the page.
 */
export function normalizeAdminLogicalModel(model: AdminLogicalModel): AdminLogicalModel {
    return {
        ...model,
        priceTiers: Array.isArray(model.priceTiers) ? model.priceTiers : [],
        legacyModelIds: Array.isArray(model.legacyModelIds) ? model.legacyModelIds : [],
        capabilityProfiles: Array.isArray(model.capabilityProfiles) ? model.capabilityProfiles : [],
        defaultOptions: model.defaultOptions && typeof model.defaultOptions === "object" ? model.defaultOptions : {},
        routes: Array.isArray(model.routes) ? model.routes : [],
    };
}

export type LogicalModelMutation = {
    code: string;
    name: string;
    icon: string;
    description: string;
    capability: CapabilitySpec["capability"];
    enabled: boolean;
    sortOrder: number;
    pricePolicy: PublicLogicalModel["pricePolicy"];
    billingMode: PublicLogicalModel["billingMode"];
    unitPriceMicrocredits: number;
    inputPriceMicrocredits: number;
    outputPriceMicrocredits: number;
    cachedPriceMicrocredits: number;
    legacyModelIds?: string[];
    capabilitySpec: CapabilitySpec;
    defaultOptions: Record<string, unknown>;
    routes: Array<{ channelModelId: string; enabled: boolean; priority: number; weight: number }>;
};

export type RouteSimulationResult = {
    productMatch: { matched: boolean; reasons?: string[] };
    candidates: Array<{ routeId: string; channelModelId: string; channelModelKey: string; channelModelName: string; priority: number; weight: number; enabled: boolean; matched: boolean; blocked: boolean; inPool: boolean; reasons?: string[] }>;
};

export type LogicalModelQuote = {
    logicalModelId: string;
    billingMode: PublicLogicalModel["billingMode"];
    quantity: number;
    amountMicrocredits: number;
    estimated: boolean;
};

export type ModelCatalogSource = "frontend" | "system";

export type PublicChannelCatalog = {
    id: string;
    name: string;
    displayName: string;
    sortOrder?: number;
    models: PublicChannelModel[];
};

export type PublicChannelModel = {
    id: string;
    modelKey: string;
    displayName: string;
    sortOrder?: number;
    icon: string;
    capability: string;
    protocol?: string;
    capabilityConfig?: Record<string, any>;
    priceTiers: PublicChannelModelPriceTier[];
    pricingMode: string;
    displayPrice?: number;
    priceLabel: string;
    available: boolean;
};

export type PublicChannelModelPriceTier = {
    id: string;
    selector?: Record<string, string>;
    resolution: string;
    videoSeconds: number;
    billingMode: string;
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
};

export type ModelCatalogResponse = {
    source: ModelCatalogSource;
    models?: PublicLogicalModel[];
    channels?: PublicChannelCatalog[];
};

// 统一模型目录接口 - 根据 frontendModelsEnabled 开关返回前台模型或系统渠道模型
export function getModelCatalog() {
    return http.get<ModelCatalogResponse>("/model-catalog");
}

export function quoteLogicalModel(id: string, intent: ModelRequestIntent, signal?: AbortSignal) {
    return http.post<{ quote: LogicalModelQuote }>(`/models/${encodeURIComponent(id)}/quote`, intent, { signal });
}

export function listAdminLogicalModels() {
    return http.get<{ models?: AdminLogicalModel[] }>("/admin/logical-models").then((result) => ({
        models: Array.isArray(result?.models) ? result.models.filter(Boolean).map(normalizeAdminLogicalModel) : [],
    }));
}

export function createAdminLogicalModel(input: LogicalModelMutation) {
    return http.post<{ model: AdminLogicalModel }>("/admin/logical-models", input);
}

export function updateAdminLogicalModel(id: string, input: LogicalModelMutation) {
    return http.patch<{ model: AdminLogicalModel }>(`/admin/logical-models/${encodeURIComponent(id)}`, input);
}

export function deleteAdminLogicalModel(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/logical-models/${encodeURIComponent(id)}`);
}

export function simulateAdminLogicalModel(id: string, intent: ModelRequestIntent) {
    return http.post<RouteSimulationResult>(`/admin/logical-models/${encodeURIComponent(id)}/simulate`, intent);
}
