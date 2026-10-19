import { http } from "@/services/api/request";
import type { SkinDefinition } from "@/lib/skin-themes";
import type { AgentAvatarBundleManifest, CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { apiBaseURL } from "@/services/api/request";
import type { UpdateAnnouncement } from "@/lib/update-announcement";

export type PublicAppearance = {
    petCatalog?: PetAppearance[];
    updates?: UpdateAnnouncement;
    canvas?: CanvasAppearance;
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
    redeemPurchaseUrl: string;
    logoConfigured: boolean;
    darkLogoConfigured: boolean;
    authVideoConfigured: boolean;
    authVideoPosterConfigured: boolean;
    configured: boolean;
    revision: string;
    updatedAt?: string;
};

export type AdminAppearance = {
    petCatalog?: PetAppearance[];
    updates?: UpdateAnnouncement;
    canvas?: CanvasAppearance;
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
    redeemPurchaseUrl: string;
    public: PublicAppearance;
    configured: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type AppearanceAssetSlot = "logo" | "logo-dark" | "video" | "poster";
export type AppearanceAssetUploadSlot = AppearanceAssetSlot;

export type AppearanceResource = {
    id: string;
    kind: string;
    status: string;
    mimeType: string;
    size: number;
};

export type AgentAvatarBundleImport = {
    resourceId: string;
    manifest: AgentAvatarBundleManifest;
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
        | "canvas"
        | "petCatalog"
        | "updates"
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
        | "redeemPurchaseUrl"
    >,
) {
    const result = await http.patch<{ setting: AdminAppearance }>("/admin/settings/appearance", input);
    return result.setting;
}

export async function resetAdminAppearance() {
    const result = await http.delete<{ setting: AdminAppearance }>("/admin/settings/appearance");
    return result.setting;
}

export async function uploadAppearanceAsset(slot: AppearanceAssetUploadSlot | "update-image" | "update-video", file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ resource: AppearanceResource }>(`/admin/settings/appearance/assets/${slot}`, body);
    return result.resource;
}

export function appearanceAssetURL(slot: AppearanceAssetUploadSlot, revision = "") {
    const query = revision ? `?v=${encodeURIComponent(revision)}` : "";
    return `${apiBaseURL.replace(/\/$/, "")}/public/appearance/assets/${encodeURIComponent(slot)}${query}`;
}

export function updateAnnouncementPreviewURL(resourceId: string) {
    return `${apiBaseURL.replace(/\/$/, "")}/admin/settings/appearance/updates/${encodeURIComponent(resourceId)}`;
}

export async function uploadLive2D(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ model: { resourceId: string; entry: string } }>("/admin/settings/appearance/live2d", body);
    return result.model;
}

export async function uploadAgentAvatarBundle(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ bundle: AgentAvatarBundleImport }>("/admin/settings/appearance/avatar-bundles", body);
    return result.bundle;
}

export function agentAvatarBundleFileURL(resourceId: string, file: string, preview = false, revision = "") {
    const endpoint = preview ? "admin/settings" : "public";
    const query = !preview && revision ? `?v=${encodeURIComponent(revision)}` : "";
    return `${apiBaseURL.replace(/\/$/, "")}/${endpoint}/appearance/avatar/${encodeURIComponent(resourceId)}/${encodeURIComponent(file)}${query}`;
}

export async function uploadSpritePet(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ pet: { resourceId: string; config: import("@/lib/canvas/sprite-pet").SpritePet } }>("/admin/settings/appearance/sprite", body);
    return result.pet;
}

export function spriteImageURL(resourceId: string, preview = false) {
    return `${apiBaseURL.replace(/\/$/, "")}/${preview ? "admin/settings" : "public"}/appearance/sprite/${encodeURIComponent(resourceId)}`;
}

export function spriteThumbnailURL(resourceId: string, sprite: Pick<import("@/lib/canvas/sprite-pet").SpritePet, "frameWidth" | "frameHeight" | "neutralFrame">, preview = false) {
    return `${spriteImageURL(resourceId, preview)}/thumbnail?v=1&w=${sprite.frameWidth}&h=${sprite.frameHeight}&frame=${sprite.neutralFrame}`;
}

export function live2DModelURL(resourceId: string, entry: string, preview = false) {
    return `${apiBaseURL.replace(/\/$/, "")}/${preview ? "admin/settings" : "public"}/appearance/live2d/${encodeURIComponent(resourceId)}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}

export type PetAppearance = Pick<CanvasAppearance, "avatarType" | "avatarHeight" | "spriteResourceId" | "sprite" | "live2dResourceId" | "live2dEntry"> &
    Partial<Pick<CanvasAppearance, "avatarBundleResourceId" | "avatarClipStates">> & { id: string; name: string; published: boolean };
export type PetPreference = { modelId: string; scale: number; locked: boolean; hidden: boolean; revision: number };
export async function getPetPreference(signal?: AbortSignal) {
    return (await http.get<{ preference: PetPreference }>("/me/pet-preference", { signal })).preference;
}
export async function savePetPreference(preference: PetPreference) {
    return (await http.put<{ preference: PetPreference }>("/me/pet-preference", preference)).preference;
}
