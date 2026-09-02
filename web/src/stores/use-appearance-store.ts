import { create } from "zustand";

import type { PublicAppearance } from "@/services/api/appearance";

export const DEFAULT_PUBLIC_APPEARANCE: PublicAppearance = {
    schemaVersion: 3,
    brandName: "影策",
    brandSlug: "open-ai-canvas",
    authHeroTitle: "让一个故事，\n从文字走向银幕。",
    authHeroDescription: "",
    logoUrl: "/logo.svg",
    darkLogoUrl: "/logo.svg",
    logoFrameEnabled: true,
    authVideoUrl: "https://boss-shjd.biliapi.net/updream/aniforge/video/video_bbcb00bd-650d-4249-9346-5cd21fd2484c_m1hc-u0-1pu13x-3v1s.mp4",
    authVideoPosterUrl: "https://i0.hdslb.com/bfs/aitool/aniforge/image/02933f26-5f1b-49ff-a811-b7f95ee5e5b8_m1hc-u0-sau.jpg",
    skinId: "classic",
    logoConfigured: false,
    darkLogoConfigured: false,
    authVideoConfigured: false,
    authVideoPosterConfigured: false,
    configured: false,
    revision: "builtin",
};

type AppearanceStore = {
    appearance: PublicAppearance;
    resolved: boolean;
    setAppearance: (appearance: PublicAppearance) => void;
};

export const useAppearanceStore = create<AppearanceStore>((set) => ({
    appearance: DEFAULT_PUBLIC_APPEARANCE,
    resolved: false,
    setAppearance: (appearance) => set({ appearance, resolved: true }),
}));

export function normalizePublicAppearance(value?: Partial<PublicAppearance> | null): PublicAppearance {
    const brandName = String(value?.brandName || "").trim();
    const brandSlug = normalizeBrandSlug(value?.brandSlug);
    const authHeroTitle = normalizeAppearanceCopy(value?.authHeroTitle, DEFAULT_PUBLIC_APPEARANCE.authHeroTitle);
    const authHeroDescription = normalizeAppearanceCopy(value?.authHeroDescription, DEFAULT_PUBLIC_APPEARANCE.authHeroDescription, true);
    const customVideo = Boolean(value?.authVideoConfigured);
    const logoUrl = safeAppearanceURL(value?.logoUrl, DEFAULT_PUBLIC_APPEARANCE.logoUrl);
    const darkLogoUrl = safeAppearanceURL(value?.darkLogoUrl, logoUrl);
    return {
        ...DEFAULT_PUBLIC_APPEARANCE,
        ...value,
        schemaVersion: 3,
        brandName: brandName || DEFAULT_PUBLIC_APPEARANCE.brandName,
        brandSlug,
        authHeroTitle,
        authHeroDescription,
        logoUrl,
        darkLogoUrl,
        logoFrameEnabled: value?.logoFrameEnabled !== false,
        authVideoUrl: safeAppearanceURL(value?.authVideoUrl, DEFAULT_PUBLIC_APPEARANCE.authVideoUrl),
        authVideoPosterUrl: safeAppearanceURL(value?.authVideoPosterUrl, customVideo ? "" : DEFAULT_PUBLIC_APPEARANCE.authVideoPosterUrl),
        skinId: value?.skinId === "classic" ? value.skinId : DEFAULT_PUBLIC_APPEARANCE.skinId,
        logoConfigured: Boolean(value?.logoConfigured),
        darkLogoConfigured: Boolean(value?.darkLogoConfigured),
        authVideoConfigured: customVideo,
        authVideoPosterConfigured: Boolean(value?.authVideoPosterConfigured),
        configured: Boolean(value?.configured),
        revision: String(value?.revision || DEFAULT_PUBLIC_APPEARANCE.revision),
    };
}

function normalizeAppearanceCopy(value: unknown, fallback: string, allowEmpty = false) {
    if (typeof value !== "string") return fallback;
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    return normalized || (allowEmpty ? "" : fallback);
}

export function commitPublicAppearance(value?: Partial<PublicAppearance> | null) {
    const appearance = normalizePublicAppearance(value);
    useAppearanceStore.getState().setAppearance(appearance);
    applyAppearanceMetadata(appearance);
    return appearance;
}

export function applyAppearanceMetadata(appearance: PublicAppearance, targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document) {
    if (!targetDocument) return;
    targetDocument.title = appearance.brandName;
    const description = targetDocument.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = `${appearance.brandName}，面向 AI 影视与短剧创作的工作台。`;
    let favicon = targetDocument.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!favicon) {
        favicon = targetDocument.createElement("link");
        favicon.rel = "icon";
        targetDocument.head.appendChild(favicon);
    }
    favicon.href = appearanceLogoURL(appearance, targetDocument.documentElement.classList.contains("dark") ? "dark" : "light");
}

export function appearanceLogoURL(appearance: PublicAppearance, theme: "light" | "dark") {
    return theme === "dark" ? appearance.darkLogoUrl || appearance.logoUrl : appearance.logoUrl || appearance.darkLogoUrl;
}

export function brandStudioLabel(appearance: PublicAppearance) {
    if (appearance.brandName === DEFAULT_PUBLIC_APPEARANCE.brandName && appearance.brandSlug === DEFAULT_PUBLIC_APPEARANCE.brandSlug) return "YINGCE STUDIO";
    return appearance.brandSlug.replace(/-+/g, " ").toLocaleUpperCase();
}

function normalizeBrandSlug(value: unknown) {
    const candidate = String(value || "")
        .trim()
        .toLocaleLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(candidate) ? candidate : DEFAULT_PUBLIC_APPEARANCE.brandSlug;
}

function safeAppearanceURL(value: unknown, fallback: string) {
    const candidate = String(value || "").trim();
    if (!candidate) return fallback;
    if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
    try {
        const parsed = new URL(candidate);
        if (parsed.protocol === "https:") return parsed.toString();
    } catch {
        // Invalid or unsafe asset locations fall back to the bundled appearance.
    }
    return fallback;
}
