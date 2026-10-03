import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { scopedLocalStorage } from "@/lib/user-scope";
import type { AgentOutputPreference } from "@/services/api/agent";
import type { AiConfig } from "./use-config-store";

export type CreationModePreference = "text" | "image" | "video";

export type CreationImagePreferences = {
    ratio?: string;
    quality?: string;
    count?: string;
};

export type CreationVideoPreferences = {
    ratio?: string;
    seconds?: string;
    videoQuality?: string;
};

export type CreationComposerPreferences = {
    mode?: CreationModePreference;
    outputPreference?: AgentOutputPreference;
    image?: CreationImagePreferences;
    video?: CreationVideoPreferences;
    models?: Partial<Pick<AiConfig, "textModel" | "imageModel" | "videoModel">>;
    activeConversationId?: string;
};

type CreationPreferencesStore = {
    hydrated: boolean;
    preferences: CreationComposerPreferences;
    rememberMode: (mode: CreationModePreference) => void;
    rememberOutputPreference: (preference: AgentOutputPreference) => void;
    rememberImageSettings: (settings: CreationImagePreferences) => void;
    rememberVideoSettings: (settings: CreationVideoPreferences) => void;
    rememberModel: (key: "textModel" | "imageModel" | "videoModel", value: string) => void;
    rememberActiveConversation: (id: string) => void;
};

export const CREATION_PREFERENCES_STORE_KEY = "open_ai_canvas:creation_preferences";

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function normalizeImagePreferences(value: unknown): CreationImagePreferences | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const preferences = {
        ...(nonEmptyString(raw.ratio) ? { ratio: raw.ratio } : {}),
        ...(nonEmptyString(raw.quality) ? { quality: raw.quality } : {}),
        ...(nonEmptyString(raw.count) ? { count: raw.count } : {}),
    };
    return Object.keys(preferences).length ? preferences : undefined;
}

function normalizeVideoPreferences(value: unknown): CreationVideoPreferences | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const preferences = {
        ...(nonEmptyString(raw.ratio) ? { ratio: raw.ratio } : {}),
        ...(nonEmptyString(raw.seconds) ? { seconds: raw.seconds } : {}),
        ...(nonEmptyString(raw.videoQuality) ? { videoQuality: raw.videoQuality } : {}),
    };
    return Object.keys(preferences).length ? preferences : undefined;
}

export function normalizeCreationComposerPreferences(value: unknown): CreationComposerPreferences {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const image = normalizeImagePreferences(raw.image);
    const video = normalizeVideoPreferences(raw.video);
    const models = raw.models && typeof raw.models === "object" && !Array.isArray(raw.models)
        ? Object.fromEntries(Object.entries(raw.models).filter(([key, value]) => ["textModel", "imageModel", "videoModel"].includes(key) && nonEmptyString(value)))
        : undefined;
    return {
        ...(raw.mode === "text" || raw.mode === "image" || raw.mode === "video" ? { mode: raw.mode } : {}),
        ...(raw.outputPreference === "concise" || raw.outputPreference === "detailed" ? { outputPreference: raw.outputPreference } : {}),
        ...(image ? { image } : {}),
        ...(video ? { video } : {}),
        ...(models && Object.keys(models).length ? { models } : {}),
        ...(nonEmptyString(raw.activeConversationId) ? { activeConversationId: raw.activeConversationId } : {}),
    };
}

export function creationConfigWithPreferences(config: AiConfig, preferences: CreationComposerPreferences): AiConfig {
    return { ...config, ...preferences.models };
}

export const useCreationPreferencesStore = create<CreationPreferencesStore>()(
    persist(
        (set) => ({
            hydrated: false,
            preferences: {},
            rememberMode: (mode) => set((state) => ({ preferences: { ...state.preferences, mode } })),
            rememberOutputPreference: (outputPreference) => set((state) => ({ preferences: { ...state.preferences, outputPreference } })),
            rememberImageSettings: (settings) => set((state) => ({ preferences: { ...state.preferences, image: { ...state.preferences.image, ...settings } } })),
            rememberVideoSettings: (settings) => set((state) => ({ preferences: { ...state.preferences, video: { ...state.preferences.video, ...settings } } })),
            rememberModel: (key, value) => set((state) => ({ preferences: { ...state.preferences, models: { ...state.preferences.models, [key]: value } } })),
            rememberActiveConversation: (activeConversationId) => set((state) => ({ preferences: { ...state.preferences, activeConversationId } })),
        }),
        {
            name: CREATION_PREFERENCES_STORE_KEY,
            storage: createJSONStorage(() => scopedLocalStorage),
            partialize: (state) => ({ preferences: state.preferences }),
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<CreationPreferencesStore>;
                return { ...current, preferences: normalizeCreationComposerPreferences(stored.preferences) };
            },
            onRehydrateStorage: () => () => {
                useCreationPreferencesStore.setState({ hydrated: true });
            },
        },
    ),
);
