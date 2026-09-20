import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";

export type PriceTierMatchMode = "default" | "advanced";

// 与后端保存口径一致：上游键比较前剥掉一次 models/ 前缀，避免极旧存量行误报差异。
export function normalizeUpstreamModelKey(value: unknown): string {
    return String(value || "")
        .trim()
        .replace(/^models\//, "");
}

export type PriceTierFormValues = {
    matchMode: PriceTierMatchMode;
    operation: string;
    quality: string;
    size: string;
    resolution: string;
    videoSeconds: number;
    videoGenerateAudio: string;
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
        quality: "*",
        size: "*",
        resolution: "*",
        videoSeconds: 0,
        videoGenerateAudio: "*",
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

export function priceTierToForm(tier: ChannelModelPriceTier): PriceTierFormValues {
    const selector = tier.selector || {};
    const hasSpecificMatch = [selector.operation, selector.quality, selector.size].some((value) => value && value !== "*") || (tier.resolution && tier.resolution !== "*");
    return {
        matchMode: hasSpecificMatch ? "advanced" : "default",
        operation: selector.operation || "*",
        quality: selector.quality || "*",
        size: selector.size || "*",
        resolution: tier.resolution || "*",
        videoSeconds: tier.videoSeconds || 0,
        videoGenerateAudio: selector.videoGenerateAudio || "*",
        imageCount: Number(selector.imageCount || 0),
        providerModelKey: tier.providerModelKey || "",
        billingMode: tier.billingMode,
        unitPrice: tier.unitPriceMicrocredits / 1_000_000,
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

export function skuSelectorFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues) {
    if (tier.matchMode !== "advanced") return {};
    const selector: Record<string, string> = {};
    if (tier.operation && tier.operation !== "*") selector.operation = tier.operation;
    if (capability === "video") {
        if (tier.resolution && tier.resolution !== "*") selector.vquality = tier.resolution;
    }
    if (capability === "image") {
        if (tier.quality && tier.quality !== "*") selector.quality = tier.quality;
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

export function priceTierPayloadFromForm(capability: ModelCapabilityChoice, tier: PriceTierFormValues, upstreamModel: string) {
    const videoTokens = capability === "video" && tier.billingMode === "token";
    return {
        selector: skuSelectorFromForm(capability, tier),
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
