import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { ChannelModel, ChannelModelPriceTier, TokenPriceRule } from "@/services/api/wallet";

export type PriceTierMatchMode = "default" | "advanced";

/** 分时与上下文规则的表单值；价格单位与所在价格档的售价单位一致（积分或 USD/CNY）。 */
export type TokenPriceRuleFormValues = {
    enabled: boolean;
    weekdays: number[];
    start: string;
    end: string;
    minInputTokens: number;
    /** 留空表示不限上限。 */
    maxInputTokens?: number | null;
    inputTokenPrice: number;
    outputTokenPrice: number;
    cachedTokenPrice: number;
    cacheWriteTokenPrice: number;
};

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export function defaultTokenPriceRule(base?: Pick<PriceTierFormValues, "inputTokenPrice" | "outputTokenPrice" | "cachedTokenPrice" | "cacheWriteTokenPrice">): TokenPriceRuleFormValues {
    return {
        enabled: true,
        weekdays: [...ALL_WEEKDAYS],
        start: "00:00",
        end: "24:00",
        minInputTokens: 0,
        maxInputTokens: null,
        inputTokenPrice: base?.inputTokenPrice ?? 0,
        outputTokenPrice: base?.outputTokenPrice ?? 0,
        cachedTokenPrice: base?.cachedTokenPrice ?? 0,
        cacheWriteTokenPrice: base?.cacheWriteTokenPrice ?? 0,
    };
}

function tokenPriceRuleToForm(rule: TokenPriceRule): TokenPriceRuleFormValues {
    return {
        enabled: rule.enabled,
        weekdays: [...(rule.weekdays || [])],
        start: rule.start,
        end: rule.end,
        minInputTokens: rule.minInputTokens || 0,
        maxInputTokens: rule.maxInputTokens > 0 ? rule.maxInputTokens : null,
        inputTokenPrice: rule.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: rule.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: rule.cachedTokenPriceMicrocredits / 1_000_000,
        cacheWriteTokenPrice: (rule.cacheWriteTokenPriceMicrocredits ?? 0) / 1_000_000,
    };
}

function tokenPriceRulePayload(rule: TokenPriceRuleFormValues): TokenPriceRule {
    return {
        enabled: rule.enabled !== false,
        weekdays: [...rule.weekdays].sort((a, b) => a - b),
        start: rule.start.trim(),
        end: rule.end.trim(),
        minInputTokens: Math.max(0, Math.floor(rule.minInputTokens || 0)),
        maxInputTokens: rule.maxInputTokens ? Math.floor(rule.maxInputTokens) : 0,
        inputTokenPriceMicrocredits: Math.round((rule.inputTokenPrice || 0) * 1_000_000),
        outputTokenPriceMicrocredits: Math.round((rule.outputTokenPrice || 0) * 1_000_000),
        cachedTokenPriceMicrocredits: Math.round((rule.cachedTokenPrice || 0) * 1_000_000),
        cacheWriteTokenPriceMicrocredits: Math.round((rule.cacheWriteTokenPrice || 0) * 1_000_000),
    };
}

/** HH:MM → 当天分钟数；allowEndOfDay 时接受 24:00。格式不合法返回 null，与后端口径一致。 */
export function tokenRuleClockMinutes(value: string | undefined, allowEndOfDay = false): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (minute > 59) return null;
    const total = hour * 60 + minute;
    if (total > 1440 || (total === 1440 && !allowEndOfDay)) return null;
    return total;
}

/** 当前上海时间命中时段的规则下标（不判断上下文区间），用于编辑界面提示。 */
export function tokenRulesMatchingNow(rules: TokenPriceRuleFormValues[] | undefined, now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.find((part) => part.type === "weekday")?.value || ""] || 0;
    const minute = Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
    return (rules || []).flatMap((rule, index) => {
        const start = tokenRuleClockMinutes(rule?.start);
        const end = tokenRuleClockMinutes(rule?.end, true);
        return rule?.enabled !== false && start !== null && end !== null && rule.weekdays?.includes(weekday) && minute >= start && minute < end ? [index] : [];
    });
}

// 与后端保存口径一致：上游键比较前剥掉一次 models/ 前缀，避免极旧存量行误报差异。
export function normalizeUpstreamModelKey(value: unknown): string {
    return String(value || "")
        .trim()
        .replace(/^models\//, "");
}

export type PriceTierFormValues = {
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
    /** 缓存写入（创建提示词缓存）的每百万 Token 价格，0 表示不单独收费。 */
    cacheWriteTokenPrice: number;
    /** 带参考视频的每秒价格（按秒档）与视频 Token 价格（Token 档），仅模型开启参考视频计费时使用。 */
    referenceVideoUnitPrice: number;
    referenceVideoOutputTokenPrice: number;
    costConfigured: boolean;
    costUnitPrice: number;
    costInputTokenPrice: number;
    costOutputTokenPrice: number;
    costCachedTokenPrice: number;
    costCacheWriteTokenPrice: number;
    /** 带参考视频的成本价：按秒档为每秒成本，视频 Token 档为 Token 成本；仅模型开启参考视频计费时使用。 */
    costReferenceVideoUnitPrice: number;
    costReferenceVideoOutputTokenPrice: number;
    /** 文本 Token 档的分时与上下文价格。 */
    tokenRulesEnabled: boolean;
    tokenRules: TokenPriceRuleFormValues[];
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
        cacheWriteTokenPrice: 0,
        referenceVideoUnitPrice: 0,
        referenceVideoOutputTokenPrice: 0,
        costConfigured: false,
        costUnitPrice: 0,
        costInputTokenPrice: 0,
        costOutputTokenPrice: 0,
        costCachedTokenPrice: 0,
        costCacheWriteTokenPrice: 0,
        costReferenceVideoUnitPrice: 0,
        costReferenceVideoOutputTokenPrice: 0,
        tokenRulesEnabled: false,
        tokenRules: [],
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
        inputTokenPrice: tier.inputTokenPriceMicrocredits / 1_000_000,
        outputTokenPrice: tier.outputTokenPriceMicrocredits / 1_000_000,
        cachedTokenPrice: tier.cachedTokenPriceMicrocredits / 1_000_000,
        cacheWriteTokenPrice: (tier.cacheWriteTokenPriceMicrocredits ?? 0) / 1_000_000,
        referenceVideoUnitPrice: (tier.referenceVideoUnitPriceMicrocredits ?? 0) / 1_000_000,
        referenceVideoOutputTokenPrice: (tier.referenceVideoOutputTokenPriceMicrocredits ?? 0) / 1_000_000,
        costConfigured: tier.costPricing?.configured === true,
        costUnitPrice: (tier.costPricing?.unitPriceMicrocredits ?? 0) / 1_000_000,
        costInputTokenPrice: (tier.costPricing?.inputTokenPriceMicrocredits ?? 0) / 1_000_000,
        costOutputTokenPrice: (tier.costPricing?.outputTokenPriceMicrocredits ?? 0) / 1_000_000,
        costCachedTokenPrice: (tier.costPricing?.cachedTokenPriceMicrocredits ?? 0) / 1_000_000,
        costCacheWriteTokenPrice: (tier.costPricing?.cacheWriteTokenPriceMicrocredits ?? 0) / 1_000_000,
        costReferenceVideoUnitPrice: (tier.costPricing?.referenceVideoUnitPriceMicrocredits ?? 0) / 1_000_000,
        costReferenceVideoOutputTokenPrice: (tier.costPricing?.referenceVideoOutputTokenPriceMicrocredits ?? 0) / 1_000_000,
        tokenRulesEnabled: tier.tokenPriceRulesEnabled === true,
        tokenRules: (tier.tokenPriceRules || []).map(tokenPriceRuleToForm),
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
        cacheWriteTokenPrice: (item.cacheWriteTokenPriceMicrocredits ?? 0) / 1_000_000,
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
    // 规则只属于文本 Token 档；切换能力或计费方式后不提交残留规则，后端也会拒绝。
    const tokenRules = capability === "text" && tier.billingMode === "token" ? (tier.tokenRules || []).map(tokenPriceRulePayload) : [];
    return {
        tokenPriceRulesEnabled: tokenRules.length > 0 && tier.tokenRulesEnabled === true,
        tokenPriceRules: tokenRules,
        selector: skuSelectorFromForm(capability, tier, capabilityConfig),
        resolution: priceTierResolutionFromForm(capability, tier),
        videoSeconds: priceTierVideoSecondsFromForm(capability, tier),
        providerModelKey: tier.providerModelKey?.trim() || upstreamModel,
        billingMode: tier.billingMode,
        unitPriceMicrocredits: Math.round((tier.unitPrice || 0) * 1_000_000),
        inputTokenPriceMicrocredits: videoTokens ? 0 : Math.round((tier.inputTokenPrice || 0) * 1_000_000),
        outputTokenPriceMicrocredits: Math.round((tier.outputTokenPrice || 0) * 1_000_000),
        cachedTokenPriceMicrocredits: videoTokens ? 0 : Math.round((tier.cachedTokenPrice || 0) * 1_000_000),
        cacheWriteTokenPriceMicrocredits: videoTokens ? 0 : Math.round((tier.cacheWriteTokenPrice || 0) * 1_000_000),
        // 后端只接受视频模型的带参考视频价格；保留未开启开关时的已填值，方便重新开启。
        referenceVideoUnitPriceMicrocredits: capability === "video" && tier.billingMode === "per_second" ? Math.round((tier.referenceVideoUnitPrice || 0) * 1_000_000) : 0,
        referenceVideoOutputTokenPriceMicrocredits: videoTokens ? Math.round((tier.referenceVideoOutputTokenPrice || 0) * 1_000_000) : 0,
        costPricing: {
            configured: tier.costConfigured,
            unitPriceMicrocredits: Math.round(tier.costUnitPrice * 1_000_000),
            inputTokenPriceMicrocredits: videoTokens ? 0 : Math.round(tier.costInputTokenPrice * 1_000_000),
            outputTokenPriceMicrocredits: Math.round(tier.costOutputTokenPrice * 1_000_000),
            cachedTokenPriceMicrocredits: videoTokens ? 0 : Math.round(tier.costCachedTokenPrice * 1_000_000),
            cacheWriteTokenPriceMicrocredits: videoTokens ? 0 : Math.round((tier.costCacheWriteTokenPrice || 0) * 1_000_000),
            referenceVideoUnitPriceMicrocredits: capability === "video" && tier.billingMode === "per_second" ? Math.round((tier.costReferenceVideoUnitPrice || 0) * 1_000_000) : 0,
            referenceVideoOutputTokenPriceMicrocredits: videoTokens ? Math.round((tier.costReferenceVideoOutputTokenPrice || 0) * 1_000_000) : 0,
        },
        priceConfigured: tier.priceConfigured !== false,
        enabled: tier.enabled !== false,
    };
}
