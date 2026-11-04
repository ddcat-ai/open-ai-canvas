import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { resolveImageParameters } from "@/lib/image-parameters";
import { modelProtocolCapability, protocolForModelCatalog, type ModelProtocol, type ModelProtocolDefinition, type ProtocolCapability } from "@/lib/model-protocols";
import { findProtocolWorkflow, resolveWorkflowVideoScreenSpec, workflowVideoScreenSpec } from "@/lib/video-screen-specs";
import type { ModelChannel } from "@/stores/use-config-store";

export type ChannelModelCatalogOption = { value: string; label?: string };

export type ChannelModelCatalogItem = {
    id: string;
    displayName?: string;
    modelType?: "text" | "image" | "video" | "audio";
    supportedEndpointTypes?: string[];
    defaultParameters?: {
        aspectRatio?: string;
        durationSeconds?: string;
        resolution?: string;
    };
    options?: {
        aspectRatio?: ChannelModelCatalogOption[];
        durationSeconds?: ChannelModelCatalogOption[];
        resolution?: ChannelModelCatalogOption[];
    };
    supportsImages?: boolean;
    minImages?: number;
    maxImages?: number;
};

type ChannelModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

// 默认能力 / 默认协议 / 默认地址改读已安装插件的声明（capabilities / baseUrl），
// 写死的模板只在读不到插件声明时使用（没装插件，或插件没声明该地址/能力）。
export type DeclaredChannelDefaults = { capability?: ProtocolCapability; protocol?: ModelProtocol; baseUrl?: string };

function normalizeDeclaredBaseUrl(value: string | undefined) {
    return (value || "").trim().replace(/\/+$/u, "");
}

function installedProtocolDeclarations(protocols: readonly ModelProtocolDefinition[] | undefined) {
    return (protocols || []).filter((item) => item.enabled !== false && Boolean(item.value));
}

/** 声明地址与渠道地址一致的已安装插件协议；地址为空或无匹配时返回空。 */
export function declaredProtocolsForAddress(protocols: readonly ModelProtocolDefinition[] | undefined, baseUrl: string) {
    const wanted = normalizeDeclaredBaseUrl(baseUrl);
    if (!wanted) return [];
    return installedProtocolDeclarations(protocols).filter((item) => normalizeDeclaredBaseUrl(item.baseUrl) === wanted);
}

/** 按插件声明的 capabilities 取该能力下的默认协议，地址与渠道一致者优先。 */
export function declaredProtocolForCapability(protocols: readonly ModelProtocolDefinition[] | undefined, capability: ProtocolCapability | undefined, baseUrl = ""): ModelProtocol | undefined {
    if (!capability) return undefined;
    return declaredProtocolsForAddress(protocols, baseUrl).find((item) => item.capability === capability)?.value;
}

/** 渠道地址对应的插件声明：能力唯一时才给出默认能力/协议，否则留空交给调用方的内置逻辑。 */
export function declaredChannelDefaults(protocols: readonly ModelProtocolDefinition[] | undefined, baseUrl = ""): DeclaredChannelDefaults {
    const declared = declaredProtocolsForAddress(protocols, baseUrl);
    const capabilities = Array.from(new Set(declared.map((item) => item.capability)));
    if (capabilities.length !== 1) return {};
    const capability = capabilities[0]!;
    const protocol = declared.find((item) => item.capability === capability)?.value;
    const address = normalizeDeclaredBaseUrl(declared[0]?.baseUrl);
    return { capability, ...(protocol ? { protocol } : {}), ...(address ? { baseUrl: address } : {}) };
}

/** 能力配置优先套用插件声明（imageParameters / workflows）；插件没声明时保持按协议名生成的默认画像。 */
export function declaredCapabilityConfig(config: ModelCapabilityConfig, options: { capability: ProtocolCapability; model?: string; protocol?: ModelProtocol; protocols?: readonly ModelProtocolDefinition[] }): ModelCapabilityConfig {
    const definition = options.protocols?.find((item) => item.value === options.protocol);
    if (!definition) return config;
    const model = (options.model || "").trim();
    if (options.capability === "image" && definition.imageParameters?.length && config.image) {
        return { ...config, image: resolveImageParameters(config.image, definition.imageParameters, model) };
    }
    if (options.capability === "video" && config.video && definition.workflows?.length) {
        const workflow = findProtocolWorkflow(definition.workflows, options.protocol, model);
        // 工作流没声明分辨率档时不覆盖现有档位，避免把手工配置冲掉。
        if (workflow && workflowVideoScreenSpec(workflow).resolutions.length) return { ...config, video: resolveWorkflowVideoScreenSpec(config.video, workflow) };
    }
    return config;
}

export function sanitizeChannelModelCatalogItem(value: unknown): ChannelModelCatalogItem | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const id = stringValue(record.id);
    if (!id) return null;
    const modelType = stringValue(record.modelType).toLowerCase();
    const defaultParameters = objectValue(record.defaultParameters);
    const options = objectValue(record.options);
    const normalizedDefaults = defaultParameters
        ? {
              ...(stringValue(defaultParameters.aspectRatio) ? { aspectRatio: stringValue(defaultParameters.aspectRatio) } : {}),
              ...(stringValue(defaultParameters.durationSeconds) ? { durationSeconds: stringValue(defaultParameters.durationSeconds) } : {}),
              ...(stringValue(defaultParameters.resolution) ? { resolution: stringValue(defaultParameters.resolution) } : {}),
          }
        : undefined;
    const normalizedOptions = options
        ? {
              ...(catalogOptions(options.aspectRatio).length ? { aspectRatio: catalogOptions(options.aspectRatio) } : {}),
              ...(catalogOptions(options.durationSeconds).length ? { durationSeconds: catalogOptions(options.durationSeconds) } : {}),
              ...(catalogOptions(options.resolution).length ? { resolution: catalogOptions(options.resolution) } : {}),
          }
        : undefined;
    return compactCatalogItem({
        id,
        displayName: stringValue(record.displayName),
        modelType: ["text", "image", "video", "audio"].includes(modelType) ? (modelType as ChannelModelCatalogItem["modelType"]) : undefined,
        supportedEndpointTypes: stringArray(record.supportedEndpointTypes),
        defaultParameters: normalizedDefaults,
        options: normalizedOptions,
        supportsImages: typeof record.supportsImages === "boolean" ? record.supportsImages : undefined,
        minImages: nonNegativeInteger(record.minImages),
        maxImages: nonNegativeInteger(record.maxImages),
    });
}

export function mergeFetchedChannelModelCosts(channel: ModelChannel, catalog: ChannelModelCatalogItem[], declaredProtocols: readonly ModelProtocolDefinition[] = []): ChannelModelCost[] {
    const existingByModel = new Map((channel.modelCosts || []).map((cost) => [cost.model, cost]));
    const next: ChannelModelCost[] = [];
    for (const item of catalog) {
        const existing = existingByModel.get(item.id);
        const inferredProtocol = protocolForModelCatalog(item.supportedEndpointTypes);
        const inferredCapability = modelProtocolCapability(inferredProtocol) || item.modelType;
        if (existing) {
            const protocol = inferredProtocol || existing.protocol;
            const capability = inferredCapability || existing.capability;
            const capabilityChanged = capability !== existing.capability;
            const patchCapabilityConfig = hasCatalogCapabilityConfig(item) && (capability === "image" || capability === "video");
            const capabilityConfig = patchCapabilityConfig
                ? catalogCapabilityConfig(item, protocol || channel.interfaceType, capability, capabilityChanged ? undefined : existing.capabilityConfig, false)
                : capabilityChanged
                  ? undefined
                  : existing.capabilityConfig;
            next.push({
                ...existing,
                ...(item.displayName ? { displayName: item.displayName } : {}),
                capability,
                ...(inferredProtocol ? { protocol: inferredProtocol } : {}),
                ...(patchCapabilityConfig || capabilityChanged ? { capabilityConfig } : {}),
            });
            continue;
        }

        const capability = inferredCapability || modelProtocolCapability(channel.interfaceType);
        // 新模型的默认协议改读已安装插件声明，读不到才用写死的协议模板。
        const protocol = inferredProtocol || declaredProtocolForCapability(declaredProtocols, capability, channel.baseUrl) || protocolTemplateForNewCatalogModel(capability, channel.interfaceType);
        if (!protocol || !capability) continue;
        const capabilityConfig = capability === "image" || capability === "video" ? catalogCapabilityConfig(item, protocol, capability, undefined, true) : undefined;
        next.push({
            model: item.id,
            ...(item.displayName ? { displayName: item.displayName } : {}),
            capability,
            protocol,
            billingMode: "fixed_request",
            unitPriceMicrocredits: 0,
            ...(capabilityConfig ? { capabilityConfig } : {}),
        });
    }
    return next;
}

// 写死的协议模板：只在读不到插件声明（没装插件 / 插件没声明该能力）时使用。
// 有插件声明时优先用 providers[].capabilities，见 declaredProtocolForCapability。
function protocolTemplateForNewCatalogModel(capability: ChannelModelCost["capability"] | undefined, channelProtocol: ModelProtocol | undefined): ModelProtocol | undefined {
    if (!capability) return channelProtocol;
    if (modelProtocolCapability(channelProtocol) === capability) return channelProtocol;
    const templates: Record<ChannelModelCost["capability"], ModelProtocol> = { text: "chat-completion", image: "openai-image", video: "newapi", audio: "openai-audio" };
    return templates[capability];
}

function hasCatalogCapabilityConfig(item: ChannelModelCatalogItem) {
    return Boolean(item.defaultParameters || item.options || item.supportsImages !== undefined || item.minImages !== undefined || item.maxImages !== undefined);
}

function catalogCapabilityConfig(item: ChannelModelCatalogItem, protocol: ModelProtocol | undefined, capability: "image" | "video", existing: ModelCapabilityConfig | undefined, isNew: boolean): ModelCapabilityConfig {
    const fallback = defaultModelCapabilityConfig(protocol, item.id);
    const existingProfile = capability === "image" ? existing?.image : existing?.video;
    const config = structuredClone(existingProfile ? existing! : fallback);
    if (capability === "image") {
        if (item.supportsImages === false) config.image!.references.maxImages = 0;
        else if (item.maxImages !== undefined) config.image!.references.maxImages = item.maxImages;
        return config;
    }

    const video = config.video!;
    if (isNew) {
        video.resolutions = [];
        video.defaultResolution = "";
    }
    const durations = uniqueNumbers(optionValues(item.options?.durationSeconds));
    const defaultDuration = positiveNumber(item.defaultParameters?.durationSeconds);
    if (durations.length) {
        video.duration = { selection: "enum", values: durations, default: durations.includes(defaultDuration) ? defaultDuration : durations[0]! };
    } else if (defaultDuration > 0) {
        video.duration = { selection: "enum", values: [defaultDuration], default: defaultDuration };
    }
    const ratios = optionValues(item.options?.aspectRatio);
    const defaultRatio = item.defaultParameters?.aspectRatio?.trim() || "";
    if (ratios.length) {
        video.ratios = ratios;
        video.defaultRatio = ratios.includes(defaultRatio) ? defaultRatio : ratios[0]!;
    } else if (defaultRatio) {
        video.ratios = [defaultRatio];
        video.defaultRatio = defaultRatio;
    }

    // A catalog-backed video may only emit resolution_name when the provider
    // explicitly advertises compatible values. An empty list means omit it.
    const resolutions = optionValues(item.options?.resolution);
    const defaultResolution = item.defaultParameters?.resolution?.trim() || "";
    if (resolutions.length || defaultResolution) {
        video.resolutions = resolutions.length ? resolutions : [defaultResolution];
        video.defaultResolution = video.resolutions.includes(defaultResolution) ? defaultResolution : video.resolutions[0] || "";
    }

    if (item.supportsImages === false || item.maxImages === 0) {
        video.references.minImages = 0;
        video.references.maxImages = 0;
        video.operations = video.operations.filter((operation) => operation !== "image_to_video");
        if (!video.operations.length) video.operations = ["text_to_video"];
        video.defaultOperation = video.operations.includes(video.defaultOperation) ? video.defaultOperation : video.operations[0]!;
    } else {
        if (item.maxImages !== undefined) video.references.maxImages = item.maxImages;
        if (item.minImages !== undefined) video.references.minImages = item.minImages;
        if (video.references.minImages > 0) {
            video.references.maxImages = Math.max(video.references.minImages, video.references.maxImages);
            video.operations = video.operations.filter((operation) => operation !== "text_to_video");
            if (!video.operations.includes("image_to_video")) video.operations.unshift("image_to_video");
            video.defaultOperation = "image_to_video";
        }
    }
    return config;
}

function compactCatalogItem(item: ChannelModelCatalogItem): ChannelModelCatalogItem {
    const defaultParameters = item.defaultParameters && Object.values(item.defaultParameters).some(Boolean) ? item.defaultParameters : undefined;
    const options = item.options && Object.values(item.options).some((values) => values?.length) ? item.options : undefined;
    return {
        id: item.id,
        ...(item.displayName ? { displayName: item.displayName } : {}),
        ...(item.modelType ? { modelType: item.modelType } : {}),
        ...(item.supportedEndpointTypes?.length ? { supportedEndpointTypes: item.supportedEndpointTypes } : {}),
        ...(defaultParameters ? { defaultParameters } : {}),
        ...(options ? { options } : {}),
        ...(item.supportsImages !== undefined ? { supportsImages: item.supportsImages } : {}),
        ...(item.minImages !== undefined ? { minImages: item.minImages } : {}),
        ...(item.maxImages !== undefined ? { maxImages: item.maxImages } : {}),
    };
}

function objectValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? Array.from(new Set(value.map(stringValue).filter(Boolean))) : [];
}

function catalogOptions(value: unknown): ChannelModelCatalogOption[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const options: ChannelModelCatalogOption[] = [];
    for (const raw of value) {
        const record = objectValue(raw);
        const optionValue = stringValue(record?.value);
        if (!optionValue || seen.has(optionValue)) continue;
        seen.add(optionValue);
        const label = stringValue(record?.label);
        options.push({ value: optionValue, ...(label ? { label } : {}) });
    }
    return options;
}

function optionValues(options: ChannelModelCatalogOption[] | undefined) {
    return Array.from(new Set((options || []).map((option) => option.value.trim()).filter(Boolean)));
}

function positiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function uniqueNumbers(values: string[]) {
    return Array.from(new Set(values.map(positiveNumber).filter((value) => value > 0)));
}

function nonNegativeInteger(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
