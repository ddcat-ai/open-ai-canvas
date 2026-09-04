import { defaultModelCapabilityConfig, pluginWorkflowCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, protocolForModelCatalog, type ModelProtocol, type ModelProtocolDefinition } from "@/lib/model-protocols";
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

export function mergePluginWorkflowModelCosts(channel: ModelChannel, provider: ModelProtocolDefinition): ChannelModelCost[] {
    const workflows = provider.workflows || [];
    if (!workflows.length) return channel.modelCosts || [];
    const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    const existingByModel = new Map((channel.modelCosts || []).map((cost) => [cost.model, cost]));
    const next = (channel.modelCosts || []).map((cost) => {
        const workflow = workflowById.get(cost.model);
        if (!workflow) return cost;
        return {
            ...cost,
            displayName: workflow.label || cost.displayName,
            capability: workflow.capability,
            protocol: provider.value,
            capabilityConfig: pluginWorkflowCapabilityConfig(provider.value, workflow),
            defaultOptions: workflow.defaults || cost.defaultOptions,
        };
    });
    for (const model of channel.models) {
        const workflow = workflowById.get(model);
        if (!workflow || existingByModel.has(model)) continue;
        next.push({
            model,
            displayName: workflow.label,
            capability: workflow.capability,
            protocol: provider.value,
            billingMode: "fixed_request",
            unitPriceMicrocredits: 0,
            capabilityConfig: pluginWorkflowCapabilityConfig(provider.value, workflow),
            defaultOptions: workflow.defaults,
        });
    }
    return next;
}

export function syncPluginWorkflowModelCosts(channels: ModelChannel[], providers: ModelProtocolDefinition[]) {
    const providerById = new Map(providers.map((provider) => [provider.value, provider]));
    let changed = false;
    const next = channels.map((channel) => {
        const provider = providerById.get(channel.interfaceType || "");
        if (!provider?.workflows?.length) return channel;
        const modelCosts = mergePluginWorkflowModelCosts(channel, provider);
        if (JSON.stringify(modelCosts) === JSON.stringify(channel.modelCosts || [])) return channel;
        changed = true;
        return { ...channel, modelCosts };
    });
    return { channels: next, changed };
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

export function mergeFetchedChannelModelCosts(channel: ModelChannel, catalog: ChannelModelCatalogItem[]): ChannelModelCost[] {
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
        const protocol = inferredProtocol || protocolTemplateForNewCatalogModel(capability, channel.interfaceType);
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
