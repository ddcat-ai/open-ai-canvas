import { modelRequestOptions, resolveVideoOperation, type ModelRequirements } from "@/lib/model-selection";
import { videoResolutionComparisonKey } from "@/lib/video-generation-options";
import { buildImageResolutionOptions, imageResolutionOption } from "@/lib/image-resolution-tiers";
import type { LogicalModelQuote, ModelQuoteRequest, ModelRequestIntent } from "@/services/api/logical-models";
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

export function priceTierSummaryLabel(tiers: ModelPriceTier[], capability?: ModelCapability) {
    const unitPrices = (billingMode: ModelPriceTier["billingMode"]) =>
        tiers
            .filter((tier) => tier.billingMode === billingMode)
            .map((tier) => tier.unitPriceMicrocredits / 1_000_000)
            .filter((value) => Number.isFinite(value) && value >= 0);
    const fixedRequestValues = unitPrices("fixed_request");
    const perSecondValues = unitPrices("per_second");
    const tokenValues = tiers.filter((tier) => tier.billingMode === "token").map((tier) => tier.outputTokenPriceMicrocredits / 1_000_000).filter((value) => Number.isFinite(value) && value >= 0);
    return [
        fixedRequestValues.length ? formatPriceRange(fixedRequestValues, "积分") : "",
        perSecondValues.length ? formatPriceRange(perSecondValues, "积分/秒") : "",
        tokenValues.length ? `${capability === "video" ? "" : "输出 "}${formatPriceRange(tokenValues, capability === "video" ? "积分/百万视频 Token" : "积分/百万 Token")}` : "",
    ].filter(Boolean).join(" · ") || "未配置";
}

export function formatPriceRange(values: number[], suffix: string) {
    const unique = Array.from(new Set(values)).sort((left, right) => left - right);
    const format = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    return unique.length === 1 ? `${format(unique[0])} ${suffix}` : `${format(unique[0])}-${format(unique[unique.length - 1])} ${suffix}`;
}

export function modelQuoteDescription(quote: LogicalModelQuote) {
    const amount = (quote.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const descriptions = [`${quote.estimated ? "预计" : "本次"}消耗 ${amount} 积分`];
    const estimate = quote.videoTokenEstimate;
    if (estimate) {
        descriptions.push(`公式预估 ${estimate.formulaTokens.toLocaleString("zh-CN")} 视频 Token，平台额外预留 ${estimate.reservationMarginPercent}%（共 ${estimate.reservedTokens.toLocaleString("zh-CN")} Token）`);
        if (estimate.referenceDurationEstimated) descriptions.push("未知的参考视频时长按 15 秒估算");
        if (estimate.dimensionsEstimated) descriptions.push("实际画幅尚未确定，尺寸按当前参数估算");
    }
    if (quote.billingMode === "token") descriptions.push(estimate
        ? "预估金额并非费用上限，成功任务优先按有效的实际用量结算；未返回用量时按火山引擎公式结算，额外预留不计入公式结算，可能补扣或退回差额"
        : "预估金额并非费用上限，最终以成功任务返回的实际用量结算，可能补扣或退回差额");
    return descriptions.join("；");
}

export function modelQuoteRequest(config: AiConfig, value: string, capability?: ModelCapability, requirements?: ModelRequirements): ModelQuoteRequest | undefined {
    if (!capability || !value) return undefined;
    const channel = resolveModelChannel(config, value);
    if (channel.scope !== "system") return undefined;
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (!cost || (!cost.logicalModelId && capability !== "video")) return undefined;
    const input = requirements?.input;
    const intent: ModelRequestIntent = {
        capability,
        operation: capability === "image" ? imagePriceOperation(requirements) : capability === "video" && input ? resolveVideoOperation(input, requirements?.videoOperation) : requirements?.videoOperation,
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
    return cost.logicalModelId ? { logicalModelID: cost.logicalModelId, intent } : { channelId: channel.id, modelKey: modelOptionName(value), intent };
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
        } else if (requirements?.videoOperation) requested.operation = requirements.videoOperation;
        const options: Record<string, unknown> = { ...modelRequestOptions(config, "video"), ...requirements?.options, ...(requirements?.videoSeconds ? { videoSeconds: Number(requirements.videoSeconds) } : {}) };
        const resolution = normalizeTierResolution(String(options.vquality ?? ""));
        if (resolution !== "*") requested.vquality = resolution;
        const seconds = Math.max(0, Math.floor(Number(options.videoSeconds) || 0));
        if (seconds > 0) requested.videoSeconds = String(seconds);
        if (options.videoGenerateAudio === true || options.videoGenerateAudio === "true") requested.videoGenerateAudio = "true";
        if (options.videoGenerateAudio === false || options.videoGenerateAudio === "false") requested.videoGenerateAudio = "false";
    }
    if (capability === "image") {
        requested.operation = imagePriceOperation(requirements);
        const options = { ...modelRequestOptions(config, "image"), ...requirements?.options, ...(requirements?.imageSize ? { size: requirements.imageSize } : {}) };
        const imageQuality = String(options.quality ?? "").trim().toLowerCase();
        const imageSize = String(options.size ?? "").trim();
        if ((imageQuality === "" || imageQuality === "auto" || imageQuality === "any") && imageSize) {
            const resolution = imageResolutionOption(buildImageResolutionOptions([imageSize]), imageSize)?.tier;
            if (resolution) requested.quality = resolution;
        }
        for (const key of ["quality", "size"] as const) {
            const value = String(options[key] ?? "").trim().toLowerCase();
            if (value && value !== "auto" && value !== "any" && !requested[key]) requested[key] = value;
        }
    }
    return requested;
}

function imagePriceOperation(requirements?: ModelRequirements) {
    const input = requirements?.input;
    return (input?.imageCount || 0) + (input?.characterCount || 0) > 0 ? "image_to_image" : "text_to_image";
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
