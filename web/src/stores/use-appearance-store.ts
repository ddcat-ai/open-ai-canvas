import { create } from "zustand";

import type { PublicAppearance } from "@/services/api/appearance";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, normalizeSkinDefinition } from "@/lib/skin-themes";

export const DEFAULT_PUBLIC_APPEARANCE: PublicAppearance = {
    schemaVersion: 6,
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
    activeSkin: DEFAULT_CLASSIC_SKIN,
    seoTitle: "影策",
    seoDescription: "影策，面向 AI 影视与短剧创作的工作台。",
    seoKeywords: "",
    footerCopyright: `© ${new Date().getFullYear()} 影策. All rights reserved.`,
    icpFilingEnabled: false,
    icpFilingNumber: "",
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
    const resolvedBrandName = brandName || DEFAULT_PUBLIC_APPEARANCE.brandName;
    const seoTitle = normalizeAppearanceCopy(value?.seoTitle, resolvedBrandName);
    const seoDescription = normalizeAppearanceCopy(value?.seoDescription, `${resolvedBrandName}，面向 AI 影视与短剧创作的工作台。`, true);
    const seoKeywords = normalizeAppearanceCopy(value?.seoKeywords, "", true);
    const footerCopyright = normalizeAppearanceCopy(value?.footerCopyright, `© ${new Date().getFullYear()} ${resolvedBrandName}. All rights reserved.`);
    const icpFilingNumber = normalizeAppearanceCopy(value?.icpFilingNumber, "", true);
    return {
        ...DEFAULT_PUBLIC_APPEARANCE,
        ...value,
        schemaVersion: 6,
        brandName: resolvedBrandName,
        brandSlug,
        authHeroTitle,
        authHeroDescription,
        logoUrl,
        darkLogoUrl,
        logoFrameEnabled: value?.logoFrameEnabled !== false,
        authVideoUrl: safeAppearanceURL(value?.authVideoUrl, DEFAULT_PUBLIC_APPEARANCE.authVideoUrl),
        authVideoPosterUrl: safeAppearanceURL(value?.authVideoPosterUrl, customVideo ? "" : DEFAULT_PUBLIC_APPEARANCE.authVideoPosterUrl),
        skinId: normalizeSkinDefinition(value?.activeSkin).id,
        activeSkin: normalizeSkinDefinition(value?.activeSkin),
        seoTitle,
        seoDescription,
        seoKeywords,
        footerCopyright,
        icpFilingEnabled: Boolean(value?.icpFilingEnabled && icpFilingNumber),
        icpFilingNumber,
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
    applySkinTheme(appearance.activeSkin, typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light");
    applyAppearanceMetadata(appearance);
    return appearance;
}

export function applyAppearanceMetadata(appearance: PublicAppearance, targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document) {
    if (!targetDocument) return;
    targetDocument.title = appearance.seoTitle || appearance.brandName;
    setMeta(targetDocument, "name", "description", appearance.seoDescription);
    setMeta(targetDocument, "name", "keywords", appearance.seoKeywords);
    setMeta(targetDocument, "property", "og:title", appearance.seoTitle || appearance.brandName);
    setMeta(targetDocument, "property", "og:description", appearance.seoDescription);
    setMeta(targetDocument, "property", "og:site_name", appearance.brandName);
    setMeta(targetDocument, "property", "og:type", "website");
    setMeta(targetDocument, "name", "twitter:card", "summary");
    setMeta(targetDocument, "name", "twitter:title", appearance.seoTitle || appearance.brandName);
    setMeta(targetDocument, "name", "twitter:description", appearance.seoDescription);
    const mode = targetDocument.documentElement.classList.contains("dark") ? "dark" : "light";
    setMeta(targetDocument, "name", "theme-color", appearance.activeSkin.tokens[mode].canvas);
    let favicon = targetDocument.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!favicon) {
        favicon = targetDocument.createElement("link");
        favicon.rel = "icon";
        targetDocument.head.appendChild(favicon);
    }
    favicon.href = appearanceLogoURL(appearance, targetDocument.documentElement.classList.contains("dark") ? "dark" : "light");

    const location = targetDocument.defaultView?.location;
    if (location && (location.protocol === "http:" || location.protocol === "https:")) {
        let canonical = targetDocument.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!canonical) {
            canonical = targetDocument.createElement("link");
            canonical.rel = "canonical";
            targetDocument.head.appendChild(canonical);
        }
        canonical.href = `${location.origin}${location.pathname}`;
    }
}

function setMeta(targetDocument: Document, attribute: "name" | "property", key: string, content: string) {
    let element = targetDocument.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!content) {
        element?.remove();
        return;
    }
    if (!element) {
        element = targetDocument.createElement("meta");
        element.setAttribute(attribute, key);
        targetDocument.head.appendChild(element);
    }
    element.content = content;
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
