import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { scopedLocalStorage } from "@/lib/user-scope";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";

export type ApiCallFormat = "openai" | "gemini";
export type ChannelInterfaceType = "chat-completion" | "openai-response" | "openai-image" | "newapi" | "newapi-channel-1" | "newapi-channel-2" | "xai-video";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    interfaceType?: ChannelInterfaceType;
    models: string[];
    scope?: "system" | "user";
    enabled?: boolean;
    hasApiKey?: boolean;
    concurrencyLimit?: number;
    modelCosts?: Array<{
        model: string;
        capability: ModelCapability;
        billingMode: "fixed_request";
        unitPriceMicrocredits: number;
    }>;
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
};

export const CONFIG_STORE_KEY = "open_ai_canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: ["gpt-image-2", "grok-imagine-video", "gpt-5.5", "gpt-4o-mini-tts"],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    imageModels: ["default::gpt-image-2"],
    videoModels: ["default::grok-imagine-video"],
    textModels: ["default::gpt-5.5"],
    audioModels: ["default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "1",
};

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    replaceConfig: (config: AiConfig) => void;
    mergeSystemChannels: (channels: ModelChannel[]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    configDialogSection?: "channels" | "models" | "preferences" | "storage";
    openConfigDialog: (shouldPromptContinue?: boolean, section?: "channels" | "models" | "preferences" | "storage") => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

export type ConfigStoreSnapshot = {
    config?: Partial<AiConfig>;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("image") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("flux") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney"))
    );
}

function isAudioModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability, channels?: ModelChannel[]) {
    if (!capability) return models;
    return models.filter((model) => {
        const decoded = decodeChannelModel(model);
        const channel = decoded ? channels?.find((item) => item.id === decoded.channelId) : undefined;
        const channelCapability = capabilityForChannelInterface(channel?.interfaceType);
        return channelCapability ? channelCapability === capability : modelMatchesCapability(model, capability);
    });
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

export function configuredModelMatchesCapability(config: AiConfig, model: string, capability?: ModelCapability) {
    const normalized = normalizeModelOptionValue(model, config.channels);
    if (!normalized || !config.models.includes(normalized)) return false;
    return capability ? selectableModelsByCapability(config, capability).includes(normalized) : true;
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: defaultConfig,
            isConfigOpen: false,
            shouldPromptContinue: false,
            configDialogSection: undefined,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            replaceConfig: (config) => set({ config }),
            mergeSystemChannels: (channels) =>
                set((state) => {
                    const systemChannels = channels.map((channel, index) =>
                        createModelChannel({
                            ...channel,
                            id: channel.id || `system-${index + 1}`,
                            name: channel.name || `系统渠道 ${index + 1}`,
                            scope: "system",
                            apiKey: channel.apiKey || "system",
                        }),
                    );
                    const userChannels = state.config.channels.filter((channel) => channel.scope !== "system");
                    return normalizeConfigSnapshot({ config: { ...state.config, channels: [...systemChannels, ...userChannels] } });
                }),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configDialogSection) => set({ isConfigOpen: true, shouldPromptContinue, configDialogSection }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            storage: createJSONStorage(() => scopedLocalStorage),
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                return {
                    ...current,
                    ...normalizeConfigSnapshot({ config: persistedState.config }),
                };
            },
        },
    ),
);

export function normalizeConfigSnapshot(snapshot: ConfigStoreSnapshot) {
    const persistedConfig = (snapshot.config || {}) as Partial<AiConfig>;
    const config = { ...defaultConfig, ...persistedConfig };
    const hasPersistedChannels = Array.isArray(persistedConfig.channels);
    if (!hasPersistedChannels) config.channels = [];
    const channels = normalizeChannels(config, !hasPersistedChannels);
    const models = modelOptionsFromChannels(channels);
    const imageModels = normalizeSelectableModelList(persistedConfig.imageModels, channels, models, "image");
    const videoModels = normalizeSelectableModelList(persistedConfig.videoModels, channels, models, "video");
    const textModels = normalizeSelectableModelList(persistedConfig.textModels, channels, models, "text");
    const audioModels = normalizeSelectableModelList(persistedConfig.audioModels, channels, models, "audio");
    const model = normalizeSelectedModel(config.model || config.imageModel || config.textModel, channels, models);
    return {
        config: {
            ...config,
            channelMode: "local" as const,
            apiFormat: normalizeApiFormat(config.apiFormat),
            channels,
            models,
            model,
            imageModel: normalizeSelectedModel(config.imageModel || model, channels, imageModels),
            videoModel: normalizeSelectedModel(config.videoModel || "grok-imagine-video", channels, videoModels),
            textModel: normalizeSelectedModel(config.textModel || model, channels, textModels),
            audioModel: normalizeSelectedModel(config.audioModel || defaultConfig.audioModel, channels, audioModels),
            audioVoice: config.audioVoice || defaultConfig.audioVoice,
            audioFormat: config.audioFormat || defaultConfig.audioFormat,
            audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
            audioInstructions: config.audioInstructions || "",
            videoSeconds: normalizeVideoDuration(config.videoSeconds),
            vquality: normalizeVideoResolution(config.vquality),
            videoGenerateAudio: config.videoGenerateAudio || "true",
            videoWatermark: config.videoWatermark || "false",
            canvasImageCount: config.canvasImageCount || defaultConfig.canvasImageCount,
            imageModels,
            videoModels,
            textModels,
            audioModels,
        },
    };
}

function normalizeModelList(models: string[], channels: ModelChannel[]) {
    const allModelOptions = channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model)));
    return Array.from(new Set((models || []).map((model) => normalizeModelOptionValue(model, channels)).filter(Boolean)))
        .filter((model) => allModelOptions.includes(model));
}

function normalizeSelectedModel(value: string, channels: ModelChannel[], options: string[]) {
    const model = normalizeModelOptionValue(value, channels);
    return model && options.includes(model) ? model : options[0] || "";
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    const interfaceType = normalizeChannelInterfaceType(channel?.interfaceType);
    const providedBaseUrl = channel?.baseUrl?.trim();
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: providedBaseUrl || (interfaceType ? defaultBaseUrlForChannelInterface(interfaceType) : defaultBaseUrlForApiFormat(apiFormat)),
        apiKey: channel?.apiKey || "",
        apiFormat,
        interfaceType,
        models: uniqueRawModels(channel?.models || []),
        scope: channel?.scope === "system" ? "system" : "user",
        enabled: channel?.enabled !== false,
        hasApiKey: channel?.hasApiKey,
        modelCosts: channel?.modelCosts,
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(
        channels.flatMap((channel) =>
            channel.models
                .map(normalizeRawModelName)
                .filter(Boolean)
                .filter((model) => channel.scope !== "system" || hasSystemModelPrice(channel, model))
                .map((model) => encodeChannelModel(channel.id, model)),
        ),
    );
}

export function hasSystemModelPrice(channel: ModelChannel, model: string) {
    if (channel.scope !== "system") return true;
    return channel.modelCosts?.some((item) => item.model === model && Number.isFinite(item.unitPriceMicrocredits) && item.unitPriceMicrocredits >= 0) === true;
}

export function normalizeModelOptionValue(value: unknown, channels: ModelChannel[]) {
    const model = typeof value === "string" ? value.trim() : "";
    if (!normalizeRawModelName(model)) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.includes(decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.includes(model)) || channels[0];
    return channel && channel.models.includes(model) ? encodeChannelModel(channel.id, model) : "";
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        interfaceType: channel.interfaceType,
        channelId: channel.scope === "system" ? channel.id : "",
    };
}

function normalizeChannels(config: AiConfig, ensureDefault = true) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels
        .map((channel, index) =>
            createModelChannel({
                ...channel,
                id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
                name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
                models: uniqueRawModels(channel.models || []),
            }),
        )
        .filter((channel) => !isEmptyDefaultChannel(channel));
    if (!channels.length && ensureDefault && config.apiKey.trim()) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: uniqueRawModels([...(config.models || []), config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel]),
            }),
        );
    }
    return channels.map((channel) => ({ ...channel, models: uniqueRawModels(channel.models) }));
}

function normalizeSelectableModelList(value: string[] | undefined, channels: ModelChannel[], models: string[], capability: ModelCapability) {
    const suggested = filterModelsByCapability(models, capability, channels);
    if (!Array.isArray(value)) return suggested;
    // 字段缺失表示旧配置尚未选择过；显式空数组表示用户主动清空，不能重新补回推荐模型。
    return normalizeModelList(value, channels);
}

function isEmptyDefaultChannel(channel: ModelChannel) {
    if (channel.scope === "system") return false;
    if (channel.id !== "default" || channel.name.trim() !== "默认渠道" || channel.apiKey.trim()) return false;
    const baseUrl = channel.baseUrl.trim().replace(/\/+$/, "");
    const defaultBaseUrl = defaultConfig.baseUrl.trim().replace(/\/+$/, "");
    if (baseUrl && baseUrl !== defaultBaseUrl) return false;
    const defaultModels = new Set((defaultConfig.channels[0]?.models || []).map(modelOptionName));
    return !channel.models.length || channel.models.every((model) => defaultModels.has(modelOptionName(model)));
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

export function defaultBaseUrlForChannelInterface(interfaceType?: ChannelInterfaceType) {
    if (interfaceType === "newapi" || interfaceType === "newapi-channel-1" || interfaceType === "newapi-channel-2" || interfaceType === "xai-video") return "";
    return OPENAI_BASE_URL;
}

function capabilityForChannelInterface(interfaceType?: ChannelInterfaceType): ModelCapability | undefined {
    if (interfaceType === "chat-completion" || interfaceType === "openai-response") return "text";
    if (interfaceType === "openai-image") return "image";
    if (interfaceType === "newapi" || interfaceType === "newapi-channel-1" || interfaceType === "newapi-channel-2" || interfaceType === "xai-video") return "video";
    return undefined;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function normalizeChannelInterfaceType(value: unknown): ChannelInterfaceType | undefined {
    return value === "chat-completion" || value === "openai-response" || value === "openai-image" || value === "newapi" || value === "newapi-channel-1" || value === "newapi-channel-2" || value === "xai-video" ? value : undefined;
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map(normalizeRawModelName).filter(Boolean)));
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean)));
}

function normalizeRawModelName(value: unknown) {
    if (typeof value !== "string") return "";
    const model = modelOptionName(value).trim();
    return model && model !== "undefined" && model !== "null" ? model : "";
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = resolveBackendApiUrl(baseUrl).replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = isSystemProxyBaseUrl(normalizedBaseUrl) || lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

export function resolveBackendApiUrl(value: string) {
    const url = value.trim();
    if (!url.startsWith("/api/")) return url;
    const backendBaseUrl = String(import.meta.env.VITE_CANVAS_BACKEND_URL || "/api").trim().replace(/\/+$/, "");
    return backendBaseUrl === "/api" ? url : `${backendBaseUrl}${url.slice("/api".length)}`;
}

export function isSystemProxyBaseUrl(baseUrl: string) {
    const marker = "/api/ai/system/";
    const index = baseUrl.toLowerCase().indexOf(marker);
    if (index < 0) return false;
    const channelId = baseUrl.slice(index + marker.length);
    return Boolean(channelId && !channelId.includes("/") && !channelId.includes("?") && !channelId.includes("#"));
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
