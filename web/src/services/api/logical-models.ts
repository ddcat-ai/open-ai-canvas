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
    routes: Array<{ channelModelId: string; enabled: boolean; priority: number; weight: number }>;
};

export type RouteSimulationResult = {
    productMatch: { matched: boolean; reasons?: string[] };
    candidates: Array<{ routeId: string; channelModelId: string; channelModelKey: string; channelModelName: string; priority: number; weight: number; enabled: boolean; matched: boolean; blocked: boolean; inPool: boolean; reasons?: string[] }>;
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

export function deleteAdminLogicalModel(id: string) {
    return request<{ ok: boolean }>(apiClient.delete(`/admin/logical-models/${encodeURIComponent(id)}`));
}

export function simulateAdminLogicalModel(id: string, intent: ModelRequestIntent) {
    return request<RouteSimulationResult>(apiClient.post(`/admin/logical-models/${encodeURIComponent(id)}/simulate`, intent));
}
