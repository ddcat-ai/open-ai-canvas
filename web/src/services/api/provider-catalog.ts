import { http } from "@/services/api/request";
import type { ModelChannel } from "@/stores/use-config-store";

export type ProviderCatalogTag = { id: string; label: string; tone: string };

export type ProviderCatalogPriceTier = {
    selector?: Record<string, string>;
    billingMode: "fixed_request" | "per_second" | "token";
    costUnitMicrocredits: number;
    costInputMicrocredits: number;
    costOutputMicrocredits: number;
    costCachedMicrocredits: number;
    costReferenceVideoMicrocredits?: number;
};

export type ProviderCatalogModel = {
    modelKey: string;
    providerModelKey: string;
    displayName: string;
    capability: "text" | "image" | "video" | "audio";
    protocol: string;
    description?: string;
    icon?: string;
    supported: boolean;
    unsupportedReason?: string;
    priceTiers: ProviderCatalogPriceTier[];
};

export type ProviderCatalogProvider = {
    id: string;
    name: string;
    tags: string[];
    logo?: string;
    summary?: string;
    website?: string;
    startsAt: string;
    endsAt: string;
    permanent?: boolean;
    baseUrl: string;
    keyGuide: { url?: string; steps: string[]; keyPattern?: string; promo?: string };
    models: ProviderCatalogModel[];
    installedCount: number;
};

export type ProviderCatalogView = {
    source: "live" | "cache" | "unavailable" | "disabled";
    notice?: string;
    updatedAt?: string;
    fetchedAt?: string;
    tags: ProviderCatalogTag[];
    providers: ProviderCatalogProvider[];
};

export type ProviderCatalogVerifyResult = {
    upstreamModelCount: number;
    availableModels: string[];
    missingModels: string[];
};

export type ProviderCatalogInstallInput = {
    name: string;
    apiKey: string;
    markupPercent: number;
    models: Array<{ modelKey: string; markupPercent: number | null }>;
    enabled: boolean;
};

export function getProviderCatalog() {
    return http.get<ProviderCatalogView>("/admin/provider-catalog");
}

export function refreshProviderCatalog() {
    return http.post<ProviderCatalogView>("/admin/provider-catalog/refresh");
}

export function verifyProviderCatalogKey(providerId: string, apiKey: string) {
    return http.post<ProviderCatalogVerifyResult>(`/admin/provider-catalog/${encodeURIComponent(providerId)}/verify`, { apiKey });
}

export function installProviderCatalog(providerId: string, input: ProviderCatalogInstallInput) {
    return http.post<{ channel: ModelChannel }>(`/admin/provider-catalog/${encodeURIComponent(providerId)}/install`, input);
}
