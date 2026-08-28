import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { projectDesktopLocalChannelRuntime } from "@/lib/desktop-local-channel";
import { scopedLocalStorage } from "@/lib/user-scope";
import { modelProtocolCapability, normalizeModelProtocol, type ModelProtocol } from "@/lib/model-protocols";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { workflowFieldRole, workflowFieldSafeToOverride, workflowVideoFieldsFromJson, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { useLocalDreaminaModelStore } from "@/stores/use-local-dreamina-model-store";
import { useUserStore } from "@/stores/use-user-store";
import type { DreaminaLocalModel } from "@/services/local-dreamina-model-catalog";
import type { CapabilitySpec, PublicLogicalModelPriceTier } from "@/services/api/logical-models";

export type ApiCallFormat = "openai" | "gemini" | "claude";
export type ChannelInterfaceType = ModelProtocol;
export type ChannelHeader = { name: string; value: string };
export type RunningHubCapability = "image" | "video" | "audio";
export type RunningHubWorkflowKind = "workflow" | "app";

export type WorkflowFieldMapping = {
    id?: string;
    nodeId: string;
    classType?: string;
    fieldName: string;
    fieldValue?: unknown;
    value?: unknown;
    default?: unknown;
    defaultValue?: unknown;
    fieldType?: string;
    label?: string;
    role?: string;
    safeToOverride?: boolean;
    optionsSource?: "workflow" | "manual" | "preset";
    options?: unknown[];
    min?: unknown;
    max?: unknown;
    step?: unknown;
    enabled?: boolean;
    source?: string;
    sourceIndex?: number;
    imageOrder?: number;
    required?: boolean;
    randomEnabled?: boolean;
    bindPrompt?: boolean;
    sourceFromUpstream?: boolean;
    sourceAutomatic?: boolean;
};

export function normalizeRunningHubCapability(value: unknown, fallback: RunningHubCapability = "image"): RunningHubCapability {
    return value === "image" || value === "video" || value === "audio" ? value : fallback;
}

export function normalizeRunningHubWorkflowKind(value: unknown): RunningHubWorkflowKind {
    return value === "app" ? "app" : "workflow";
}

function normalizeWorkflowFieldSourceName(value: unknown, capability?: RunningHubCapability) {
    const source = String(value || "").trim();
    const normalized = source.toLowerCase().replace(/[\s_-]/g, "");
    const aliases: Record<string, string> = {
        text: "prompt", positive: "prompt", positiveprompt: "prompt",
        image: "referenceImage", referenceimage: "referenceImage", referenceimages: "referenceImage",
        video: "referenceVideo", referencevideo: "referenceVideo", referencevideos: "referenceVideo",
        audio: "referenceAudio", referenceaudio: "referenceAudio", referenceaudios: "referenceAudio",
        sizewidth: "width", imagewidth: "width", videowidth: "width", sizeheight: "height", imageheight: "height", videoheight: "height",
        ratio: "aspectRatio", aspectratio: "aspectRatio", imageaspectratio: "aspectRatio", imageratio: "aspectRatio", videoaspectratio: "aspectRatio", videoratio: "aspectRatio",
        videoresolution: "vquality", batch: "count", batchsize: "count", duration: "videoSeconds", videoseconds: "videoSeconds", videoquality: "vquality",
        generateaudio: "videoGenerateAudio", videogenerateaudio: "videoGenerateAudio", watermark: "videoWatermark", videowatermark: "videoWatermark", voice: "audioVoice",
        systemprompt: "systemPrompt", transparentbackground: "transparentBackground", audiovoice: "audioVoice",
        audioformat: "audioFormat", audiospeed: "audioSpeed", audioinstructions: "audioInstructions",
    };
    if (normalized === "resolution") return capability === "video" ? "vquality" : "size";
    // 工作流的 quality 可能是连续数值（例如 0.1-3），不能按视频分辨率处理。
    if (normalized === "quality") return "quality";
    return aliases[normalized] || source;
}

const workflowDimensionPrefixes = ["", "image", "video", "size", "output", "target", "latent", "frame", "canvas", "source", "resolution", "final"];

function workflowDimensionSource(key: string) {
    if (workflowDimensionPrefixes.some((prefix) => key === `${prefix}width`) || key === "pixelwidth" || key === "widthpixels") return "width";
    if (workflowDimensionPrefixes.some((prefix) => key === `${prefix}height`) || key === "pixelheight" || key === "heightpixels") return "height";
    return "";
}

function inferWorkflowFieldSource(fieldName: string, fieldType: string, capability?: RunningHubCapability) {
    const key = fieldName.toLowerCase().replace(/[\s_-]/g, "");
    const normalizedFieldType = fieldType.trim().toLowerCase();
    if (["text", "prompt", "positive", "positiveprompt"].includes(key)) return "prompt";
    if (key.includes("mask")) return "mask";
    const dimensionSource = workflowDimensionSource(key);
    if (dimensionSource) return dimensionSource;
    if (["ratio", "aspectratio", "imageaspectratio", "imageratio", "videoaspectratio", "videoratio"].includes(key)) return "aspectRatio";
    if (["videoresolution", "videoquality", "vquality"].includes(key)) return "vquality";
    if (["size", "imagesize", "imageresolution"].includes(key)) return "size";
    if (key === "resolution") return capability === "video" ? "vquality" : capability === "image" ? "size" : "";
    if (["batch", "batchsize", "count", "numimages", "numberofimages", "imagecount", "imagescount"].includes(key)) return "count";
    if (key === "quality") return "quality";
    if (["duration", "seconds", "durationseconds", "videoseconds", "videoduration", "videodurationseconds", "videolength", "clipduration"].includes(key)) return "videoSeconds";
    if (["generateaudio", "videogenerateaudio"].includes(key)) return "videoGenerateAudio";
    if (["watermark", "videowatermark"].includes(key)) return "videoWatermark";
    if (key === "audioformat" || (key === "format" && normalizedFieldType === "audio")) return "audioFormat";
    if (["voice", "audiovoice"].includes(key)) return "audioVoice";
    if ((key === "speed" && normalizedFieldType === "audio") || key === "audiospeed") return "audioSpeed";
    if ((key === "instructions" && normalizedFieldType === "audio") || key === "audioinstructions") return "audioInstructions";
    if (["transparentbackground", "transparent"].includes(key)) return "transparentBackground";
    if (normalizedFieldType === "image") return "referenceImage";
    if (normalizedFieldType === "video") return "referenceVideo";
    if (normalizedFieldType === "audio") return "referenceAudio";
    return "";
}

function shouldRepairLegacyWorkflowSource(fieldName: string, source: string, inferredSource: string, capability?: RunningHubCapability) {
    if (!source || !inferredSource || source === inferredSource) return false;
    const key = fieldName.toLowerCase().replace(/[\s_-]/g, "");
    const wasMistakenForMedia = ["referenceImage", "referenceVideo", "referenceAudio"].includes(source);
    if (wasMistakenForMedia && (workflowDimensionSource(key) || inferredSource === "aspectRatio" || inferredSource === "vquality")) return true;
    // 旧版把通用 resolution 固定识别为图片尺寸；视频条目必须恢复为视频清晰度。
    if (key === "resolution" && capability === "video" && source === "size") return true;
    if (key === "resolution" && capability === "image" && source === "vquality") return true;
    if (key === "quality" && source === "vquality") return true;
    return false;
}

export function normalizeWorkflowFieldMappings(value: unknown, capability?: RunningHubCapability): WorkflowFieldMapping[] {
    if (!Array.isArray(value)) return [];
    const fields = value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const raw = item as Record<string, unknown>;
        const nodeId = String(raw.nodeId || raw.node || raw.node_id || "").trim();
        const fieldName = String(raw.fieldName || raw.input || raw.inputName || raw.input_name || "").trim();
        if (!nodeId || !fieldName) return [];
        // source 明确存在但为空，表示用户要求保留工作流默认值；只有旧数据完全缺少来源字段时才自动补绑定。
        const sourceKey = ["source", "bind", "from"].find((key) => Object.prototype.hasOwnProperty.call(raw, key));
        const sourceConfigured = Boolean(sourceKey);
        const configuredSource = sourceKey ? raw[sourceKey] : (raw.bindPrompt === true || raw.bind_prompt === true ? "prompt" : "");
        let source = normalizeWorkflowFieldSourceName(configuredSource, capability);
        const rawSourceAutomatic = raw.sourceAutomatic ?? raw.source_automatic;
        let sourceAutomatic = typeof rawSourceAutomatic === "boolean" ? rawSourceAutomatic : !sourceConfigured && Boolean(source);
        const upstreamAllowed = raw.sourceFromUpstream !== false && raw.source_from_upstream !== false;
        const upstreamExplicit = raw.sourceFromUpstream === true || raw.source_from_upstream === true;
        const fieldType = String(raw.fieldType || raw.type || "").trim();
        const inferredSource = inferWorkflowFieldSource(fieldName, fieldType, capability);
        if (!source && !sourceConfigured && upstreamAllowed) {
            source = inferredSource;
            sourceAutomatic = Boolean(source);
            if (!source && upstreamExplicit && ["text", "prompt", "positiveprompt", "positive"].includes(fieldName.toLowerCase().replace(/[\s_-]/g, ""))) {
                source = "prompt";
                sourceAutomatic = true;
            }
        } else if (shouldRepairLegacyWorkflowSource(fieldName, source, inferredSource, capability)) {
            source = inferredSource;
        }
        // 比例、清晰度、时长等标量必须按 nodeId + fieldName 独立配置。
        // 旧版自动来源会把两个同类字段折叠到同一个全局参数，重新归一化为直接字段值。
        if (sourceAutomatic && !["prompt", "referenceImage", "referenceVideo", "referenceAudio", "mask"].includes(source)) {
            source = "";
            sourceAutomatic = false;
        }
        const fieldValue = raw.fieldValue ?? raw.defaultValue ?? raw.default_value ?? raw.default ?? raw.value;
        const rawOptions = raw.options ?? raw.values ?? raw.choices ?? raw.enum ?? raw.fieldOptions ?? raw.field_options;
        const options = Array.isArray(rawOptions)
            ? rawOptions
            : rawOptions && typeof rawOptions === "object"
                ? ((rawOptions as Record<string, unknown>).choices ?? (rawOptions as Record<string, unknown>).options ?? (rawOptions as Record<string, unknown>).values)
                : undefined;
        const range = workflowFieldRange(rawOptions);
        const min = raw.min ?? raw.minValue ?? raw.min_value ?? range.min;
        const max = raw.max ?? raw.maxValue ?? raw.max_value ?? range.max;
        const step = raw.step ?? raw.stepValue ?? raw.step_value ?? range.step;
        const required = raw.required ?? raw.isRequired ?? raw.is_required;
        const randomEnabled = raw.randomEnabled ?? raw.random_enabled;
        const sourceIndex = Number(raw.sourceIndex ?? raw.source_index ?? raw.index);
        const imageOrder = Number(raw.imageOrder ?? raw.image_order);
        const candidate: WorkflowFieldMapping = {
            ...raw,
            nodeId,
            classType: String(raw.classType || raw.class_type || "").trim() || undefined,
            fieldName,
            id: String(raw.id || `${nodeId}::${fieldName}`),
            source,
            ...(fieldValue !== undefined ? { fieldValue } : {}),
            ...(Array.isArray(options) ? { options } : {}),
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
            ...(step !== undefined ? { step } : {}),
            ...(typeof required === "boolean" ? { required } : {}),
            ...(typeof randomEnabled === "boolean" ? { randomEnabled } : {}),
            sourceAutomatic,
            ...(Number.isFinite(sourceIndex) ? { sourceIndex } : {}),
            ...(Number.isFinite(imageOrder) ? { imageOrder } : {}),
        } as WorkflowFieldMapping;
        const safeToOverride = raw.safeToOverride !== false && raw.safe_to_override !== false && workflowFieldSafeToOverride(candidate);
        const role = workflowFieldRole({ ...candidate, role: String(raw.role || "") });
        const configuredEnabled = typeof raw.enabled === "boolean" ? raw.enabled : role !== "internal";
        const optionsSource = ["workflow", "manual", "preset"].includes(String(raw.optionsSource || raw.options_source || ""))
            ? String(raw.optionsSource || raw.options_source) as WorkflowFieldMapping["optionsSource"]
            : Array.isArray(options) ? "workflow" : undefined;
        return [{ ...candidate, role, safeToOverride, enabled: safeToOverride && configuredEnabled, ...(optionsSource ? { optionsSource } : {}) }];
    });
    let imageOrder = 0;
    let videoOrder = 0;
    let audioOrder = 0;
    return fields.map((field) => {
        if (field.source === "referenceImage") {
            const configuredOrder = Number(field.imageOrder);
            const nextOrder = Number.isInteger(configuredOrder) && configuredOrder > 0 ? configuredOrder : imageOrder + 1;
            imageOrder = Math.max(imageOrder, nextOrder);
            return { ...field, imageOrder: nextOrder, sourceIndex: nextOrder - 1, required: field.required ?? nextOrder === 1 };
        }
        if (field.source === "referenceVideo") {
            const configuredIndex = Number(field.sourceIndex);
            const nextIndex = Number.isInteger(configuredIndex) && configuredIndex >= 0 ? configuredIndex : videoOrder;
            videoOrder = Math.max(videoOrder, nextIndex + 1);
            return { ...field, sourceIndex: nextIndex, required: field.required ?? nextIndex === 0 };
        }
        if (field.source === "referenceAudio") {
            const configuredIndex = Number(field.sourceIndex);
            const nextIndex = Number.isInteger(configuredIndex) && configuredIndex >= 0 ? configuredIndex : audioOrder;
            audioOrder = Math.max(audioOrder, nextIndex + 1);
            return { ...field, sourceIndex: nextIndex, required: field.required ?? nextIndex === 0 };
        }
        if (field.source === "prompt") return { ...field, required: field.required ?? true };
        return field;
    });
}

export function mergeWorkflowFieldMappings(current: unknown, incoming: unknown, capability?: RunningHubCapability) {
    const previousFields = normalizeWorkflowFieldMappings(current, capability);
    const nextFields = normalizeWorkflowFieldMappings(incoming, capability);
    const previousByKey = new Map(previousFields.map((field) => [`${field.nodeId}::${field.fieldName}`, field]));
    const policyKeys: Array<keyof WorkflowFieldMapping> = [
        "label", "enabled",
        "randomEnabled", "source", "sourceAutomatic", "sourceFromUpstream", "sourceIndex",
        "imageOrder", "required", "bindPrompt",
    ];
    return nextFields.map((field) => {
        const previous = previousByKey.get(`${field.nodeId}::${field.fieldName}`);
        if (!previous) return field;
        const merged = { ...field } as WorkflowFieldMapping;
        const target = merged as unknown as Record<string, unknown>;
        const source = previous as unknown as Record<string, unknown>;
        policyKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
        });
        // 字段类型、枚举和数值范围属于上游协议。只有本次拉取未返回时，才沿用本地补充配置。
        if (!field.fieldType && previous.fieldType) merged.fieldType = previous.fieldType;
        if (!field.options?.length && previous.options?.length) {
            merged.options = previous.options;
            merged.optionsSource = previous.optionsSource;
        }
        if (field.min === undefined && previous.min !== undefined) merged.min = previous.min;
        if (field.max === undefined && previous.max !== undefined) merged.max = previous.max;
        if (field.step === undefined && previous.step !== undefined) merged.step = previous.step;
        // 首次获得角色信息时采用服务端的内部参数默认值；之后才保留用户明确的启用选择。
        if (field.role === "internal" && previous.role !== "internal") merged.enabled = field.enabled;
        if (field.safeToOverride === false) merged.enabled = false;
        return merged;
    });
}

function normalizeSavedWorkflowFields(workflow: { fields?: unknown; workflowJson?: Record<string, unknown> }, capability: RunningHubCapability) {
    const schemaFields = workflowVideoFieldsFromJson(workflow.workflowJson);
    return schemaFields.length
        ? mergeWorkflowFieldMappings(workflow.fields, schemaFields, capability)
        : normalizeWorkflowFieldMappings(workflow.fields, capability);
}

function workflowFieldRange(value: unknown) {
    const candidates: Record<string, unknown>[] = [];
    const add = (item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return;
        const record = item as Record<string, unknown>;
        candidates.push(record);
        add(record.range);
    };
    add(value);
    if (Array.isArray(value)) value.forEach(add);
    const read = (keys: string[]) => candidates.map((item) => keys.map((key) => item[key]).find((candidate) => candidate !== undefined)).find((candidate) => candidate !== undefined);
    return { min: read(["min", "minValue", "min_value"]), max: read(["max", "maxValue", "max_value"]), step: read(["step", "stepValue", "step_value"]) };
}

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

export type ComfyBridgeWorkflow = {
    workflowId: string;
    title?: string;
    capability: "image" | "video" | "audio";
    fields?: WorkflowFieldMapping[];
    workflowJson?: Record<string, unknown>;
    workflowGraph?: WorkflowGraphPreview;
};

export type WorkflowGraphPreview = {
    nodes: Array<{ id: string; title?: string; classType?: string }>;
    edges: Array<{ from: string; to: string }>;
};

export type ComfyBridgeConfig = {
    enabled: boolean;
    bridgeId: string;
    comfyUrl: string;
    workflowDir: string;
    workflowId: string;
    capability: "image" | "video" | "audio";
    workflows: ComfyBridgeWorkflow[];
};

// 兼容仍在使用旧目录标识的会话恢复和模型选择器。
export const PUBLIC_MODEL_CATALOG_ID = "managed";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    allowLocalChannel?: boolean;
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
        description?: string;
        icon?: string;
        capability: ModelCapability;
        protocol?: ModelProtocol;
        pricePolicy?: "channel" | "unified";
        billingMode: "fixed_request" | "per_second" | "token";
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
    }>;
    transport?: "backend-channel" | "local-runtime";
    localModels?: DreaminaLocalModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    runningHub: RunningHubConfig;
    comfyBridge: ComfyBridgeConfig;
    /** 仅用于单次生成任务路由，不属于全局渠道启用状态。 */
    taskWorkflowProvider?: "model" | "runninghub" | "comfyui";
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
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const LEGACY_DEFAULT_MODEL_NAMES = new Set(["gpt-image-2", "grok-imagine-video", "gpt-5.5", "gpt-4o-mini-tts"]);

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    // 创作端模型目录只能来自后台公开逻辑模型和用户自定义渠道，不能内置供应商模型。
    channels: [],
    runningHub: { enabled: false, baseUrl: "https://www.runninghub.cn", apiKey: "", walletApiKey: "", uploadApiKey: "", useWallet: false, capability: "image", selectedKind: "workflow", workflowId: "", workflows: [] },
    comfyBridge: { enabled: false, bridgeId: "", comfyUrl: "http://127.0.0.1:8188", workflowDir: "D:\\ComfyUI\\workflows", workflowId: "", capability: "image", workflows: [] },
    taskWorkflowProvider: "model",
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
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
        const local = channel?.localModels?.find((item) => item.id === modelName);
        if (local) return local.modality === capability;
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

export function selectableModelValue(config: AiConfig, value: string, capability?: ModelCapability) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(value, config.channels);
    return normalized && options.includes(normalized) ? normalized : options[0] || "";
}

export function configuredModelMatchesCapability(config: AiConfig, model: string, capability?: ModelCapability) {
    const normalized = normalizeModelOptionValue(model, config.channels);
    if (!normalized) return false;
    return selectableModelValue(config, normalized, capability) === normalized;
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (config.taskWorkflowProvider === "runninghub") {
        const key = config.runningHub.apiKey;
        return Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && key.trim() && config.runningHub.workflowId.trim());
    }
    if (config.taskWorkflowProvider === "comfyui") {
        return Boolean(config.comfyBridge.enabled && config.comfyBridge.bridgeId.trim() && config.comfyBridge.workflowId.trim());
    }
    const channel = resolveModelChannel(config, model);
    if (channel.transport === "local-runtime") return channel.enabled !== false && Boolean(channel.localModels?.some((item) => item.id === modelOptionName(model)));
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
    const runningHubSelectedKind = persistedRunningHub?.selectedKind
        ? normalizeRunningHubWorkflowKind(persistedRunningHub.selectedKind)
        : normalizeRunningHubWorkflowKind(runningHubWorkflows.find((item) => item.workflowId === runningHubWorkflowID)?.kind);
    const persistedComfyBridge = persistedConfig.comfyBridge;
    const comfyBridgeCapability = normalizeRunningHubCapability(persistedComfyBridge?.capability, defaultConfig.comfyBridge.capability);
    const comfyBridgeWorkflows = Array.isArray(persistedComfyBridge?.workflows)
        ? persistedComfyBridge.workflows
            .filter((item): item is ComfyBridgeWorkflow => Boolean(item && typeof item === "object" && String(item.workflowId || "").trim()))
            .map((item) => {
                const capability = normalizeRunningHubCapability(item.capability, comfyBridgeCapability);
                return {
                    ...item,
                    workflowId: String(item.workflowId || "").trim(),
                    capability,
                    fields: normalizeSavedWorkflowFields(item, capability),
                };
            })
        : [];
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
        comfyBridge: {
            ...defaultConfig.comfyBridge,
            ...(persistedComfyBridge || {}),
            capability: comfyBridgeCapability,
            workflowId: String(persistedComfyBridge?.workflowId || "").trim(),
            workflows: comfyBridgeWorkflows,
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
            channelMode: "local" as const,
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
            audioInstructions: config.audioInstructions || "",
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
    const catalogState = useLocalDreaminaModelStore((state) => state.state);
    const dreaminaModels = useLocalDreaminaModelStore((state) => state.models);
    return useMemo(() => effectiveConfigWithDreamina(effectiveConfigForCustomChannels(config, customChannelsEnabled), catalogState, dreaminaModels), [catalogState, config, customChannelsEnabled, dreaminaModels]);
}

export function effectiveConfigForCustomChannels(config: AiConfig, customChannelsEnabled: boolean): AiConfig {
    if (customChannelsEnabled) return config;
    const channels = config.channels.filter((channel) => channel.scope === "system" || channel.transport === "local-runtime");
    return normalizeConfigSnapshot({ config: { ...config, channels } }).config;
}

export function effectiveConfigWithDreamina(config: AiConfig, catalogState: "idle" | "loading" | "ready" | "error", dreaminaModels: DreaminaLocalModel[]): AiConfig {
    if (catalogState !== "ready" || !dreaminaModels.length) return { ...config, channelMode: "local" };
    const channel: ModelChannel = {
        id: "local:dreamina-cli",
        name: "官方即梦 CLI",
        baseUrl: "",
        apiKey: "",
        apiFormat: "openai",
        models: dreaminaModels.map((item) => item.id),
        scope: "user",
        enabled: true,
        transport: "local-runtime",
        localModels: dreaminaModels,
    };
    const channels = [...config.channels.filter((item) => item.id !== channel.id), channel];
    const models = modelOptionsFromChannels(channels);
    return {
        ...config,
        channelMode: "local",
        channels,
        models,
        imageModels: filterModelsByCapability(models, "image", channels),
        videoModels: filterModelsByCapability(models, "video", channels),
        textModels: filterModelsByCapability(models, "text", channels),
        audioModels: filterModelsByCapability(models, "audio", channels),
    };
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    const interfaceType = normalizeChannelInterfaceType(channel?.interfaceType);
    const providedBaseUrl = channel?.baseUrl?.trim();
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: providedBaseUrl || (interfaceType ? defaultBaseUrlForChannelInterface(interfaceType) : defaultBaseUrlForApiFormat(apiFormat)),
        allowLocalChannel: channel?.allowLocalChannel === true,
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

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const local = /^local:dreamina-cli:([A-Za-z0-9][A-Za-z0-9._:-]{0,119})$/.exec(value.trim());
    if (local) return { channelId: "local:dreamina-cli", model: local[1] };
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelDisplayName(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    const channel = resolveModelChannel(config, value);
    const displayName = channel.modelCosts?.find((item) => item.model === model)?.displayName?.trim();
    if (displayName) return displayName;
    return channel.scope === "system" ? "系统模型" : model;
}

export function modelIcon(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    return resolveModelChannel(config, value).modelCosts?.find((item) => item.model === model)?.icon || "";
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return modelDisplayName(config, value);
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const displayName = modelDisplayName(config, value);
    // 平台前台模型只展示公开名称；供应来源和内部目录适配器不属于创作端信息。
    if (!channel || channel.scope === "system") return displayName;
    return `${displayName}（${channel.name}）`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(
        channels.filter((channel) => channel.enabled !== false).flatMap((channel) =>
            channel.models
                .map(normalizeRawModelName)
                .filter(Boolean)
                .filter((model) => channel.scope !== "system" || hasSystemModelPrice(channel, model))
                .map((model) => (channel.transport === "local-runtime" ? `local:dreamina-cli:${model}` : encodeChannelModel(channel.id, model))),
        ),
    );
}

export function hasSystemModelPrice(channel: ModelChannel, model: string) {
    if (channel.scope !== "system") return true;
    // 价格字段已由后端按“非负数”校验；0 表示免费模型，不能在目录重建时被过滤。
    const configured = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    return channel.modelCosts?.some((item) => {
        if (item.model !== model) return false;
        const tiers = item.logicalPriceTiers || [];
        if (tiers.length) {
            return tiers.some((tier) => tier.billingMode === "token"
                ? [tier.inputTokenPriceMicrocredits, tier.outputTokenPriceMicrocredits, tier.cachedTokenPriceMicrocredits].every(configured)
                : configured(tier.unitPriceMicrocredits));
        }
        if (item.billingMode === "token") {
            return [item.inputTokenPriceMicrocredits, item.outputTokenPriceMicrocredits, item.cachedTokenPriceMicrocredits].every(configured);
        }
        return configured(item.unitPriceMicrocredits);
    }) === true;
}

export function normalizeModelOptionValue(value: unknown, channels: ModelChannel[]) {
    const model = typeof value === "string" ? value.trim() : "";
    if (!normalizeRawModelName(model)) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        const resolved = channel?.modelAliases?.[decoded.model] || decoded.model;
        return channel && channel.models.includes(resolved) ? encodeChannelModel(channel.id, resolved) : "";
    }
    const channel = channels.find((item) => item.models.includes(model) || Boolean(item.modelAliases?.[model])) || channels[0];
    const resolved = channel?.modelAliases?.[model] || model;
    return channel && channel.models.includes(resolved) ? encodeChannelModel(channel.id, resolved) : "";
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
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, channel.interfaceType || "auto", channel.allowLocalChannel === true ? "local:1" : "local:0", JSON.stringify(channel.headers || [])].join("\n");
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const model = modelOptionName(value || config.model);
    const modelProtocol = channel.modelCosts?.find((item) => item.model === model)?.protocol;
    const interfaceType = modelProtocol || channel.interfaceType;
    return projectDesktopLocalChannelRuntime({
        ...config,
        model,
        baseUrl: channel.baseUrl,
        allowLocalChannel: channel.allowLocalChannel === true,
        apiKey: channel.apiKey,
        secretKey: channel.secretKey,
        headers: channel.headers,
        apiFormat: interfaceType ? (interfaceType === "gemini-veo" || interfaceType === "gemini-image" ? ("gemini" as const) : interfaceType === "claude-api" ? ("claude" as const) : ("openai" as const)) : channel.apiFormat,
        interfaceType,
        channelId: channel.scope === "system" ? channel.id : "",
    });
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

function uniqueModelOptions(models: string[]) {
    return Array.from(
        new Set(
            (models || [])
                .filter((model): model is string => typeof model === "string")
                .map((model) => model.trim())
                .filter(Boolean),
        ),
    );
}

function normalizeRawModelName(value: unknown) {
    if (typeof value !== "string") return "";
    const model = modelOptionName(value).trim();
    return model && model !== "undefined" && model !== "null" ? model : "";
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = resolveBackendApiUrl(baseUrl).replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const requestPath = path.startsWith("/") ? path : `/${path}`;
    if (isSystemProxyBaseUrl(normalizedBaseUrl)) return `${normalizedBaseUrl}${requestPath}`;

    const knownPrefixes = ["/api/plan/v3", "/api/v3", "/v1beta", "/v1", "/v2", "/v3"];
    const requestPrefixFor = (value: string) => knownPrefixes.find((prefix) => {
        const lower = value.toLowerCase();
        return lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`) || lower.startsWith(`${prefix}#`);
    }) || "";
    const basePrefixFor = (value: string) => knownPrefixes.find((prefix) => {
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
