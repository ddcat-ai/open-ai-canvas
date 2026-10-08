import { scopedLocalStorage } from "@/lib/user-scope";
import { useMemo } from "react";
import type { ModelTag } from "@/lib/model-tags";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import { modelProtocolCapability, normalizeModelProtocol, type ModelProtocol } from "@/lib/model-protocols";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { useUserStore } from "@/stores/use-user-store";
import type { CapabilitySpec, PublicChannelModelAvailability, PublicLogicalModelPriceTier } from "@/services/api/logical-models";
import { type WorkflowFieldMapping, normalizeRunningHubCapability, normalizeRunningHubWorkflowKind, normalizeSavedWorkflowFields, mergeWorkflowFieldMappings, normalizeWorkflowFieldMappings } from "./config-workflow-fields";
import {
    decodeChannelModel,
    modelOptionName,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    CHANNEL_MODEL_SEPARATOR,
    uniqueModelOptions,
    encodeChannelModel,
    hasSystemModelPrice,
    isChannelModelValue,
    modelDisplayName,
    modelIcon,
    modelOptionLabel,
} from "./config-model-options";
import { normalizeRawModelName } from "./config-model-options";

export { CHANNEL_MODEL_SEPARATOR, normalizeRawModelName, uniqueModelOptions } from "./config-model-options";
export { mergeWorkflowFieldMappings, normalizeRunningHubCapability, normalizeRunningHubWorkflowKind, normalizeWorkflowFieldMappings, type WorkflowFieldMapping } from "./config-workflow-fields";
export { decodeChannelModel, encodeChannelModel, hasSystemModelPrice, isChannelModelValue, modelDisplayName, modelIcon, modelOptionLabel, modelOptionName, modelOptionsFromChannels, normalizeModelOptionValue } from "./config-model-options";

export type ApiCallFormat = "openai" | "gemini" | "claude";
export type ChannelInterfaceType = ModelProtocol;
export type ChannelHeader = { name: string; value: string };
export type RunningHubCapability = "image" | "video" | "audio";
export type RunningHubWorkflowKind = "workflow" | "app";
export type RunningHubWorkflow = {
    kind?: RunningHubWorkflowKind;
    capability?: RunningHubCapability;
    workflowId: string;
    webappId?: string;
    title?: string;
    description?: string;
    fields?: WorkflowFieldMapping[];
    workflowJson?: Record<string, unknown>;
    optionalImageMode?: string;
    raw?: Record<string, unknown>;
};

export type RunningHubConfig = {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    walletApiKey: string;
    /** 仅用于 RunningHub 参考素材上传，通常填写企业级 API Key。 */
    uploadApiKey?: string;
    useWallet: boolean;
    capability: RunningHubCapability;
    selectedKind: RunningHubWorkflowKind;
    workflowId: string;
    workflows: RunningHubWorkflow[];
};

export type WorkflowGraphPreview = {
    nodes: Array<{ id: string; title?: string; classType?: string }>;
    edges: Array<{ from: string; to: string }>;
};

// 兼容仍在使用旧目录标识的会话恢复和模型选择器。
export const PUBLIC_MODEL_CATALOG_ID = "managed";

export type ModelChannel = {
    id: string;
    name: string;
    sortOrder?: number;
    baseUrl: string;
    apiKey: string;
    secretKey?: string;
    headers?: ChannelHeader[];
    apiFormat: ApiCallFormat;
    interfaceType?: ChannelInterfaceType;
    models: string[];
    // 仅平台目录使用：将已保存的旧 SKU 选择重定向到当前模型家族。
    modelAliases?: Record<string, string>;
    scope?: "system" | "user";
    enabled?: boolean;
    hasApiKey?: boolean;
    hasSecretKey?: boolean;
    concurrencyLimit?: number;
    modelCosts?: Array<{
        model: string;
        displayName?: string;
        channelLabel?: string;
        tags?: ModelTag[];
        description?: string;
        icon?: string;
        capability: ModelCapability;
        protocol?: ModelProtocol;
        pricePolicy?: "channel" | "unified";
        billingMode: "fixed_request" | "per_second" | "per_character" | "token";
        unitPriceMicrocredits: number;
        inputTokenPriceMicrocredits?: number;
        outputTokenPriceMicrocredits?: number;
        cachedTokenPriceMicrocredits?: number;
        capabilityConfig?: ModelCapabilityConfig;
        logicalModelId?: string;
        logicalCapabilitySpec?: CapabilitySpec;
        logicalCapabilityProfiles?: CapabilitySpec[];
        logicalPriceTiers?: PublicLogicalModelPriceTier[];
        defaultOptions?: Record<string, unknown>;
        availability?: PublicChannelModelAvailability;
        available?: boolean;
    }>;
};

export type AiConfig = {
    channelMode: "remote";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    runningHub: RunningHubConfig;
    /** 仅用于单次生成任务路由，不属于全局渠道启用状态。 */
    taskWorkflowProvider?: "model" | "runninghub";
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioLanguage: string;
    audioDialect: string;
    audioInstructions: string;
    audioEmotionControlMethod: string;
    audioEmotionRandom: string;
    audioEmotionHappy: string;
    audioEmotionAngry: string;
    audioEmotionSad: string;
    audioEmotionAfraid: string;
    audioEmotionDisgusted: string;
    audioEmotionMelancholic: string;
    audioEmotionSurprised: string;
    audioEmotionCalm: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoArkPrivateAssetUpload: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    transparentBackground: string;
    count: string;
    canvasImageCount: string;
};

export const CONFIG_STORE_KEY = "open_ai_canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const LEGACY_DEFAULT_MODEL_NAMES = new Set(["gpt-image-2", "grok-imagine-video", "gpt-5.5", "gpt-4o-mini-tts"]);

export const defaultConfig: AiConfig = {
    channelMode: "remote",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    // 创作端模型目录只能来自后台公开逻辑模型和用户自定义渠道，不能内置供应商模型。
    channels: [],
    runningHub: { enabled: false, baseUrl: "https://www.runninghub.cn", apiKey: "", walletApiKey: "", uploadApiKey: "", useWallet: false, capability: "image", selectedKind: "workflow", workflowId: "", workflows: [] },
    taskWorkflowProvider: "model",
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioLanguage: "",
    audioDialect: "",
    audioInstructions: "",
    audioEmotionControlMethod: "与音色参考音频相同",
    audioEmotionRandom: "false",
    audioEmotionHappy: "0",
    audioEmotionAngry: "0",
    audioEmotionSad: "0",
    audioEmotionAfraid: "0",
    audioEmotionDisgusted: "0",
    audioEmotionMelancholic: "0",
    audioEmotionSurprised: "0",
    audioEmotionCalm: "0",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoArkPrivateAssetUpload: "true",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    transparentBackground: "false",
    count: "1",
    canvasImageCount: "1",
};

type ConfigStore = {
    config: AiConfig;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    replaceConfig: (config: AiConfig) => void;
    mergeSystemChannels: (channels: ModelChannel[]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
};

export type ConfigStoreSnapshot = {
    config?: Partial<AiConfig>;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return (
        value.includes("seedance") ||
        value.includes("video") ||
        value.includes("sora") ||
        value.includes("veo") ||
        value.includes("kling") ||
        value.includes("wan") ||
        value.includes("hailuo") ||
        value.includes("pika") ||
        value.includes("runway") ||
        value.includes("gen-3") ||
        value.includes("gen3") ||
        value.includes("hunyuan-video") ||
        value.includes("hunyuanvideo") ||
        value.includes("cogvideo") ||
        value.includes("mochi") ||
        value.includes("latte") ||
        value.includes("stable-video") ||
        value.includes("svd") ||
        value.includes("animatediff") ||
        value.includes("ltx-video") ||
        value.includes("ltxvideo") ||
        value.includes("minimax-video") ||
        value.includes("abab-video")
    );
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
            value.includes("midjourney") ||
            value.includes("nano-banana") ||
            value.includes("nanobanana") ||
            value.includes("ideogram") ||
            value.includes("recraft") ||
            value.includes("playground") ||
            value.includes("leonardo"))
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
        const modelName = decoded?.model || modelOptionName(model);
        const costEntry = channel?.modelCosts?.find((item) => item.model === modelName);
        // 协议层优先级最高：协议决定 API 端点，明确属于其他能力时直接排除，
        // 防止用户将 video/image/audio 协议的模型误标为 text 后混入文本下拉。
        const protocolCapability = modelProtocolCapability(costEntry?.protocol);
        if (protocolCapability) return protocolCapability === capability;
        // 渠道接口层：渠道级协议推断能力
        const channelCapability = capabilityForChannelInterface(channel?.interfaceType);
        if (channelCapability) return channelCapability === capability;
        // 配置能力层：用户显式标记的 capability
        const configuredCapability = costEntry?.capability;
        if (configuredCapability) return configuredCapability === capability;
        // 模型名启发式：最后回退
        return modelMatchesCapability(model, capability);
    });
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    // 选项目录只从当前有效渠道重建，不能信任旧快照里残留的 config.models。
    // 这样旧版本内置模型、未绑定渠道的裸模型不会再次进入创作端。
    const models = modelOptionsFromChannels(config.channels);
    if (!capability) return models;
    return filterModelsByCapability(models, capability, config.channels);
}

export function configuredModelMatchesCapability(config: AiConfig, model: string, capability?: ModelCapability) {
    const normalized = normalizeModelOptionValue(model, config.channels);
    if (!normalized) return false;
    return selectableModelsByCapability(config, capability).includes(normalized);
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (config.taskWorkflowProvider === "runninghub") {
        const key = config.runningHub.apiKey;
        return Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && key.trim() && config.runningHub.workflowId.trim());
    }
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: defaultConfig,
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

export function normalizeConfigSnapshot(snapshot: ConfigStoreSnapshot | undefined = {}) {
    // 坏存储/旧版本快照可能是 undefined 或缺 config，兜底为 defaultConfig，保证渲染不崩溃
    const persistedConfig = (snapshot?.config || {}) as Partial<AiConfig>;
    const persistedRunningHub = persistedConfig.runningHub;
    const runningHubCapability = normalizeRunningHubCapability(persistedRunningHub?.capability, defaultConfig.runningHub.capability);
    const runningHubWorkflows = Array.isArray(persistedRunningHub?.workflows)
        ? persistedRunningHub.workflows
              .filter((item): item is RunningHubWorkflow => Boolean(item && typeof item === "object" && String(item.workflowId || "").trim()))
              .map((item) => {
                  const capability = normalizeRunningHubCapability(item.capability, runningHubCapability);
                  return {
                      ...item,
                      kind: normalizeRunningHubWorkflowKind(item.kind),
                      workflowId: String(item.workflowId || "").trim(),
                      capability,
                      fields: normalizeSavedWorkflowFields(item, capability),
                  };
              })
        : [];
    const runningHubWorkflowID = String(persistedRunningHub?.workflowId || "").trim();
    const runningHubSelectedKind = persistedRunningHub?.selectedKind ? normalizeRunningHubWorkflowKind(persistedRunningHub.selectedKind) : normalizeRunningHubWorkflowKind(runningHubWorkflows.find((item) => item.workflowId === runningHubWorkflowID)?.kind);
    const config = {
        ...defaultConfig,
        ...persistedConfig,
        taskWorkflowProvider: "model" as const,
        runningHub: {
            ...defaultConfig.runningHub,
            ...(persistedRunningHub || {}),
            capability: runningHubCapability,
            selectedKind: runningHubSelectedKind,
            workflowId: runningHubWorkflowID,
            workflows: runningHubWorkflows,
        },
    };
    const hasPersistedChannels = Array.isArray(persistedConfig.channels);
    if (!hasPersistedChannels) config.channels = [];
    const channels = normalizeChannels(config, !hasPersistedChannels);
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    const model = normalizeSelectedModel(config.model || config.imageModel || config.textModel, channels, models);
    return {
        config: {
            ...config,
            channelMode: "remote" as const,
            apiFormat: normalizeApiFormat(config.apiFormat),
            channels,
            models,
            model,
            imageModel: normalizeSelectedModel(config.imageModel || model, channels, imageModels),
            videoModel: normalizeSelectedModel(config.videoModel, channels, videoModels),
            textModel: normalizeSelectedModel(config.textModel || model, channels, textModels),
            audioModel: normalizeSelectedModel(config.audioModel || defaultConfig.audioModel, channels, audioModels),
            audioVoice: config.audioVoice || defaultConfig.audioVoice,
            audioFormat: config.audioFormat || defaultConfig.audioFormat,
            audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
            audioLanguage: config.audioLanguage || "",
            audioDialect: config.audioDialect || "",
            audioInstructions: config.audioInstructions || "",
            audioEmotionControlMethod: config.audioEmotionControlMethod || defaultConfig.audioEmotionControlMethod,
            audioEmotionRandom: config.audioEmotionRandom || defaultConfig.audioEmotionRandom,
            audioEmotionHappy: config.audioEmotionHappy || defaultConfig.audioEmotionHappy,
            audioEmotionAngry: config.audioEmotionAngry || defaultConfig.audioEmotionAngry,
            audioEmotionSad: config.audioEmotionSad || defaultConfig.audioEmotionSad,
            audioEmotionAfraid: config.audioEmotionAfraid || defaultConfig.audioEmotionAfraid,
            audioEmotionDisgusted: config.audioEmotionDisgusted || defaultConfig.audioEmotionDisgusted,
            audioEmotionMelancholic: config.audioEmotionMelancholic || defaultConfig.audioEmotionMelancholic,
            audioEmotionSurprised: config.audioEmotionSurprised || defaultConfig.audioEmotionSurprised,
            audioEmotionCalm: config.audioEmotionCalm || defaultConfig.audioEmotionCalm,
            // 旧版全局 systemPrompt 会跨任务污染请求；提示词定制现已按 operation 由服务端编译。
            systemPrompt: "",
            videoSeconds: normalizeVideoDuration(config.videoSeconds),
            vquality: normalizeVideoResolution(config.vquality),
            videoGenerateAudio: config.videoGenerateAudio || "true",
            videoWatermark: config.videoWatermark || "false",
            videoArkPrivateAssetUpload: config.videoArkPrivateAssetUpload || "true",
            transparentBackground: config.transparentBackground === "true" ? "true" : "false",
            canvasImageCount: config.canvasImageCount || defaultConfig.canvasImageCount,
            imageModels,
            videoModels,
            textModels,
            audioModels,
        },
    };
}

function normalizeSelectedModel(value: string, channels: ModelChannel[], options: string[]) {
    const model = normalizeModelOptionValue(value, channels);
    return model && options.includes(model) ? model : options[0] || "";
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    return useMemo(() => effectiveConfigForCustomChannels(config, customChannelsEnabled), [config, customChannelsEnabled]);
}

export function effectiveConfigForCustomChannels(config: AiConfig, customChannelsEnabled: boolean): AiConfig {
    if (customChannelsEnabled) return config;
    const channels = config.channels.filter((channel) => channel.scope === "system");
    return normalizeConfigSnapshot({ config: { ...config, channels } }).config;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    const interfaceType = normalizeChannelInterfaceType(channel?.interfaceType);
    const providedBaseUrl = channel?.baseUrl?.trim();
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        sortOrder: channel?.sortOrder ?? 0,
        baseUrl: providedBaseUrl || (interfaceType ? defaultBaseUrlForChannelInterface(interfaceType) : defaultBaseUrlForApiFormat(apiFormat)),
        apiKey: channel?.apiKey || "",
        secretKey: channel?.secretKey || "",
        headers: Array.isArray(channel?.headers) ? channel.headers.map((header) => ({ name: String(header.name || ""), value: String(header.value || "") })) : [],
        apiFormat,
        interfaceType,
        models: uniqueRawModels(channel?.models || []),
        scope: channel?.scope === "system" ? "system" : "user",
        enabled: channel?.enabled !== false,
        hasApiKey: channel?.hasApiKey,
        hasSecretKey: channel?.hasSecretKey,
        modelCosts: channel?.modelCosts?.map((item) => ({ ...item, protocol: normalizeModelProtocol(item.protocol) })),
    };
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function logicalModelIDForConfig(config: AiConfig) {
    const channel = resolveModelChannel(config, config.model);
    return channel.modelCosts?.find((item) => item.model === modelOptionName(config.model))?.logicalModelId || "";
}

export function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, channel.interfaceType || "auto", JSON.stringify(channel.headers || [])].join("\n");
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const model = modelOptionName(value || config.model);
    const modelProtocol = channel.modelCosts?.find((item) => item.model === model)?.protocol;
    const interfaceType = modelProtocol || channel.interfaceType;
    return {
        ...config,
        model,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        secretKey: channel.secretKey,
        headers: channel.headers,
        apiFormat: interfaceType ? (interfaceType === "gemini-veo" || interfaceType === "gemini-image" ? ("gemini" as const) : interfaceType === "claude-api" ? ("claude" as const) : ("openai" as const)) : channel.apiFormat,
        interfaceType,
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

function isEmptyDefaultChannel(channel: ModelChannel) {
    if (channel.scope === "system") return false;
    if (channel.id !== "default" || channel.name.trim() !== "默认渠道" || channel.apiKey.trim()) return false;
    const baseUrl = channel.baseUrl.trim().replace(/\/+$/, "");
    const defaultBaseUrl = defaultConfig.baseUrl.trim().replace(/\/+$/, "");
    if (baseUrl && baseUrl !== defaultBaseUrl) return false;
    // 只清理旧版本写入浏览器的无密钥“默认渠道”和内置模型；没有 API Key 但已填写自定义模型时仍保留，
    // 让用户可以先保存模型目录再补充密钥，而不是把真实自定义配置误判为空。
    return !channel.models.length || channel.models.every((model) => LEGACY_DEFAULT_MODEL_NAMES.has(modelOptionName(model)));
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

export function defaultBaseUrlForChannelInterface(interfaceType?: ChannelInterfaceType) {
    if (interfaceType === "gemini-veo" || interfaceType === "gemini-image") return GEMINI_BASE_URL;
    if (interfaceType === "novita-video") return "https://api.novita.ai/v3";
    if (interfaceType === "volcengine-ark-agent-plan-image" || interfaceType === "volcengine-ark-agent-plan-video") return "https://ark.cn-beijing.volces.com/api/plan/v3";
    if (interfaceType === "volcengine-ark-image" || interfaceType === "volcengine-ark-video") return "https://ark.cn-beijing.volces.com/api/v3";
    if (interfaceType === "volcengine-jimeng-image" || interfaceType === "volcengine-jimeng-video") return "https://visual.volcengineapi.com";
    if (interfaceType === "minimax-video") return "https://api.minimaxi.com";
    if (interfaceType === "grok-image" || interfaceType === "newapi" || interfaceType === "newapi-channel-1" || interfaceType === "newapi-channel-2" || interfaceType === "xai-video") return "";
    return OPENAI_BASE_URL;
}

function capabilityForChannelInterface(interfaceType?: ChannelInterfaceType): ModelCapability | undefined {
    return modelProtocolCapability(interfaceType);
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "claude" ? apiFormat : "openai";
}

function normalizeChannelInterfaceType(value: unknown): ChannelInterfaceType | undefined {
    return normalizeModelProtocol(value);
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map(normalizeRawModelName).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = resolveBackendApiUrl(baseUrl).replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const requestPath = path.startsWith("/") ? path : `/${path}`;
    if (isSystemProxyBaseUrl(normalizedBaseUrl)) return `${normalizedBaseUrl}${requestPath}`;

    const knownPrefixes = ["/api/plan/v3", "/api/v3", "/v1beta", "/v1", "/v2", "/v3"];
    const requestPrefixFor = (value: string) =>
        knownPrefixes.find((prefix) => {
            const lower = value.toLowerCase();
            return lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`) || lower.startsWith(`${prefix}#`);
        }) || "";
    const basePrefixFor = (value: string) =>
        knownPrefixes.find((prefix) => {
            const lower = value.toLowerCase();
            return lower.endsWith(prefix) || lower.includes(`${prefix}/`) || lower.includes(`${prefix}?`) || lower.includes(`${prefix}#`);
        }) || "";
    const basePrefix = basePrefixFor(normalizedBaseUrl);
    const requestPrefix = requestPrefixFor(requestPath);
    if (requestPrefix) {
        const root = basePrefix ? normalizedBaseUrl.slice(0, -basePrefix.length) : normalizedBaseUrl;
        return `${root}${requestPath}`;
    }
    return `${normalizedBaseUrl}${basePrefix ? "" : "/v1"}${requestPath}`;
}

export function resolveBackendApiUrl(value: string) {
    const url = value.trim();
    if (!url.startsWith("/api/")) return url;
    const backendBaseUrl = String(import.meta.env.VITE_CANVAS_BACKEND_URL || "/api")
        .trim()
        .replace(/\/+$/, "");
    return backendBaseUrl === "/api" ? url : `${backendBaseUrl}${url.slice("/api".length)}`;
}

export function isSystemProxyBaseUrl(baseUrl: string) {
    return Boolean(systemProxyChannelId(baseUrl));
}

export function systemProxyChannelId(baseUrl: string) {
    const value = baseUrl.trim();
    const lowerValue = value.toLowerCase();
    for (const marker of ["/api/ai/system/", "/api/"]) {
        const index = lowerValue.lastIndexOf(marker);
        if (index < 0) continue;
        const remainder = value.slice(index + marker.length);
        if (/[/?#]/.test(remainder)) continue;
        const channelId = remainder.trim();
        if (channelId && !channelId.includes("\\") && !["v1", "v1beta", "v2", "v3", "plan", "ai"].includes(channelId.toLowerCase())) return channelId;
    }
    return "";
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
