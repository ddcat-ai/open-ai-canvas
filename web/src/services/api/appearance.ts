import { http } from "@/services/api/request";
import type { SkinDefinition } from "@/lib/skin-themes";

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
    authVideoAutoplay: boolean;
    skinId: string;
    activeSkin: SkinDefinition;
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    icpFilingEnabled: boolean;
    icpFilingNumber: string;
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
    authVideoAutoplay: boolean;
    skinId: string;
    skinThemes: SkinDefinition[];
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    icpFilingEnabled: boolean;
    icpFilingNumber: string;
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
    const result = await http.get<{ appearance: PublicAppearance }>("/public/appearance", { signal });
    return result.appearance;
}

export async function getAdminAppearance(signal?: AbortSignal) {
    const result = await http.get<{ setting: AdminAppearance }>("/admin/settings/appearance", { signal });
    return result.setting;
}

export async function updateAdminAppearance(
    input: Pick<
        AdminAppearance,
        | "brandName"
        | "brandSlug"
        | "authHeroTitle"
        | "authHeroDescription"
        | "logoResourceId"
        | "darkLogoResourceId"
        | "logoFrameEnabled"
        | "authVideoResourceId"
        | "authVideoPosterResourceId"
        | "authVideoAutoplay"
        | "skinId"
        | "skinThemes"
        | "seoTitle"
        | "seoDescription"
        | "seoKeywords"
        | "footerCopyright"
        | "icpFilingEnabled"
        | "icpFilingNumber"
    >,
) {
    const result = await http.patch<{ setting: AdminAppearance }>("/admin/settings/appearance", input);
    return result.setting;
}

export async function resetAdminAppearance() {
    const result = await http.delete<{ setting: AdminAppearance }>("/admin/settings/appearance");
    return result.setting;
}

export async function uploadAppearanceAsset(slot: AppearanceAssetSlot, file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ resource: AppearanceResource }>(`/admin/settings/appearance/assets/${slot}`, body);
    return result.resource;
}
