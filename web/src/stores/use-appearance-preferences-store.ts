import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { AGENT_AVATAR_STATES, DEFAULT_CANVAS_APPEARANCE, type AgentAvatarState, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { DEFAULT_CLASSIC_SKIN } from "@/lib/skin-themes";
import { themePackFor } from "@/themes/registry";
import { useAppearanceStore } from "./use-appearance-store";
import { useUserStore } from "./use-user-store";

export type PersonalAssistantAvatar = {
    type: "bundle" | "live2d";
    resourceId: string;
    entry?: string;
    clipStates?: Partial<Record<AgentAvatarState, string>>;
};
export type PersonalAppearancePreferences = { skinId: string; avatar: "site" | "classic" | "orb" | "custom"; customAvatar?: PersonalAssistantAvatar };
const DEFAULT_PREFERENCES: PersonalAppearancePreferences = { skinId: "", avatar: "site" };

type AppearancePreferencesStore = {
    byUser: Record<string, PersonalAppearancePreferences>;
    update: (userId: string, patch: Partial<PersonalAppearancePreferences>) => void;
};

export function personalSkin(skinId: string) {
    return skinId === DEFAULT_CLASSIC_SKIN.id ? DEFAULT_CLASSIC_SKIN : themePackFor(skinId)?.skin;
}

function normalizeCustomAvatar(value: unknown): PersonalAssistantAvatar | undefined {
    if (!value || typeof value !== "object") return undefined;
    const avatar = value as PersonalAssistantAvatar;
    if (typeof avatar.resourceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(avatar.resourceId)) return undefined;
    if (avatar.type === "live2d") {
        const entry = avatar.entry;
        if (typeof entry !== "string" || entry.length > 240 || !entry.endsWith(".model3.json") || entry.split("/").some((part) => !part || part === "." || part === "..") || /[\\:%?#\u0000-\u001f]/.test(entry)) return undefined;
        return { type: "live2d", resourceId: avatar.resourceId, entry };
    }
    if (avatar.type !== "bundle") return undefined;
    const clips = avatar.clipStates;
    if (clips && (typeof clips !== "object" || Object.entries(clips).some(([state, clip]) => !AGENT_AVATAR_STATES.some(({ id }) => id === state) || typeof clip !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(clip)))) return undefined;
    return { type: "bundle", resourceId: avatar.resourceId, ...(clips ? { clipStates: { ...clips } } : {}) };
}

function normalizePreferences(value: unknown): PersonalAppearancePreferences {
    const candidate = value && typeof value === "object" ? (value as Partial<PersonalAppearancePreferences>) : {};
    const customAvatar = normalizeCustomAvatar(candidate.customAvatar);
    return {
        skinId: typeof candidate.skinId === "string" && candidate.skinId.length <= 128 ? candidate.skinId : "",
        avatar: candidate.avatar === "custom" && customAvatar ? "custom" : candidate.avatar === "classic" || candidate.avatar === "orb" ? candidate.avatar : "site",
        ...(customAvatar ? { customAvatar } : {}),
    };
}

export const useAppearancePreferencesStore = create<AppearancePreferencesStore>()(
    persist(
        (set) => ({
            byUser: {},
            update: (userId, patch) => {
                if (!userId) throw new Error("An account is required to save appearance preferences");
                if (patch.skinId && !personalSkin(patch.skinId)) throw new Error("Unknown theme");
                if (patch.avatar && !["site", "classic", "orb", "custom"].includes(patch.avatar)) throw new Error("Unknown assistant appearance");
                if (patch.customAvatar && !normalizeCustomAvatar(patch.customAvatar)) throw new Error("Invalid assistant appearance");
                set((state) => {
                    const next = { ...state.byUser[userId], ...patch };
                    if (next.avatar === "custom" && !normalizeCustomAvatar(next.customAvatar)) throw new Error("Upload an assistant appearance first");
                    return { byUser: { ...state.byUser, [userId]: normalizePreferences(next) } };
                });
            },
        }),
        {
            name: "canvas:personal-appearance",
            partialize: (state) => ({ byUser: state.byUser }),
            merge: (persisted, current) => {
                const saved = persisted && typeof persisted === "object" ? (persisted as Partial<AppearancePreferencesStore>).byUser : undefined;
                const byUser = saved && typeof saved === "object" && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved).map(([id, preferences]) => [id, normalizePreferences(preferences)])) : {};
                return { ...current, byUser };
            },
        },
    ),
);

export function usePersonalAppearancePreferences() {
    const userId = useUserStore((state) => state.user?.id);
    return useAppearancePreferencesStore((state) => (userId && Object.hasOwn(state.byUser, userId) ? state.byUser[userId] : DEFAULT_PREFERENCES));
}

export function useEffectiveSkin() {
    const siteSkin = useAppearanceStore((state) => state.appearance.activeSkin);
    const preferences = usePersonalAppearancePreferences();
    return personalSkin(preferences.skinId) ?? siteSkin;
}

export function resolvePersonalCanvasAppearance(site: CanvasAppearance, avatar: PersonalAppearancePreferences["avatar"], custom?: PersonalAssistantAvatar): CanvasAppearance {
    if (avatar === "site") return site;
    if (avatar === "custom") {
        const uploaded = normalizeCustomAvatar(custom);
        if (!uploaded) return site;
        return {
            ...site,
            avatarAssetScope: "personal",
            avatarType: uploaded.type,
            avatarBundleResourceId: uploaded.type === "bundle" ? uploaded.resourceId : "",
            avatarClipStates: uploaded.clipStates,
            live2dResourceId: uploaded.type === "live2d" ? uploaded.resourceId : "",
            live2dEntry: uploaded.entry ?? "",
        };
    }
    if (avatar === "orb") return { ...site, avatarType: "orb" };
    return { ...site, avatarType: "bundle", avatarBundleResourceId: "", avatarClipStates: DEFAULT_CANVAS_APPEARANCE.avatarClipStates };
}

export function useEffectiveCanvasAppearance() {
    const site = useAppearanceStore((state) => state.appearance.canvas) ?? DEFAULT_CANVAS_APPEARANCE;
    const { avatar, customAvatar } = usePersonalAppearancePreferences();
    return useMemo(() => resolvePersonalCanvasAppearance(site, avatar, customAvatar), [site, avatar, customAvatar]);
}
