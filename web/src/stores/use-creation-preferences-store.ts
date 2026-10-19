import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { scopedLocalStorage } from "@/lib/user-scope";
import type { AgentOutputPreference } from "@/services/api/agent";
import type { AiConfig } from "./use-config-store";

export type CreationModePreference = "text" | "image" | "video" | "agent";

export type CreationAgentPreferences = {
    permissionMode: "read_only" | "request_approval" | "auto";
    imageSelectionMode: "preferred" | "fixed";
    videoSelectionMode: "preferred" | "fixed";
    imageParameterMode: "auto" | "manual";
    videoParameterMode: "auto" | "manual";
    budget: { maxCredits: number; maxGenerationTasks: number; maxVideoSeconds: number };
    image: { size: string; quality: string; count: number };
    video: { size: string; quality: string; durationSeconds: number };
};

export const defaultCreationAgentPreferences: CreationAgentPreferences = {
    permissionMode: "request_approval",
    imageParameterMode: "auto",
    videoParameterMode: "auto",
    imageSelectionMode: "preferred",
    videoSelectionMode: "preferred",
    budget: { maxCredits: 200, maxGenerationTasks: 0, maxVideoSeconds: 30 },
    image: { size: "1:1", quality: "auto", count: 1 },
    video: { size: "16:9", quality: "720", durationSeconds: 6 },
};

export type CreationImagePreferences = {
    model?: string;
    imageParameters?: string;
    ratio?: string;
    quality?: string;
    imageResolution?: string;
    transparentBackground?: string;
    count?: string;
};

export type CreationVideoPreferences = {
    ratio?: string;
    seconds?: string;
    videoQuality?: string;
};

export type CreationComposerPreferences = {
    agent?: CreationAgentPreferences;
    mode?: CreationModePreference;
    outputPreference?: AgentOutputPreference;
    image?: CreationImagePreferences;
    video?: CreationVideoPreferences;
    models?: Partial<Pick<AiConfig, "textModel" | "imageModel" | "videoModel">>;
    activeConversationId?: string;
};

type CreationPreferencesStore = {
    syncStatus: "local" | "loading" | "saving" | "synced" | "error";
    pendingPreferenceChanges: Record<string, string | number>;
    rememberAgent: (preferences: Partial<CreationAgentPreferences>) => void;
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
        ...(nonEmptyString(raw.model) ? { model: raw.model } : {}),
        ...(nonEmptyString(raw.imageParameters) ? { imageParameters: raw.imageParameters } : {}),
        ...(nonEmptyString(raw.ratio) ? { ratio: raw.ratio } : {}),
        ...(nonEmptyString(raw.quality) ? { quality: raw.quality } : {}),
        ...(nonEmptyString(raw.imageResolution) ? { imageResolution: raw.imageResolution } : {}),
        ...(raw.transparentBackground === "true" || raw.transparentBackground === "false" ? { transparentBackground: raw.transparentBackground } : {}),
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
    const agent = normalizeCreationAgentPreferences(raw.agent);
    const image = normalizeImagePreferences(raw.image);
    const video = normalizeVideoPreferences(raw.video);
    const models =
        raw.models && typeof raw.models === "object" && !Array.isArray(raw.models) ? Object.fromEntries(Object.entries(raw.models).filter(([key, value]) => ["textModel", "imageModel", "videoModel"].includes(key) && nonEmptyString(value))) : undefined;
    return {
        ...(agent ? { agent } : {}),
        ...(raw.mode === "text" || raw.mode === "image" || raw.mode === "video" || raw.mode === "agent" ? { mode: raw.mode } : {}),
        ...(raw.outputPreference === "concise" || raw.outputPreference === "detailed" ? { outputPreference: raw.outputPreference } : {}),
        ...(image ? { image } : {}),
        ...(video ? { video } : {}),
        ...(models && Object.keys(models).length ? { models } : {}),
        ...(nonEmptyString(raw.activeConversationId) ? { activeConversationId: raw.activeConversationId } : {}),
    };
}

function normalizeCreationAgentPreferences(value: unknown): CreationAgentPreferences | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as Partial<CreationAgentPreferences>;
    const defaults = defaultCreationAgentPreferences;
    const number = (value: unknown, fallback: number, integer = true) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10000000 && (!integer || Number.isInteger(value)) ? value : fallback);
    const string = (value: unknown, fallback: string) => (typeof value === "string" && value.length <= 256 ? value : fallback);
    return {
        permissionMode: ["auto", "read_only", "request_approval"].includes(raw.permissionMode || "") ? raw.permissionMode! : defaults.permissionMode,
        imageSelectionMode: raw.imageSelectionMode === "fixed" ? "fixed" : "preferred",
        videoSelectionMode: raw.videoSelectionMode === "fixed" ? "fixed" : "preferred",
        imageParameterMode: raw.imageParameterMode === "manual" ? "manual" : "auto",
        videoParameterMode: raw.videoParameterMode === "manual" ? "manual" : "auto",
        budget: { maxCredits: number(raw.budget?.maxCredits, defaults.budget.maxCredits, false), maxGenerationTasks: number(raw.budget?.maxGenerationTasks, 0), maxVideoSeconds: number(raw.budget?.maxVideoSeconds, defaults.budget.maxVideoSeconds) },
        image: { size: string(raw.image?.size, defaults.image.size), quality: string(raw.image?.quality, defaults.image.quality), count: number(raw.image?.count, 1) },
        video: { size: string(raw.video?.size, defaults.video.size), quality: string(raw.video?.quality, defaults.video.quality), durationSeconds: number(raw.video?.durationSeconds, defaults.video.durationSeconds) },
    };
}

export function creationConfigWithPreferences(config: AiConfig, preferences: CreationComposerPreferences): AiConfig {
    return { ...config, ...preferences.models, ...(preferences.image?.transparentBackground !== undefined ? { transparentBackground: preferences.image.transparentBackground } : {}) };
}

export const useCreationPreferencesStore = create<CreationPreferencesStore>()(
    persist(
        (set) => ({
            syncStatus: "local",
            pendingPreferenceChanges: {},
            rememberAgent: (preferences) => set((state) => ({ preferences: { ...state.preferences, agent: { ...defaultCreationAgentPreferences, ...state.preferences.agent, ...preferences } } })),
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
            partialize: (state) => ({ preferences: state.preferences, pendingPreferenceChanges: state.pendingPreferenceChanges }),
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<CreationPreferencesStore>;
                return { ...current, preferences: normalizeCreationComposerPreferences(stored.preferences), pendingPreferenceChanges: stored.pendingPreferenceChanges || {} };
            },
            onRehydrateStorage: () => () => {
                useCreationPreferencesStore.setState({ hydrated: true });
            },
        },
    ),
);

export function useCreationAgentPreferences() {
    const agent = useCreationPreferencesStore((state) => state.preferences.agent) || defaultCreationAgentPreferences;
    const update = <K extends keyof CreationAgentPreferences>(key: K, value: CreationAgentPreferences[K] | ((previous: CreationAgentPreferences[K]) => CreationAgentPreferences[K])) => {
        const store = useCreationPreferencesStore.getState();
        const previous = (store.preferences.agent || defaultCreationAgentPreferences)[key];
        store.rememberAgent({ [key]: typeof value === "function" ? value(previous) : value });
    };
    return {
        agentPermissionMode: agent.permissionMode,
        setAgentPermissionMode: (value: CreationAgentPreferences["permissionMode"]) => update("permissionMode", value),
        agentImageParameterMode: agent.imageParameterMode,
        setAgentImageParameterMode: (value: CreationAgentPreferences["imageParameterMode"]) => update("imageParameterMode", value),
        agentVideoParameterMode: agent.videoParameterMode,
        setAgentVideoParameterMode: (value: CreationAgentPreferences["videoParameterMode"]) => update("videoParameterMode", value),
        agentBudget: agent.budget,
        setAgentBudget: (value: (previous: CreationAgentPreferences["budget"]) => CreationAgentPreferences["budget"]) => update("budget", value),
        agentImageSettings: agent.image,
        setAgentImageSettings: (value: (previous: CreationAgentPreferences["image"]) => CreationAgentPreferences["image"]) => update("image", value),
        agentVideoSettings: agent.video,
        setAgentVideoSettings: (value: (previous: CreationAgentPreferences["video"]) => CreationAgentPreferences["video"]) => update("video", value),
        agentImageSelectionMode: agent.imageSelectionMode,
        setAgentImageSelectionMode: (value: CreationAgentPreferences["imageSelectionMode"]) => update("imageSelectionMode", value),
        agentVideoSelectionMode: agent.videoSelectionMode,
        setAgentVideoSelectionMode: (value: CreationAgentPreferences["videoSelectionMode"]) => update("videoSelectionMode", value),
    };
}
