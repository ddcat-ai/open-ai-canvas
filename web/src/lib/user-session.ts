import { getFeatureAvailability, type AuthSessionPayload } from "@/services/api/auth";
import { getModelCatalog, type CapabilitySpec, type ModelCatalogResponse, type OptionConstraint, type PublicChannelCatalog, type PublicLogicalModel } from "@/services/api/logical-models";
import { localForageStorage } from "@/lib/localforage-storage";
import { appQueryClient } from "@/lib/query-client";
import { scopedLocalStorage, setActiveUserScope } from "@/lib/user-scope";
import { CANVAS_STORE_KEY, flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CANVAS_HISTORY_STORE_KEY, useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { ASSET_STORE_KEY, flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { CONFIG_STORE_KEY, PUBLIC_MODEL_CATALOG_ID, defaultConfig, normalizeConfigSnapshot, useConfigStore, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { CREATION_PREFERENCES_STORE_KEY, useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { defaultModelCapabilityConfig, STANDARD_IMAGE_SIZE_VALUES, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { imageSizeConfigWithPresets } from "@/lib/image-size-presets";
import { useUserStore } from "@/stores/use-user-store";
import { PLUGIN_STORE_KEY, usePluginStore } from "@/stores/use-plugin-store";
import { initializeRemoteUserDataSession, installRemoteUserDataAutoSync, resetRemoteUserDataSync, withRemoteUserDataSyncExclusive } from "@/services/user-data-sync";
import { withGenerationConsumersPaused } from "@/services/generation-consumer-lifecycle";

export async function switchUserStorageScope(userId?: string | null) {
    await withGenerationConsumersPaused(async () => {
        await withRemoteUserDataSyncExclusive(async () => {
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            resetRemoteUserDataSync();
            setActiveUserScope(userId);
        });
    });
}

export async function applyUserSession(payload: AuthSessionPayload) {
    const previousUserId = useUserStore.getState().user?.id || "";
    const nextUserId = payload.user?.id || "";
    useUserStore.getState().setHydrated(false);
    try {
        // Query key 不携带用户 ID；身份变化时必须取消并清空旧账号请求，避免跨账号复用内存数据。
        if (previousUserId !== nextUserId) appQueryClient.clear();
        await switchUserStorageScope(payload.user?.id);
        const [persistedCanvas, persistedCanvasHistory, persistedAssets, persistedPlugins] = await Promise.all([
            localForageStorage.getItem(CANVAS_STORE_KEY),
            localForageStorage.getItem(CANVAS_HISTORY_STORE_KEY),
            localForageStorage.getItem(ASSET_STORE_KEY),
            localForageStorage.getItem(PLUGIN_STORE_KEY),
        ]);
        const persistedConfig = scopedLocalStorage.getItem(CONFIG_STORE_KEY);
        const persistedCreationPreferences = scopedLocalStorage.getItem(CREATION_PREFERENCES_STORE_KEY);
        usePluginStore.setState({ hydrated: false, runtimeStatuses: {}, pluginStates: {} });
        useUserStore.getState().setUser(payload.user);
        useUserStore.getState().setRuntimeLimits(payload.runtimeLimits);
        useUserStore.getState().setDrawingEngine(payload.drawingEngine);
        useUserStore.getState().setFeatures(payload.features);
        await Promise.all([
            useCanvasStore.persist.rehydrate(),
            useCanvasHistoryStore.persist.rehydrate(),
            useAssetStore.persist.rehydrate(),
            useConfigStore.persist.rehydrate(),
            usePluginStore.persist.rehydrate(),
            useCreationPreferencesStore.persist.rehydrate(),
        ]);
        // Zustand 在目标 scope 没有快照时会保留旧内存，必须显式恢复该 scope 的空状态。
        if (!persistedCanvas) useCanvasStore.setState({ projects: [] });
        if (!persistedCanvasHistory) useCanvasHistoryStore.setState({ deletedProjects: [] });
        if (!persistedAssets) useAssetStore.setState({ assets: [] });
        if (!persistedPlugins) usePluginStore.setState({ installations: [], runtimeStatuses: {}, pluginStates: {} });
        if (!persistedCreationPreferences) useCreationPreferencesStore.setState({ preferences: {} });
        if (!persistedConfig) {
            // 只有首次配置缺失时才生成能力推荐；已有配置中的空数组代表用户明确清空。
            const catalog = await getModelCatalog();
            const initialSystemConfig = {
                ...defaultConfig,
                channels: modelCatalogChannels(catalog),
                imageModels: undefined,
                videoModels: undefined,
                textModels: undefined,
                audioModels: undefined,
            };
            useConfigStore.getState().replaceConfig(normalizeConfigSnapshot({ config: initialSystemConfig }).config);
        } else {
            const catalog = await getModelCatalog();
            useConfigStore.getState().mergeSystemChannels(modelCatalogChannels(catalog));
        }
        installRemoteUserDataAutoSync();
        if (payload.user?.id) {
            await initializeRemoteUserDataSession(payload.user.id);
        } else resetRemoteUserDataSync();
    } finally {
        useUserStore.getState().setHydrated(true);
    }
}

export async function refreshSystemChannels() {
    const catalog = await getModelCatalog();
    useConfigStore.getState().mergeSystemChannels(modelCatalogChannels(catalog));
}

// 模型目录来源决定数据形状；这里统一做运行时收口，避免畸形响应被当成“空目录”写入用户配置。
function modelCatalogChannels(catalog: ModelCatalogResponse): ModelChannel[] {
    if (catalog.source === "frontend") {
        if (!Array.isArray(catalog.models)) throw new Error("模型目录响应缺少前台模型列表");
        return managedModelChannels(catalog.models);
    }
    if (catalog.source === "system") {
        if (!Array.isArray(catalog.channels)) throw new Error("模型目录响应缺少系统渠道列表");
        return systemChannelModelChannels(catalog.channels);
    }
    throw new Error("模型目录响应来源无效");
}

function managedModelChannels(models: PublicLogicalModel[]) {
    const availableModels = models.filter((item) => item.available);
    if (!availableModels.length) return [];
    const managed: ModelChannel = {
        id: PUBLIC_MODEL_CATALOG_ID,
        name: "平台模型",
        baseUrl: "/api",
        apiKey: "system",
        apiFormat: "openai",
        scope: "system",
        enabled: true,
        models: availableModels.map((item) => item.id),
        modelAliases: Object.fromEntries(availableModels.flatMap((item) => (item.legacyModelIds || []).map((legacyID) => [legacyID, item.id]))),
        modelCosts: availableModels.map((item) => ({
            model: item.id,
            displayName: item.name,
            description: item.description,
            icon: item.icon,
            capability: item.capability,
            pricePolicy: item.pricePolicy,
            billingMode: item.billingMode,
            unitPriceMicrocredits: item.unitPriceMicrocredits,
            inputTokenPriceMicrocredits: item.inputPriceMicrocredits,
            outputTokenPriceMicrocredits: item.outputPriceMicrocredits,
            cachedTokenPriceMicrocredits: item.cachedPriceMicrocredits,
            capabilityConfig: projectLogicalCapability(item.capabilitySpec, item.defaultOptions),
            logicalModelId: item.id,
            logicalCapabilitySpec: item.capabilitySpec,
            logicalCapabilityProfiles: item.capabilityProfiles,
            logicalPriceTiers: item.priceTiers,
            defaultOptions: item.defaultOptions,
        })),
    };
    return [managed];
}

// 系统渠道模型转换为前端配置格式
export function systemChannelModelChannels(channels: PublicChannelCatalog[]): ModelChannel[] {
    return channels.map((channel) => {
        const availableModels = channel.models.filter((m) => m.available);
        return {
            id: channel.id,
            name: channel.displayName,
            sortOrder: channel.sortOrder,
            // 系统渠道必须走带渠道 ID 的站内代理；/api 只是业务 API 根路径，
            // 不能作为模型请求的运行时 Base URL 传给 channelRequest。
            baseUrl: `/api/${channel.id}`,
            apiKey: "system",
            apiFormat: "openai",
            scope: "system" as const,
            enabled: true,
            models: availableModels.map((m) => m.modelKey),
            modelAliases: {},
            modelCosts: availableModels.map((model) => {
                // 标量价格仅用于旧配置兼容；创作端按完整 SKU 档位展示和匹配价格。
                const firstTier = model.priceTiers?.[0];
                const unitPrice = firstTier?.unitPriceMicrocredits || 0;
                const inputPrice = firstTier?.inputTokenPriceMicrocredits || 0;
                const outputPrice = firstTier?.outputTokenPriceMicrocredits || 0;
                const cachedPrice = firstTier?.cachedTokenPriceMicrocredits || 0;
                const billingMode = firstTier?.billingMode || "fixed_request";
                const logicalPriceTiers = (model.priceTiers || []).map((tier) => ({
                    selector: tier.selector || {},
                    resolution: tier.resolution || "*",
                    videoSeconds: tier.videoSeconds || 0,
                    billingMode: tier.billingMode as "fixed_request" | "per_second" | "token",
                    unitPriceMicrocredits: tier.unitPriceMicrocredits || 0,
                    inputTokenPriceMicrocredits: tier.inputTokenPriceMicrocredits || 0,
                    outputTokenPriceMicrocredits: tier.outputTokenPriceMicrocredits || 0,
                    cachedTokenPriceMicrocredits: tier.cachedTokenPriceMicrocredits || 0,
                }));

                return {
                    model: model.modelKey,
                    displayName: model.displayName,
                    description: "",
                    icon: model.icon || "",
                    capability: model.capability as ModelCapability,
                    protocol: model.protocol as any,
                    pricePolicy: "channel" as const,
                    billingMode: billingMode as any,
                    unitPriceMicrocredits: unitPrice,
                    inputTokenPriceMicrocredits: inputPrice,
                    outputTokenPriceMicrocredits: outputPrice,
                    cachedTokenPriceMicrocredits: cachedPrice,
                    capabilityConfig: (model.capabilityConfig as ModelCapabilityConfig | undefined) || defaultModelCapabilityConfig(),
                    channelModelId: model.id,
                    channelId: channel.id,
                    modelKey: model.modelKey,
                    logicalPriceTiers,
                };
            }),
        };
    });
}

export function projectLogicalCapability(spec: CapabilitySpec, defaults: Record<string, unknown>): ModelCapabilityConfig {
    const projected = defaultModelCapabilityConfig();
    if (spec.capability === "image" && projected.image) {
        projected.image.references.maxImages = spec.inputs?.image?.max ?? 0;
        projected.image.references.maskSupported = (spec.inputs?.mask?.max ?? 0) > 0;
        projected.image.size = { parameter: "none", values: [], default: "auto", allowCustom: false };
        projected.image.quality = { supported: false, values: [], default: "auto" };
        projected.image.transparentBackground = { supported: false, default: false };
        const sizeOption = spec.options?.size || spec.options?.aspectRatio;
        const sizeValues = stringValues(sizeOption);
        const sizeAllowsCustom = sizeValues.includes("*") || Boolean(spec.imageSize?.allowCustom);
        const concreteSizeValues = sizeValues.filter((value) => value !== "*");
        const sizePresets = concreteSizeValues.length ? concreteSizeValues : sizeAllowsCustom ? [...STANDARD_IMAGE_SIZE_VALUES] : [];
        if (sizePresets.length || sizeAllowsCustom || spec.imageSize?.presets?.length) {
            const parameter = spec.imageSize?.parameter === "aspect_ratio" || spec.imageSize?.parameter === "size" ? spec.imageSize.parameter : "size";
            projected.image.size = { parameter, values: sizePresets, default: concreteDefault(defaults.size, sizePresets, "1:1"), allowCustom: sizeAllowsCustom };
            if (spec.imageSize?.presets?.length) projected.image.size = imageSizeConfigWithPresets(projected.image, spec.imageSize.presets);
        }
        applyStringOption(spec.options?.quality, defaults.quality, (values, initial) => {
            projected.image!.quality = { supported: true, values, default: initial };
        });
        projected.image.maxOutputs = maxNumericOption(spec.options?.count, 1);
        projected.image.transparentBackground = booleanOption(spec.options?.transparentBackground, defaults.transparentBackground);
    }
    if (spec.capability === "video" && projected.video) {
        projected.video.references.minImages = spec.inputs?.image?.min ?? 0;
        projected.video.references.maxImages = spec.inputs?.image?.max ?? 0;
        projected.video.references.maxVideos = spec.inputs?.video?.max ?? 0;
        projected.video.references.maxAudios = spec.inputs?.audio?.max ?? 0;
        projected.video.operations = spec.operations || [];
        projected.video.defaultOperation = spec.operations?.[0] || "";
        const duration = spec.options?.videoSeconds || spec.options?.duration;
        if (duration?.values?.length) projected.video.duration = { selection: "enum", values: duration.values.map(Number).filter(Number.isFinite), default: Number(defaults.videoSeconds ?? duration.values[0]) };
        else if (duration?.min !== undefined && duration.max !== undefined) projected.video.duration = { selection: "range", min: duration.min, max: duration.max, step: duration.step || 1, default: Number(defaults.videoSeconds ?? duration.min) };
        projected.video.ratios = stringValues(spec.options?.size || spec.options?.aspectRatio);
        projected.video.defaultRatio = concreteDefault(defaults.size, projected.video.ratios, "");
        projected.video.resolutions = stringValues(spec.options?.vquality || spec.options?.resolution);
        projected.video.defaultResolution = String(defaults.vquality ?? projected.video.resolutions[0] ?? "");
        projected.video.generateAudio = booleanOption(spec.options?.videoGenerateAudio, defaults.videoGenerateAudio);
        projected.video.watermark = booleanOption(spec.options?.videoWatermark, defaults.videoWatermark);
    }
    return projected;
}

function applyStringOption(option: OptionConstraint | undefined, fallback: unknown, apply: (values: string[], initial: string) => void) {
    const values = stringValues(option);
    if (values.length) apply(values, concreteDefault(fallback, values, values[0]));
}

function stringValues(option?: OptionConstraint) {
    return (option?.values || [])
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean);
}

function concreteDefault(value: unknown, values: string[], fallback: string) {
    const candidate = String(value ?? "").trim();
    return candidate && candidate !== "*" && values.includes(candidate) ? candidate : values.find((item) => item !== "*") || fallback;
}

function maxNumericOption(option: OptionConstraint | undefined, fallback: number) {
    if (option?.max !== undefined) return option.max;
    const values = (option?.values || []).map(Number).filter(Number.isFinite);
    return values.length ? Math.max(...values) : fallback;
}

function booleanOption(option: OptionConstraint | undefined, fallback: unknown) {
    const supported = (option?.values || []).some((value) => value === true || value === "true");
    return { supported, default: supported && String(fallback) === "true" };
}

export async function refreshFeatureAvailability() {
    const payload = await getFeatureAvailability();
    useUserStore.getState().setFeatures(payload.features);
    return payload.features;
}
