import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";

export type PriceTierMatchMode = "default" | "advanced";

// 与后端保存口径一致：上游键比较前剥掉一次 models/ 前缀，避免极旧存量行误报差异。
export function normalizeUpstreamModelKey(value: unknown): string {
    return String(value || "")
        .trim()
        .replace(/^models\//, "");
}

export type PriceTierFormValues = {
    officialUnitPrice?: number | null;
    officialInputTokenPrice?: number | null;
    officialOutputTokenPrice?: number | null;
    officialCachedTokenPrice?: number | null;
    imageSelector?: Record<string, string>;
    matchMode: PriceTierMatchMode;
    operation: string;
    imageResolution: string;
    quality: string;
    size: string;
    resolution: string;
    videoSeconds: number;
    videoGenerateAudio: string;
    /** 视频处理输出帧率档：le30 / le60 / le120，* 表示任意。 */
    fpsBand: string;
    imageCount: number;
    providerModelKey?: string;
    billingMode: ChannelModel["billingMode"];
    unitPrice: number;
    inputTokenPrice: number;
    outputTokenPrice: number;
    cachedTokenPrice: number;
    costConfigured: boolean;
    costUnitPrice: number;
    costInputTokenPrice: number;
    costOutputTokenPrice: number;
    costCachedTokenPrice: number;
    priceConfigured: boolean;
    enabled: boolean;
};

export function defaultPriceTier(matchMode: PriceTierMatchMode = "default"): PriceTierFormValues {
    return {
        matchMode,
        operation: "*",
        imageResolution: "*",
        quality: "*",
        size: "*",
        resolution: "*",
        videoSeconds: 0,
        videoGenerateAudio: "*",
        fpsBand: "*",
        imageCount: 0,
        providerModelKey: "",
        billingMode: "fixed_request",
        unitPrice: 0,
        inputTokenPrice: 0,
        outputTokenPrice: 0,
        cachedTokenPrice: 0,
        costConfigured: false,
        costUnitPrice: 0,
        costInputTokenPrice: 0,
        costOutputTokenPrice: 0,
        costCachedTokenPrice: 0,
        priceConfigured: true,
        enabled: true,
    };
}

export function priceTierToForm(tier: ChannelModelPriceTier, image?: ImageCapabilityConfig, protocol?: string): PriceTierFormValues {
    const selector = { ...(tier.selector || {}) };
    // 旧定价把分辨率档位存在 quality / resolution 里；统一迁移到 imageResolution，
    // 1.5K 也走这条路径，避免重复档位。
    const legacyResolution = (selector.quality || selector.resolution || selector.imageResolution)?.toLowerCase();
    const isResolutionTier = Boolean(legacyResolution && (["1k", "1.5k", "2k", "4k"].includes(legacyResolution) || image?.resolution.values.some((value) => value.toLowerCase() === legacyResolution)));
    if (isResolutionTier && (!image?.quality.supported || image?.resolution.supported) && !selector.imageResolution) {
        selector.imageResolution = legacyResolution;
        delete selector.quality;
        delete selector.resolution;
    }
    const candidates = image?.parameters ? Object.values(selector) : [selector.operation, selector.imageResolution, selector.quality, selector.resolution, selector.size, selector.fpsBand];
    const hasSpecificMatch = candidates.some((value) => value && value !== "*") || (tier.resolution && tier.resolution !== "*");
    return {
        matchMode: hasSpecificMatch ? "advanced" : "default",
        operation: selector.operation || "*",
        imageSelector: Object.fromEntries(Object.entries(selector).filter(([name]) => name !== "operation")),
        imageResolution: selector.imageResolution || "*",
        quality: selector.quality || "*",
        size: selector.size || "*",
        resolution: selector.resolution || tier.resolution || "*",
        videoSeconds: tier.videoSeconds || 0,
        videoGenerateAudio: selector.videoGenerateAudio || "*",
        fpsBand: selector.fpsBand || "*",
        imageCount: Number(selector.imageCount || 0),
        providerModelKey: tier.providerModelKey || "",
        billingMode: tier.billingMode,
        unitPrice: tier.unitPriceMicrocredits / 1_000_000,
        officialUnitPrice: tier.officialPricing?.configured ? tier.officialPricing.unitPriceMicrocredits / 1_000_000 : undefined,
        officialInputTokenPrice: tier.officialPricing?.configured ? tier.officialPricing.inputTokenPriceMicrocredits / 1_000_000 : undefined,
        officialOutputTokenPrice: tier.officialPricing?.configured ? tier.officialPricing.outputTokenPriceMicrocredits / 1_000_000 : undefined,
        officialCachedTokenPrice: tier.officialPricing?.configured ? tier.officialPricing.cachedTokenPriceMicrocredits / 1_000_000 : undefined,
        inputTokenPrice: tier.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: tier.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: tier.cachedTokenPriceMicrocredits / 1_000_000,
        costConfigured: tier.costPricing?.configured === true,
        costUnitPrice: (tier.costPricing?.unitPriceMicrocredits ?? 0) / 1_000_000,
        costInputTokenPrice: (tier.costPricing?.inputTokenPriceMicrocredits ?? 0) / 1_000_000,
        costOutputTokenPrice: (tier.costPricing?.outputTokenPriceMicrocredits ?? 0) / 1_000_000,
        costCachedTokenPrice: (tier.costPricing?.cachedTokenPriceMicrocredits ?? 0) / 1_000_000,
        priceConfigured: tier.priceConfigured,
        enabled: tier.enabled,
    };
}

export function legacyPriceTierToForm(item: ChannelModel): PriceTierFormValues {
    return {
        ...defaultPriceTier(),
        // 不预填顶层上游键：统一价格档保持“跟随模型默认上游 ID”，
        // 否则首次保存会把当时的上游键固化进档位，之后模型级重命名会被旧值遮蔽。
        billingMode: item.billingMode,
        unitPrice: item.unitPriceMicrocredits / 1_000_000,
        inputTokenPrice: item.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: item.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: item.cachedTokenPriceMicrocredits / 1_000_000,
        priceConfigured: item.priceConfigured,
        enabled: item.enabled,
    };
}

export function skuSelectorFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues, capabilityConfig?: ModelCapabilityConfig) {
    if (tier.matchMode !== "advanced") return {};
    const selector: Record<string, string> = {};
    if (tier.operation && tier.operation !== "*") selector.operation = tier.operation;
    if (capability === "video") {
        if (tier.resolution && tier.resolution !== "*") selector.vquality = tier.resolution;
        if (capabilityConfig?.video?.processing && tier.fpsBand && tier.fpsBand !== "*") selector.fpsBand = tier.fpsBand;
    }
    if (capability === "image") {
        if (capabilityConfig?.image?.parameters) {
            for (const field of capabilityConfig.image.parameters) {
                if (field.enabled === false || !field.pricing) continue;
                const value = tier.imageSelector?.[field.name];
                if (value !== undefined && value !== "" && value !== "*") selector[field.name] = String(value);
            }
            return selector;
        }
        if (tier.imageResolution && tier.imageResolution !== "*") {
            selector.imageResolution = tier.imageResolution;
        } else if (capabilityConfig?.image?.resolution?.supported && tier.quality && ["1k", "1.5k", "2k", "4k"].includes(tier.quality.toLowerCase())) {
            // 旧定价把档位存在 quality 时，写入 imageResolution 以匹配新选择器。
            selector.imageResolution = tier.quality.toLowerCase();
        } else if (tier.quality && tier.quality !== "*") {
            selector.quality = tier.quality;
        }
        if (tier.size && tier.size !== "*") selector.size = tier.size;
    }
    return selector;
}

export function priceTierResolutionFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues) {
    return capability === "video" && tier.matchMode === "advanced" ? tier.resolution || "*" : "*";
}

export function priceTierVideoSecondsFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues) {
    void capability;
    void tier;
    return 0;
}

export function priceTierPayloadFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues, upstreamModel: string, capabilityConfig?: ModelCapabilityConfig) {
    const videoTokens = capability === "video" && tier.billingMode === "token";
    return {
        officialPricing: {
            configured: tier.billingMode === "token" ? (videoTokens ? tier.officialOutputTokenPrice != null : [tier.officialInputTokenPrice, tier.officialOutputTokenPrice, tier.officialCachedTokenPrice].some(value => value != null)) : tier.officialUnitPrice != null,
            unitPriceMicrocredits: tier.billingMode === "token" ? 0 : Math.round((tier.officialUnitPrice ?? 0) * 1_000_000),
            inputTokenPriceMicrocredits: tier.billingMode !== "token" || videoTokens ? 0 : Math.round((tier.officialInputTokenPrice ?? 0) * 1_000_000),
            outputTokenPriceMicrocredits: tier.billingMode !== "token" ? 0 : Math.round((tier.officialOutputTokenPrice ?? 0) * 1_000_000),
            cachedTokenPriceMicrocredits: tier.billingMode !== "token" || videoTokens ? 0 : Math.round((tier.officialCachedTokenPrice ?? 0) * 1_000_000),
        },
        selector: skuSelectorFromForm(capability, tier, capabilityConfig),
        resolution: priceTierResolutionFromForm(capability, tier),
        videoSeconds: priceTierVideoSecondsFromForm(capability, tier),
        providerModelKey: tier.providerModelKey?.trim() || upstreamModel,
        billingMode: tier.billingMode,
        unitPriceMicrocredits: Math.round((tier.unitPrice || 0) * 1_000_000),
        inputTokenPriceMicrocredits: videoTokens ? 0 : Math.round((tier.inputTokenPrice || 0) * 1_000_000),
        outputTokenPriceMicrocredits: Math.round((tier.outputTokenPrice || 0) * 1_000_000),
        cachedTokenPriceMicrocredits: videoTokens ? 0 : Math.round((tier.cachedTokenPrice || 0) * 1_000_000),
        costPricing: {
            configured: tier.costConfigured,
            unitPriceMicrocredits: Math.round(tier.costUnitPrice * 1_000_000),
            inputTokenPriceMicrocredits: videoTokens ? 0 : Math.round(tier.costInputTokenPrice * 1_000_000),
            outputTokenPriceMicrocredits: Math.round(tier.costOutputTokenPrice * 1_000_000),
            cachedTokenPriceMicrocredits: videoTokens ? 0 : Math.round(tier.costCachedTokenPrice * 1_000_000),
        },
        priceConfigured: tier.priceConfigured !== false,
        enabled: tier.enabled !== false,
    };
}
