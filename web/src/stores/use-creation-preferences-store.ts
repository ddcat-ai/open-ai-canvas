import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DreaminaVideoMode } from "@/lib/dreamina-video-modes";
import { scopedLocalStorage } from "@/lib/user-scope";

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
    dreaminaMode?: DreaminaVideoMode;
};

export type CreationComposerPreferences = {
    mode?: CreationModePreference;
    image?: CreationImagePreferences;
    video?: CreationVideoPreferences;
};

type CreationPreferencesStore = {
    hydrated: boolean;
    preferences: CreationComposerPreferences;
    rememberMode: (mode: CreationModePreference) => void;
    rememberImageSettings: (settings: CreationImagePreferences) => void;
    rememberVideoSettings: (settings: CreationVideoPreferences) => void;
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
    const dreaminaMode: DreaminaVideoMode | undefined = raw.dreaminaMode === "all_reference" || raw.dreaminaMode === "first_last_frames" || raw.dreaminaMode === "smart_multi_frame" ? raw.dreaminaMode : undefined;
    const preferences: CreationVideoPreferences = {
        ...(nonEmptyString(raw.ratio) ? { ratio: raw.ratio } : {}),
        ...(nonEmptyString(raw.seconds) ? { seconds: raw.seconds } : {}),
        ...(nonEmptyString(raw.videoQuality) ? { videoQuality: raw.videoQuality } : {}),
        ...(dreaminaMode ? { dreaminaMode } : {}),
    };
    return Object.keys(preferences).length ? preferences : undefined;
}

export function normalizeCreationComposerPreferences(value: unknown): CreationComposerPreferences {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const image = normalizeImagePreferences(raw.image);
    const video = normalizeVideoPreferences(raw.video);
    return {
        ...(raw.mode === "text" || raw.mode === "image" || raw.mode === "video" ? { mode: raw.mode } : {}),
        ...(image ? { image } : {}),
        ...(video ? { video } : {}),
    };
}

export const useCreationPreferencesStore = create<CreationPreferencesStore>()(
    persist(
        (set) => ({
            hydrated: false,
            preferences: {},
            rememberMode: (mode) => set((state) => ({ preferences: { ...state.preferences, mode } })),
            rememberImageSettings: (settings) => set((state) => ({ preferences: { ...state.preferences, image: { ...state.preferences.image, ...settings } } })),
            rememberVideoSettings: (settings) => set((state) => ({ preferences: { ...state.preferences, video: { ...state.preferences.video, ...settings } } })),
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
