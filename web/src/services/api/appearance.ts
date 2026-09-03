import { apiClient, request } from "@/services/api/request";

export type PublicAppearance = {
    schemaVersion: number;
    brandName: string;
    brandSlug: string;
    authHeroTitle: string;
    authHeroDescription: string;
    logoUrl: string;
    darkLogoUrl: string;
    logoFrameEnabled: boolean;
    authVideoUrl: string;
    authVideoPosterUrl: string;
    skinId: string;
    logoConfigured: boolean;
    darkLogoConfigured: boolean;
    authVideoConfigured: boolean;
    authVideoPosterConfigured: boolean;
    configured: boolean;
    revision: string;
    updatedAt?: string;
};

export type AdminAppearance = {
    schemaVersion: number;
    brandName: string;
    brandSlug: string;
    authHeroTitle: string;
    authHeroDescription: string;
    logoResourceId: string;
    darkLogoResourceId: string;
    logoFrameEnabled: boolean;
    authVideoResourceId: string;
    authVideoPosterResourceId: string;
    skinId: string;
    public: PublicAppearance;
    configured: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type AppearanceAssetSlot = "logo" | "logo-dark" | "video" | "poster";

export type AppearanceResource = {
    id: string;
    kind: string;
    status: string;
    mimeType: string;
    size: number;
};

export async function getPublicAppearance(signal?: AbortSignal) {
    const result = await request<{ appearance: PublicAppearance }>(apiClient.get("/public/appearance", { signal }));
    return result.appearance;
}

export async function getAdminAppearance(signal?: AbortSignal) {
    const result = await request<{ setting: AdminAppearance }>(apiClient.get("/admin/settings/appearance", { signal }));
    return result.setting;
}

export async function updateAdminAppearance(
    input: Pick<AdminAppearance, "brandName" | "brandSlug" | "authHeroTitle" | "authHeroDescription" | "logoResourceId" | "darkLogoResourceId" | "logoFrameEnabled" | "authVideoResourceId" | "authVideoPosterResourceId" | "skinId">,
) {
    const result = await request<{ setting: AdminAppearance }>(apiClient.patch("/admin/settings/appearance", input));
    return result.setting;
}

export async function resetAdminAppearance() {
    const result = await request<{ setting: AdminAppearance }>(apiClient.delete("/admin/settings/appearance"));
    return result.setting;
}

export async function uploadAppearanceAsset(slot: AppearanceAssetSlot, file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await request<{ resource: AppearanceResource }>(apiClient.post(`/admin/settings/appearance/assets/${slot}`, body));
    return result.resource;
}
