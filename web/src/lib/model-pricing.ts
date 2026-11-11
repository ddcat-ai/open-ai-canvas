import { modelRequestOptions, resolveVideoOperation, type ModelRequirements } from "@/lib/model-selection";
import { mediaSettingIssues, resolvedMediaConfig } from "@/lib/media-settings";
import { videoResolutionComparisonKey } from "@/lib/video-generation-options";
import { imagePriceSelector, normalizeImagePriceSelector } from "@/lib/image-pricing";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
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
        const selector = priceSelectorForTier(tier, Boolean(modelCapabilityConfigFor(config, config.model || config.imageModel).image?.parameters));
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

export function priceTierSummaryLabel(tiers: ModelPriceTier[], capability?: ModelCapability, compactTokenUnit = false) {
    const unitPrices = (billingMode: ModelPriceTier["billingMode"]) =>
        tiers
            .filter((tier) => tier.billingMode === billingMode)
            .map((tier) => tier.unitPriceMicrocredits / 1_000_000)
            .filter((value) => Number.isFinite(value) && value >= 0);
    const fixedRequestValues = unitPrices("fixed_request");
    const perSecondValues = unitPrices("per_second");
    // 分时与上下文规则也计入输出价区间，用户看到的是可能被收取的全部输出单价。
    const tokenTiers = tiers.filter((tier) => tier.billingMode === "token");
    const tokenValues = tokenTiers
        .flatMap((tier) => [tier.outputTokenPriceMicrocredits, ...(tier.tokenPriceRules || []).map((rule) => rule.outputTokenPriceMicrocredits)])
        .map((value) => value / 1_000_000)
        .filter((value) => Number.isFinite(value) && value >= 0);
    const timeBased = tokenTiers.some((tier) => tier.tokenPriceRules?.length);
    return (
        [
            fixedRequestValues.length ? formatPriceRange(fixedRequestValues, "积分") : "",
            perSecondValues.length ? formatPriceRange(perSecondValues, "积分/秒") : "",
            tokenValues.length ? `${capability === "video" ? "" : "输出 "}${formatPriceRange(tokenValues, compactTokenUnit ? "/M Token" : capability === "video" ? "积分/百万视频 Token" : "积分/百万 Token")}${timeBased ? " · 分时" : ""}` : "",
        ]
            .filter(Boolean)
            .join(" · ") || "未配置"
    );
}

const WEEKDAY_LABELS = ["", "一", "二", "三", "四", "五", "六", "日"];

/** 一条分时与上下文规则的用户可读说明，例如「周一至周五 00:30–08:30 · 输入 ≥ 32,000 Token：输入 1 / 输出 2 积分/百万 Token」。 */
export function tokenPriceRuleDescription(rule: NonNullable<ModelPriceTier["tokenPriceRules"]>[number]) {
    const days = [...(rule.weekdays || [])].sort((a, b) => a - b);
    const contiguous = days.length > 2 && days.every((day, index) => index === 0 || day === days[index - 1] + 1);
    const dayLabel = days.length === 7 ? "每天" : contiguous ? `周${WEEKDAY_LABELS[days[0]]}至周${WEEKDAY_LABELS[days[days.length - 1]]}` : days.map((day) => `周${WEEKDAY_LABELS[day]}`).join("、");
    const format = (value: number) => value.toLocaleString("zh-CN");
    const context = rule.maxInputTokens > 0 ? `输入 ${format(rule.minInputTokens)}–${format(rule.maxInputTokens)} Token` : rule.minInputTokens > 0 ? `输入 ≥ ${format(rule.minInputTokens)} Token` : "";
    const price = (value: number) => (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    return `${[`${dayLabel} ${rule.start}–${rule.end}`, context].filter(Boolean).join(" · ")}：输入 ${price(rule.inputTokenPriceMicrocredits)} / 输出 ${price(rule.outputTokenPriceMicrocredits)} / 缓存读取 ${price(rule.cachedTokenPriceMicrocredits)} 积分/百万 Token`;
}

export function formatPriceRange(values: number[], suffix: string) {
    const unique = Array.from(new Set(values)).sort((left, right) => left - right);
    const format = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    return unique.length === 1 ? `${format(unique[0])} ${suffix}` : `${format(unique[0])}-${format(unique[unique.length - 1])} ${suffix}`;
}

export function modelQuoteDescription(quote: LogicalModelQuote) {
    const amount = (quote.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const descriptions = [`${quote.estimated ? "预计" : "本次"}消耗 ${amount} 积分`];
    const breakdown = referenceVideoQuoteBreakdown(quote.referenceVideo);
    if (breakdown) descriptions.push(breakdown);
    const estimate = quote.videoTokenEstimate;
    if (estimate) {
        descriptions.push(`公式预估 ${estimate.formulaTokens.toLocaleString("zh-CN")} 视频 Token，平台额外预留 ${estimate.reservationMarginPercent}%（共 ${estimate.reservedTokens.toLocaleString("zh-CN")} Token）`);
        if (estimate.referenceDurationEstimated && !breakdown) descriptions.push("未知的参考视频时长按 15 秒估算");
        if (estimate.dimensionsEstimated) descriptions.push("实际画幅尚未确定，尺寸按当前参数估算");
    }
    if (quote.billingMode === "token")
        descriptions.push(estimate ? "预估金额并非费用上限，成功任务优先按有效的实际用量结算；未返回用量时按火山引擎公式结算，额外预留不计入公式结算，可能补扣或退回差额" : "预估金额并非费用上限，最终以成功任务返回的实际用量结算，可能补扣或退回差额");
    return descriptions.join("；");
}

/**
 * 通用入口的报价请求：直连系统渠道的文本 / 图片模型在前端按价格档位直接算价，不发服务端报价；
 * 逻辑模型和直连视频模型（Token / 时长计费）才需要服务端报价。
 */
export function modelQuoteRequest(config: AiConfig, value: string, capability?: ModelCapability, requirements?: ModelRequirements): ModelQuoteRequest | undefined {
    if (!capability || !value) return undefined;
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (channel.scope === "system" && cost && !cost.logicalModelId && capability !== "video") return undefined;
    return systemModelQuoteRequest(config, value, capability, requirements);
}

/**
 * 任意系统模型（逻辑模型或直连渠道模型、任意能力）的服务端报价请求。
 * 必须先拿到服务端报价才允许提交的流程（例如电商 Agent 的分析与整套出图）用这个入口。
 */
export function systemModelQuoteRequest(config: AiConfig, value: string, capability?: ModelCapability, requirements?: ModelRequirements): ModelQuoteRequest | undefined {
    if (!capability || !value) return undefined;
    config = requestPricingConfig(config, value, capability, requirements);
    if (mediaSettingIssues(config, capability, value).length) return undefined;
    const channel = resolveModelChannel(config, value);
    if (channel.scope !== "system") return undefined;
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (!cost) return undefined;
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
            ...(capability === "image" || capability === "video" ? {} : requirements?.options || {}),
            ...modelRequestOptions(config, capability),
            ...(capability === "image" ? { count: 1 } : {}),
        },
    };
    const durations = referenceVideoQuoteDurations(input);
    if (capability === "video" && durations) intent.referenceVideoDurationsMs = durations;
    return cost.logicalModelId ? { logicalModelID: cost.logicalModelId, intent } : { channelId: channel.id, modelKey: modelOptionName(value), intent };
}

// The local price label and the signed quote use the same adapted request.
function requestPricingConfig(config: AiConfig, value: string, capability: ModelCapability, requirements?: ModelRequirements) {
    const requestedOptions = Object.fromEntries(
        Object.entries(requirements?.options || {})
            .filter(([key, item]) => ["size", "quality", "imageResolution", "count", "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark", "transparentBackground"].includes(key) && item !== undefined)
            .map(([key, item]) => [key, String(item)]),
    );
    if (capability === "image" && requirements?.options) {
        try {
            const extensions = JSON.parse(config.imageParameters || "{}");
            if (extensions && typeof extensions === "object" && !Array.isArray(extensions)) config = { ...config, imageParameters: JSON.stringify({ ...extensions, ...requirements.options }) };
        } catch {
            // Preserve corrupt state for the shared validation below.
        }
    }
    return resolvedMediaConfig({ ...config, ...requestedOptions, ...(requirements?.imageSize ? { size: requirements.imageSize } : {}), ...(requirements?.videoSeconds ? { videoSeconds: requirements.videoSeconds } : {}) }, capability, value);
}

// 只有全部参考视频时长都已知时才提交给报价接口；任一未知时交给后端按上限预估并标明。
function referenceVideoQuoteDurations(input: ModelRequirements["input"]) {
    const durations = input?.videoDurationsMs;
    if (!input?.videoCount || durations?.length !== input.videoCount) return undefined;
    return durations.every((value) => Number.isSafeInteger(value) && value > 0 && value <= 3_600_000) ? durations : undefined;
}

function formatSeconds(value: number) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

/** 报价构成，例如“生成 5 秒 + 参考视频 8 秒（参考视频另计费）”。 */
export function referenceVideoQuoteBreakdown(reference: LogicalModelQuote["referenceVideo"]) {
    if (!reference || reference.count <= 0) return "";
    const seconds = reference.billedSeconds > 0 ? reference.billedSeconds : reference.referenceSeconds;
    const referenceText = seconds > 0 ? `参考视频 ${formatSeconds(seconds)} 秒` : `参考视频 ${reference.count} 个`;
    const status = reference.billed ? (reference.estimated ? "参考视频另计费，时长未知按 15 秒预估" : "参考视频另计费") : "参考视频不计费";
    return `生成 ${formatSeconds(reference.generatedSeconds)} 秒 + ${referenceText}（${status}）`;
}

function creditAmount(billingMode: "fixed_request" | "per_second", unitPriceMicrocredits: number, count?: string | number, seconds?: string | number) {
    const quantity = billingMode === "per_second" ? Math.max(1, Math.floor(Math.abs(Number(seconds)) || 1)) : Math.max(1, Math.floor(Math.abs(Number(count)) || 1));
    return (unitPriceMicrocredits / 1_000_000) * quantity;
}

function priceSelectorForRequest(capability: ModelCapability | undefined, config: AiConfig, requirements?: ModelRequirements) {
    const requested: Record<string, string> = {};
    if (capability) config = requestPricingConfig(config, config.model || (capability === "image" ? config.imageModel : config.videoModel), capability, requirements);
    if (capability === "video") {
        const input = requirements?.input;
        if (input) {
            const imageCount = (input.imageCount || 0) + (input.characterCount || 0);
            requested.operation = input.videoCount > 0 ? "video_to_video" : imageCount > 0 ? "image_to_video" : resolveVideoOperation(input, requirements?.videoOperation);
            if (imageCount > 0) requested.imageCount = String(imageCount);
        } else if (requirements?.videoOperation) requested.operation = requirements.videoOperation;
        const options = modelRequestOptions(config, "video");
        const resolution = normalizeTierResolution(String(options.vquality ?? ""));
        if (resolution !== "*") requested.vquality = resolution;
        const seconds = Math.max(0, Math.floor(Number(options.videoSeconds) || 0));
        if (seconds > 0) requested.videoSeconds = String(seconds);
        if (options.videoGenerateAudio === true || options.videoGenerateAudio === "true") requested.videoGenerateAudio = "true";
        if (options.videoGenerateAudio === false || options.videoGenerateAudio === "false") requested.videoGenerateAudio = "false";
    }
    if (capability === "image") {
        requested.operation = imagePriceOperation(requirements);
        const options = modelRequestOptions(config, "image");
        const profile = modelCapabilityConfigFor(config, config.model || config.imageModel)?.image;
        if (profile?.parameters) {
            for (const field of profile.parameters) {
                if (field.enabled !== false && field.pricing && options[field.name] !== undefined) requested[field.name] = String(options[field.name]);
            }
            return requested;
        }
        const imageQuality = String(options.quality ?? "")
            .trim()
            .toLowerCase();
        const imageSize = String(options.size ?? "").trim();
        Object.assign(requested, imagePriceSelector(imageQuality, imageSize, modelCapabilityConfigFor(config, config.model || config.imageModel)?.image));
    }
    return requested;
}

function imagePriceOperation(requirements?: ModelRequirements) {
    const input = requirements?.input;
    return (input?.imageCount || 0) + (input?.characterCount || 0) > 0 ? "image_to_image" : "text_to_image";
}

function priceSelectorForTier(tier: ModelPriceTier, declaredParameters = false) {
    const selector = normalizeImagePriceSelector({ ...(tier.selector || {}) }, declaredParameters);
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
