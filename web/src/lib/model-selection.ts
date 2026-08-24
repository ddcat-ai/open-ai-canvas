import { defaultImageCapabilityConfig, modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, STANDARD_IMAGE_SIZE_VALUES, videoDurationAllowed, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export type ModelInputSummary = {
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
    characterCount: number;
};

export type ModelRequirements = {
    capability?: ModelCapability;
    input?: ModelInputSummary;
    videoOperation?: string;
    videoSeconds?: string;
    imageSize?: string;
    options?: Record<string, unknown>;
};

export type DisplayModelGroup = {
    key: string;
    label: string;
    models: string[];
};

export type ModelReferenceLimits = {
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
};

export function groupModelsByDisplayName(config: AiConfig, models: string[]): DisplayModelGroup[] {
    const groups = new Map<string, DisplayModelGroup>();
    models.forEach((model) => {
        const channel = resolveModelChannel(config, model);
        const label = configuredModelDisplayName(config, model);
        const key = `${channel.id}\u0000${label.toLocaleLowerCase()}`;
        const current = groups.get(key);
        if (current) current.models.push(model);
        else groups.set(key, { key, label, models: [model] });
    });
    return Array.from(groups.values());
}

export function configuredModelDisplayName(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    const channel = resolveModelChannel(config, value);
    return channel.modelCosts?.find((item) => item.model === model)?.displayName?.trim() || model;
}

export function modelCompatibilityError(config: AiConfig, model: string, requirements?: ModelRequirements) {
    const capability = requirements?.capability;
    if (!capability) return "";
    const input = requirements?.input;
    const visualInputCount = input ? input.imageCount + input.characterCount : 0;
    const channel = resolveModelChannel(config, model);
    const logicalCost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const logicalSpecs = logicalCost?.logicalCapabilityProfiles?.length ? logicalCost.logicalCapabilityProfiles : logicalCost?.logicalCapabilitySpec ? [logicalCost.logicalCapabilitySpec] : [];
    if (logicalSpecs.length) {
        const publicOptionNames = logicalCost?.logicalCapabilitySpec?.options || {};
        const logicalRequirements = {
            ...requirements,
            options: Object.fromEntries(Object.entries(requirements.options || {}).filter(([name]) => Boolean(publicOptionNames[name]))),
        };
        const errors = logicalSpecs.map((spec) => logicalModelCompatibilityError(spec, logicalRequirements, visualInputCount));
        return errors.some((error) => !error) ? "" : errors[0] || "当前输入不受支持";
    }

    if (capability === "image") {
        const image = modelCapabilityConfigFor(config, model).image!;
        // 尺寸兼容不依赖输入摘要：无输入时（如画布重试/工具链）也要按尺寸过滤组内模型。
        if (requirements.imageSize && !image.size.allowCustom && !image.size.values.includes(requirements.imageSize)) return "不支持当前尺寸";
        if (!input) return "";
        if (input.videoCount > 0) return "图片模型不支持参考视频";
        if (input.audioCount > 0) return "图片模型不支持参考音频";
        if (visualInputCount > image.references.maxImages) return `最多支持 ${image.references.maxImages} 张参考图`;
        return "";
    }

    if (capability === "video") {
        const profile = modelCapabilityConfigFor(config, model).video!;
        if (requirements.videoSeconds && !videoDurationAllowed(profile, Number(requirements.videoSeconds))) return "不支持当前视频时长";
        if (!input) return "";
        if (visualInputCount > profile.references.maxImages) return `最多支持 ${profile.references.maxImages} 张参考图`;
        if (input.videoCount > profile.references.maxVideos) return `最多支持 ${profile.references.maxVideos} 个参考视频`;
        if (input.audioCount > profile.references.maxAudios) return `最多支持 ${profile.references.maxAudios} 个参考音频`;
        const operation = resolveVideoOperation(input, requirements.videoOperation);
        if (operation !== "concat" && !profile.operations.includes(operation)) return `不支持${videoOperationLabel(operation)}`;
        return "";
    }

    if (!input) return "";

    if (capability === "text") {
        return input.audioCount > 0 ? "文本模型不支持参考音频" : "";
    }

    if (input.characterCount > 1) return "角色配音一次只能引用一个角色卡";
    return input.imageCount > 0 || input.videoCount > 0 || input.audioCount > 0 ? "音频模型只接受文本或单个角色卡输入" : "";
}

export function modelRequestOptions(config: AiConfig, capability: ModelCapability) {
    switch (capability) {
        case "image":
            return { size: config.size, quality: config.quality, transparentBackground: config.transparentBackground === "true", count: Number(config.count) };
        case "video":
            return { size: config.size, videoSeconds: Number(config.videoSeconds), vquality: config.vquality, videoGenerateAudio: config.videoGenerateAudio === "true", videoWatermark: config.videoWatermark === "true" };
        case "audio":
            return { audioVoice: config.audioVoice, audioFormat: config.audioFormat, audioSpeed: Number(config.audioSpeed) };
        default:
            return {};
    }
}

function logicalModelCompatibilityError(spec: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalCapabilitySpec"]>, requirements: ModelRequirements, visualInputCount: number) {
    if (requirements.capability && spec.capability !== requirements.capability) return "不支持当前生成类型";
    const input = requirements.input;
    const counts: Record<string, number> = {
        text: 0,
        image: visualInputCount,
        video: input?.videoCount || 0,
        audio: input?.audioCount || 0,
    };
    for (const [kind, count] of Object.entries(counts)) {
        const constraint = spec.inputs?.[kind];
        if (!constraint && count > 0) return `不支持${kind}输入`;
        if (constraint && (count < constraint.min || count > constraint.max)) return `${kind}输入需为 ${constraint.min}-${constraint.max} 个`;
    }
    const operation = requirements.capability === "video" && input ? resolveVideoOperation(input, requirements.videoOperation) : requirements.videoOperation;
    if (operation && spec.operations?.length && !spec.operations.includes(operation)) return "不支持当前生成模式";
    // 图片创作状态也会携带全局默认视频时长；这个字段只对视频模型有意义，
    // 不能把它拼进图片逻辑模型的能力匹配，否则图片模型会被误判为“不支持当前时长”。
    const options = {
        ...requirements.options,
        ...(requirements.capability === "video" && requirements.videoSeconds ? { videoSeconds: requirements.videoSeconds } : {}),
        ...(requirements.capability === "image" && requirements.imageSize ? { size: requirements.imageSize } : {}),
    };
    for (const [name, value] of Object.entries(options)) {
        if (value === undefined || value === null || value === "") continue;
        const constraint = spec.options?.[name];
        if (!constraint || !logicalOptionMatches(name, constraint, value)) return logicalOptionError(name);
    }
    return "";
}

function logicalOptionMatches(name: string, constraint: { values?: unknown[]; min?: number; max?: number; step?: number }, value: unknown) {
    if (constraint.values?.length) {
        const requested = normalizeLogicalOptionValue(name, value);
        return constraint.values.some((candidate) => normalizeLogicalOptionValue(name, candidate) === requested);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    if (constraint.min !== undefined && numeric < constraint.min) return false;
    if (constraint.max !== undefined && numeric > constraint.max) return false;
    if (constraint.step !== undefined && constraint.min !== undefined) return Math.abs((numeric - constraint.min) / constraint.step - Math.round((numeric - constraint.min) / constraint.step)) < 1e-9;
    return true;
}

function normalizeLogicalOptionValue(name: string, value: unknown) {
    const normalized = String(value).trim().toLowerCase();
    if (name !== "vquality" && name !== "resolution") return normalized;
    if (normalized === "low") return "480p";
    if (["auto", "medium", "high"].includes(normalized)) return "720p";
    if (normalized === "2k") return "1440p";
    if (normalized === "4k") return "2160p";
    const resolution = normalized.replace(/p$/i, "");
    return resolution ? `${resolution}p` : "";
}

function logicalOptionError(name: string) {
    const label: Record<string, string> = {
        size: "尺寸",
        quality: "质量",
        transparentBackground: "透明背景",
        count: "输出数量",
        videoSeconds: "时长",
        vquality: "分辨率",
        videoGenerateAudio: "同步音频",
        videoWatermark: "水印设置",
        audioVoice: "音色",
        audioFormat: "音频格式",
        audioSpeed: "语速",
    };
    return `不支持当前${label[name] || name}`;
}

export function compatibleModelInGroup(config: AiConfig, models: string[], requirements?: ModelRequirements, preferred?: string) {
    const compatible = models.filter((model) => !modelCompatibilityError(config, model, requirements));
    if (!compatible.length) return "";
    if (compatible.length === 1) return compatible[0];
    const priceOf = (model: string) => {
        const channel = resolveModelChannel(config, model);
        const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
        return cost && Number.isFinite(cost.unitPriceMicrocredits) ? cost.unitPriceMicrocredits : Number.POSITIVE_INFINITY;
    };
    return compatible.sort((left, right) => priceOf(left) - priceOf(right) || (left === preferred ? -1 : right === preferred ? 1 : 0))[0];
}

export function resolveCompatibleModel(config: AiConfig, selected: string, requirements?: ModelRequirements) {
    if (!requirements?.capability) return selected;
    const options = selectableModelsByCapability(config, requirements.capability);
    if (!options.length) return selected;
    const selectedGroup = groupModelsByDisplayName(config, options).find((group) => group.models.includes(selected));
    if (!selectedGroup) return selected;
    return compatibleModelInGroup(config, selectedGroup.models, requirements, selected);
}

// 同显示名分组的模型族：尺寸/比例/分辨率选项取组内全部模型配置的并集，
// 让用户能看到并选择任意成员支持的能力，选中后由兼容路由落到具体模型。
// 质量、透明背景等其余能力取当前选中（路由后）模型的配置，与创作页面一致。
export function mergedImageCapabilityConfig(config: AiConfig, selected: string): ImageCapabilityConfig {
    const options = selectableModelsByCapability(config, "image");
    const group = options.length ? groupModelsByDisplayName(config, options).find((item) => item.models.includes(selected)) : undefined;
    const models = group?.models.length ? group.models : [selected];
    const selectedProfile = modelCapabilityConfigFor(config, selected).image;
    const profiles = models.map((model) => modelCapabilityConfigFor(config, model).image).filter((profile): profile is ImageCapabilityConfig => Boolean(profile));
    if (profiles.length <= 1) return selectedProfile || defaultImageCapabilityConfig();
    const concreteValues = Array.from(new Set(profiles.flatMap((profile) => profile.size.values).filter((value) => value !== "*")));
    const allowCustom = profiles.some((profile) => profile.size.allowCustom || profile.size.values.includes("*"));
    const values = concreteValues.length ? concreteValues : allowCustom ? [...STANDARD_IMAGE_SIZE_VALUES] : [];
    const base = selectedProfile || profiles[0];
    return { ...base, size: { ...base.size, values, allowCustom } };
}

// 切换模型后初始化图片参数为该模型能力默认值，避免旧参数在目标模型族不兼容导致无法切换。
export function defaultImageParamsForModel(config: AiConfig, model: string): Pick<AiConfig, "size" | "quality" | "transparentBackground"> {
    const image = modelCapabilityConfigFor(config, model).image;
    if (!image) return { size: "1:1", quality: "auto", transparentBackground: "false" };
    const sizeValues = image.size.values.filter((value) => value !== "*");
    const sizeDefault = image.size.default !== "*" && image.size.default ? image.size.default : sizeValues[0] || "1:1";
    return {
        size: sizeDefault,
        quality: image.quality.default || "auto",
        transparentBackground: String(image.transparentBackground.default ?? false),
    };
}


export type ModelGenerationDefaults = Pick<AiConfig, "size" | "quality" | "transparentBackground" | "count" | "videoSeconds" | "vquality" | "videoGenerateAudio" | "videoWatermark">;

export function resolveModelGenerationDefaults(
    config: AiConfig,
    model: string,
    capability: "image" | "video" | undefined,
    explicit: Partial<ModelGenerationDefaults> = {},
    fallback: Partial<ModelGenerationDefaults> = {},
): Partial<ModelGenerationDefaults> {
    if (!capability) return {};
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const isManagedModel = Boolean(cost?.logicalModelId || cost?.logicalCapabilitySpec);
    const source = (key: keyof ModelGenerationDefaults) => explicit[key] ?? (isManagedModel ? undefined : fallback[key]);
    const profile = modelCapabilityConfigFor(config, model);

    if (capability === "image" && profile.image) {
        const normalized = normalizeImageValue(profile.image, {
            size: source("size"),
            quality: source("quality"),
            count: source("count"),
            transparentBackground: source("transparentBackground"),
        });
        return normalized;
    }

    if (capability === "video" && profile.video) {
        const normalized = normalizeVideoValue(profile.video, {
            seconds: source("videoSeconds"),
            ratio: source("size"),
            resolution: source("vquality"),
        });
        return {
            videoSeconds: normalized.seconds,
            size: normalized.ratio,
            vquality: normalized.resolution.replace(/p$/i, ""),
            videoGenerateAudio: source("videoGenerateAudio") ?? String(profile.video.generateAudio.default),
            videoWatermark: source("videoWatermark") ?? String(profile.video.watermark.default),
        };
    }

    return {};
}

export function maxModelInputCapacity(config: AiConfig, capability: "image" | "video", kind: "image" | "video" | "audio") {
    const options = selectableModelsByCapability(config, capability);
    if (!options.length) return null;
    return options.reduce((maximum, model) => {
        const profile = modelCapabilityConfigFor(config, model);
        const value =
            capability === "image" ? (kind === "image" ? profile.image!.references.maxImages : 0) : kind === "image" ? profile.video!.references.maxImages : kind === "video" ? profile.video!.references.maxVideos : profile.video!.references.maxAudios;
        return Math.max(maximum, value);
    }, 0);
}

export function modelGroupReferenceLimits(config: AiConfig, selected: string, capability: ModelCapability, requirements?: ModelRequirements): ModelReferenceLimits | undefined {
    if (capability !== "image" && capability !== "video") return undefined;
    const options = selectableModelsByCapability(config, capability);
    const selectedGroup = groupModelsByDisplayName(config, options).find((group) => group.models.includes(selected));
    const groupModels = selectedGroup?.models || (selected ? [selected] : []);
    if (!groupModels.length) return undefined;
    const compatibleModels = requirements ? groupModels.filter((model) => !modelCompatibilityError(config, model, requirements)) : groupModels;
    const models = compatibleModels.length ? compatibleModels : groupModels;
    return models.reduce<ModelReferenceLimits>(
        (limits, model) => {
            const profile = modelCapabilityConfigFor(config, model);
            if (capability === "image") {
                return { ...limits, maxImages: Math.max(limits.maxImages, profile.image!.references.maxImages) };
            }
            const references = profile.video!.references;
            return {
                maxImages: Math.max(limits.maxImages, references.maxImages),
                maxVideos: Math.max(limits.maxVideos, references.maxVideos),
                maxAudios: Math.max(limits.maxAudios, references.maxAudios),
            };
        },
        { maxImages: 0, maxVideos: 0, maxAudios: 0 },
    );
}

export function inferVideoOperation(input: ModelInputSummary) {
    const visualInputCount = input.imageCount + input.characterCount;
    // 纯音频参考使用独立能力；音频与图片、角色或视频组合时属于全模态参考，
    // 不能把组合请求误路由到只支持 audio_to_video 的细分模型。
    if (input.audioCount > 0) return visualInputCount > 0 || input.videoCount > 0 ? "reference_to_video" : "audio_to_video";
    if (input.videoCount > 0 || visualInputCount > 2) return "reference_to_video";
    if (visualInputCount > 0) return "image_to_video";
    return "text_to_video";
}

export function resolveVideoOperation(input: ModelInputSummary, storedOperation?: string) {
    if (storedOperation && !["text_to_video", "image_to_video", "audio_to_video", "extend", "reference_to_video"].includes(storedOperation)) return storedOperation;
    return inferVideoOperation(input);
}

function videoOperationLabel(operation: string) {
    if (operation === "text_to_video") return "文生视频";
    if (operation === "image_to_video") return "图生视频";
    if (operation === "audio_to_video") return "音频生视频";
    if (operation === "reference_to_video") return "全模态参考";
    if (operation === "extend") return "视频续写";
    return "当前生成模式";
}
