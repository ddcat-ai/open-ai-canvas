import { modelRequestOptions, resolveVideoOperation, type ModelRequirements } from "@/lib/model-selection";
import { videoResolutionComparisonKey } from "@/lib/video-generation-options";
import type { ModelRequestIntent } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export type ModelPriceTier = NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>[number];

type ModelCreditCost = {
    model: string;
    pricePolicy?: "channel" | "unified";
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    logicalPriceTiers?: ModelPriceTier[];
};

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number; seconds?: string | number; capability?: ModelCapability; config?: AiConfig; requirements?: ModelRequirements }) {
    if (options.channelMode !== "remote") return null;
    const cost = options.modelCosts?.find((item) => item.model === options.model) || null;
    if (!cost) return null;
    if (cost.pricePolicy === "channel") {
        if (!options.config) return null;
        const tiers = priceTiersForCurrentSelection(cost.logicalPriceTiers || [], options.capability, options.config, options.requirements);
        if (!tiers.length) return null;
        const first = tiers[0];
        if (!first || first.billingMode === "token") return null;
        // 同一精确规格可能来自多个逻辑路由；只有价格一致时才可在客户端安全展示。
        if (tiers.some((tier) => tier.billingMode !== first.billingMode || tier.unitPriceMicrocredits !== first.unitPriceMicrocredits)) return null;
        return creditAmount(first.billingMode, first.unitPriceMicrocredits, options.count, options.seconds);
    }
    // Token 订单由服务端按请求体预授权并在 usage 返回后结算，前端不展示无依据的固定价格。
    if (cost.billingMode === "token") return null;
    return creditAmount(cost.billingMode, cost.unitPriceMicrocredits, options.count, options.seconds);
}

export function priceTiersForCurrentSelection(tiers: ModelPriceTier[], capability: ModelCapability | undefined, config: AiConfig, requirements?: ModelRequirements) {
    const requested = priceSelectorForRequest(capability, config, requirements);
    let bestScore = -1;
    let matched: ModelPriceTier[] = [];
    for (const tier of tiers) {
        const selector = priceSelectorForTier(tier);
        const conditions = Object.entries(selector).filter(([, value]) => value && value !== "*");
        if (conditions.some(([key, value]) => requested[key] !== value)) continue;
        const score = conditions.length;
        if (score > bestScore) {
            bestScore = score;
            matched = [tier];
        } else if (score === bestScore) {
            matched.push(tier);
        }
    }
    return matched;
}

export function modelQuoteRequest(config: AiConfig, value: string, capability?: ModelCapability, requirements?: ModelRequirements): { logicalModelID: string; intent: ModelRequestIntent } | undefined {
    if (!capability || !value) return undefined;
    const channel = resolveModelChannel(config, value);
    if (channel.scope !== "system") return undefined;
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (!cost?.logicalModelId) return undefined;
    const input = requirements?.input;
    const intent: ModelRequestIntent = {
        capability,
        operation: capability === "video" && input ? resolveVideoOperation(input, requirements?.videoOperation) : requirements?.videoOperation,
        inputs: {
            image: (input?.imageCount || 0) + (input?.characterCount || 0),
            video: input?.videoCount || 0,
            audio: input?.audioCount || 0,
        },
        options: {
            ...modelRequestOptions(config, capability),
            ...(requirements?.options || {}),
            ...(requirements?.videoSeconds ? { videoSeconds: Number(requirements.videoSeconds) } : {}),
            ...(requirements?.imageSize ? { size: requirements.imageSize } : {}),
        },
    };
    return { logicalModelID: cost.logicalModelId, intent };
}

function creditAmount(billingMode: "fixed_request" | "per_second", unitPriceMicrocredits: number, count?: string | number, seconds?: string | number) {
    const quantity = billingMode === "per_second" ? Math.max(1, Math.floor(Math.abs(Number(seconds)) || 1)) : Math.max(1, Math.floor(Math.abs(Number(count)) || 1));
    return (unitPriceMicrocredits / 1_000_000) * quantity;
}

function priceSelectorForRequest(capability: ModelCapability | undefined, config: AiConfig, requirements?: ModelRequirements) {
    const requested: Record<string, string> = {};
    if (capability === "video") {
        const input = requirements?.input;
        if (input) {
            const imageCount = (input.imageCount || 0) + (input.characterCount || 0);
            requested.operation = input.videoCount > 0 ? "video_to_video" : imageCount > 0 ? "image_to_video" : resolveVideoOperation(input, requirements?.videoOperation);
            if (imageCount > 0) requested.imageCount = String(imageCount);
        }
        const resolution = normalizeTierResolution(config.vquality);
        if (resolution !== "*") requested.vquality = resolution;
        const seconds = Math.max(0, Math.floor(Number(config.videoSeconds) || 0));
        if (seconds > 0) requested.videoSeconds = String(seconds);
    }
    if (capability === "image") {
        if (config.quality && config.quality !== "auto") requested.quality = config.quality.toLowerCase();
        if (config.size && config.size !== "auto") requested.size = config.size.toLowerCase();
    }
    return requested;
}

function priceSelectorForTier(tier: ModelPriceTier) {
    const selector = { ...(tier.selector || {}) };
    if (!Object.keys(selector).length) {
        const resolution = normalizeTierResolution(tier.resolution);
        if (resolution !== "*") selector.vquality = resolution;
        if (tier.videoSeconds > 0) selector.videoSeconds = String(tier.videoSeconds);
    }
    return selector;
}

export function normalizeTierResolution(value: string) {
    const raw = String(value || "").trim();
    if (!raw || raw === "*") return "*";
    return videoResolutionComparisonKey(raw);
}
