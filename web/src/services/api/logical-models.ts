import { apiClient, request } from "@/services/api/request";

export type InputConstraint = { min: number; max: number };
export type OptionConstraint = { values?: unknown[]; min?: number; max?: number; step?: number };
export type CapabilitySpec = {
    version: 1;
    capability: "text" | "image" | "video" | "audio";
    operations?: string[];
    inputs?: Record<string, InputConstraint>;
    options?: Record<string, OptionConstraint>;
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
    capabilitySpec: CapabilitySpec;
    capabilityProfiles: CapabilitySpec[];
    defaultOptions: Record<string, unknown>;
    available: boolean;
};

export type AdminLogicalRoute = {
    id: string;
    physicalVariantId: string;
    physicalVariantName: string;
    channelModelId: string;
    channelId: string;
    physicalModelKey: string;
    physicalModelName: string;
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

export type AdminPhysicalVariant = {
    id: string;
    channelModelId: string;
    channelId: string;
    modelKey: string;
    modelName: string;
    name: string;
    capability: CapabilitySpec["capability"];
    protocol: string;
    enabled: boolean;
    modelEnabled: boolean;
    usageCount: number;
    capabilitySpec: CapabilitySpec;
};

export type PhysicalVariantMutation = {
    channelModelId: string;
    name: string;
    enabled: boolean;
    /** 能力范围由渠道模型能力参数自动生成；保留可选字段兼容旧调用方。 */
    capabilitySpec?: CapabilitySpec;
};

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
    capabilitySpec: CapabilitySpec;
    defaultOptions: Record<string, unknown>;
    routes: Array<{ physicalVariantId: string; enabled: boolean; priority: number; weight: number }>;
};

export type RouteSimulationResult = {
    productMatch: { matched: boolean; reasons?: string[] };
    candidates: Array<{ routeId: string; variantId: string; channelModelId: string; priority: number; weight: number; enabled: boolean; matched: boolean; blocked: boolean; inPool: boolean; reasons?: string[] }>;
};

export function listLogicalModels() {
    return request<{ models: PublicLogicalModel[] }>(apiClient.get("/models"));
}

export function listAvailableLogicalModels(intent: ModelRequestIntent) {
    return request<{ models: PublicLogicalModel[] }>(apiClient.post("/models/available", intent));
}

export function listAdminLogicalModels() {
    return request<{ models: AdminLogicalModel[] }>(apiClient.get("/admin/logical-models"));
}

export function createAdminLogicalModel(input: LogicalModelMutation) {
    return request<{ model: AdminLogicalModel }>(apiClient.post("/admin/logical-models", input));
}

export function updateAdminLogicalModel(id: string, input: LogicalModelMutation) {
    return request<{ model: AdminLogicalModel }>(apiClient.patch(`/admin/logical-models/${encodeURIComponent(id)}`, input));
}

export function listAdminPhysicalVariants(channelModelId?: string) {
    return request<{ variants: AdminPhysicalVariant[] }>(apiClient.get("/admin/logical-models/physical-variants", { params: channelModelId ? { channelModelId } : undefined }));
}

export function createAdminPhysicalVariant(input: PhysicalVariantMutation) {
    return request<{ variant: AdminPhysicalVariant }>(apiClient.post("/admin/logical-models/physical-variants", input));
}

export function updateAdminPhysicalVariant(id: string, input: PhysicalVariantMutation) {
    return request<{ variant: AdminPhysicalVariant }>(apiClient.patch(`/admin/logical-models/physical-variants/${encodeURIComponent(id)}`, input));
}

export function simulateAdminLogicalModel(id: string, intent: ModelRequestIntent) {
    return request<RouteSimulationResult>(apiClient.post(`/admin/logical-models/${encodeURIComponent(id)}/simulate`, intent));
}
