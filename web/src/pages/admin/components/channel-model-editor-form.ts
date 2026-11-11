import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { FormInstance } from "antd";
import { defaultModelCapabilityConfig, normalizeLegacyImageResolutionConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { imagePresetForRatio, imageSizePresets } from "@/lib/image-size-presets";
import { modelProtocolSupportsTokenBilling, type ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ChannelModel } from "@/services/api/wallet";
import type { ModelTag } from "@/lib/model-tags";
import { initializeImageRatioDefaults, resolveImageParameters, standardImageSizeEncoding } from "@/lib/image-parameters";
import { findProtocolWorkflow, resolveWorkflowVideoScreenSpec } from "@/lib/video-screen-specs";
import { defaultPriceTier, legacyPriceTierToForm, normalizeUpstreamModelKey, priceTierToForm, skuSelectorFromForm, tokenRuleClockMinutes, type PriceTierFormValues, type TokenPriceRuleFormValues } from "./channel-model-price-tier-form";
import type { PriceCurrency } from "@/services/api/user-groups";
import { priceSelectorIssues } from "./channel-model-templates";

export type ChannelModelFormValues = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    channelLabel?: string;
    tags: ModelTag[];
    description?: string;
    icon?: string;
    capability: ModelCapabilityChoice;
    protocol?: string;
    priceTiers: PriceTierFormValues[];
    /** 售价单位；成本价始终以积分计。 */
    priceCurrency: PriceCurrency;
    /** 仅视频模型：挂参考视频的请求是否按带参考视频价格另计费；新模型默认关闭。 */
    referenceVideoBilling: boolean;
    enabled: boolean;
    capabilityConfig?: ModelCapabilityConfig;
};

export type EditorSection = "identity" | "capabilities" | "pricing";

export function replaceChannelModelFormValues(form: Pick<FormInstance<ChannelModelFormValues>, "setFieldsValue" | "setFieldValue">, values: ChannelModelFormValues) {
    const { capabilityConfig, ...fields } = values;
    form.setFieldsValue(fields);
    // 整体替换协议配置，避免 setFieldsValue 深合并后残留旧协议字段。
    form.setFieldValue("capabilityConfig", capabilityConfig);
}

export function editorSectionForField(name: (string | number)[]): EditorSection {
    return name[0] === "priceTiers" ? "pricing" : name[0] === "capabilityConfig" ? "capabilities" : "identity";
}

export function initialChannelModelValues(item: ChannelModel | null, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = item?.capability || "text";
    const protocol = item ? item.protocol : protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const upstreamModel = item?.providerModelKey || item?.modelKey || "";
    const rawCapabilityConfig = item?.capabilityConfig || defaultModelCapabilityConfig(protocol, upstreamModel);
    let capabilityConfig =
        capability === "audio"
            ? undefined
            : (() => {
                  const normalized = normalizeModelCapabilityConfig(rawCapabilityConfig);
                  return normalized.image ? { ...normalized, image: normalizeLegacyImageResolutionConfig(protocol, normalized.image) } : normalized;
              })();
    const target = protocols.find((p) => p.value === protocol);
    const definitions = target?.imageParameters;
    if (capabilityConfig?.image && capability === "image" && (definitions || capabilityConfig.image.parameters || standardImageSizeEncoding(target?.create)))
        capabilityConfig = { ...capabilityConfig, image: resolveImageParameters(capabilityConfig.image, definitions || [], upstreamModel, protocol, target?.create) };
    return {
        modelKey: item?.modelKey || "",
        providerModelKey: upstreamModel,
        displayName: item?.displayName || "未分类",
        channelLabel: item?.channelLabel || upstreamModel,
        tags: item?.tags?.map((tag) => ({ ...tag })) || [],
        description: item?.description || "",
        icon: item?.icon || "",
        capability,
        protocol,
        priceTiers: item ? (item.priceTiers?.length ? item.priceTiers.map((tier) => priceTierToForm(tier, capabilityConfig?.image, protocol)) : [legacyPriceTierToForm(item)]) : [defaultPriceTier()],
        priceCurrency: item?.priceCurrency || "credits",
        referenceVideoBilling: capability === "video" && item?.referenceVideoBilling === true,
        enabled: item?.enabled ?? true,
        capabilityConfig,
    };
}

export function duplicateChannelModelValues(item: ChannelModel, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const values = initialChannelModelValues(item, protocols);
    const sourceUpstream = normalizeUpstreamModelKey(item.providerModelKey || item.modelKey);
    return {
        ...values,
        modelKey: "",
        providerModelKey: "",
        priceTiers: values.priceTiers.map((tier) => (normalizeUpstreamModelKey(tier.providerModelKey) === sourceUpstream ? { ...tier, providerModelKey: "" } : tier)),
    };
}

// Clear incompatible selectors, but never silently convert prices or billing units.
export function changeChannelModelCapability(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = values.capability;
    const protocol = protocols.find((p) => p.value === values.protocol && p.capability === capability && p.enabled !== false)?.value || protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const capabilityConfig = capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    if (capabilityConfig?.image && protocols.find((p) => p.value === protocol)?.imageParameters) {
        capabilityConfig.image.parameters = [];
        if (!capabilityConfig.image.resolution.supported || !protocols.find((p) => p.value === protocol)?.imageParameters?.some((p) => p.name === "size" && p.encoding === "pixels" && !p.values?.length)) capabilityConfig.image.size.presets = undefined;
    }
    return updateChannelModelUpstreamCapabilities(
        {
            ...values,
            protocol,
            capabilityConfig,
            priceTiers: values.priceTiers.map((tier) => ({
                ...tier,
                operation: "*",
                imageSelector: {},
                imageResolution: "*",
                quality: "*",
                size: "*",
                resolution: "*",
                videoSeconds: 0,
                videoGenerateAudio: "*",
                imageCount: 0,
            })),
        },
        protocols,
    );
}

export function changeChannelModelProtocol(values: ChannelModelFormValues, protocol: string, protocols: ModelProtocolDefinition[] = []): ChannelModelFormValues {
    const next: ChannelModelFormValues = {
        ...values,
        protocol,
        capabilityConfig: values.capabilityConfig || (values.capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim())),
    };
    const resolved = updateChannelModelUpstreamCapabilities(next, protocols);
    if (values.capability === "image" && resolved.capabilityConfig?.image?.parameters && !values.capabilityConfig?.image?.parameters) {
        return {
            ...resolved,
            priceTiers: values.priceTiers.map((tier) => {
                const { operation: _operation, ...selector } = skuSelectorFromForm("image", tier, values.capabilityConfig);
                return { ...tier, imageSelector: { ...selector, ...tier.imageSelector } };
            }),
        };
    }
    return resolved;
}

export function updateChannelModelUpstreamCapabilities(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[] = []): ChannelModelFormValues {
    const workflows = protocols.find((p) => p.value === values.protocol)?.workflows;
    if (values.capability === "video" && workflows?.length) {
        // 工作流协议的画面规格必须写回表单；只在界面上投影会让保存提交旧协议的分辨率。
        const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
        const workflow = findProtocolWorkflow(workflows, values.protocol, values.providerModelKey?.trim() || values.modelKey.trim());
        if (!profile.video || !workflow) return values;
        const video = resolveWorkflowVideoScreenSpec(profile.video, workflow);
        if (JSON.stringify(video) === JSON.stringify(profile.video)) return values;
        return { ...values, capabilityConfig: { ...profile, video } };
    }
    const target = protocols.find((p) => p.value === values.protocol);
    const definitions = target?.imageParameters;
    if (values.capability === "image" && (definitions || values.capabilityConfig?.image?.parameters || standardImageSizeEncoding(target?.create))) {
        const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
        if (profile.image) {
            const fresh = profile.image.parameters?.length === 0;
            const resolved = resolveImageParameters(profile.image, definitions || [], values.providerModelKey?.trim() || values.modelKey.trim(), values.protocol, target?.create);
            return { ...values, capabilityConfig: { ...profile, image: fresh ? initializeImageRatioDefaults(resolved, resolved.parameters!, undefined, undefined, values.protocol) : resolved } };
        }
    }
    if (values.capability !== "image" || values.protocol !== "cangyuan-midjourney-v82") return values;
    const defaults = defaultModelCapabilityConfig(values.protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    const image = values.capabilityConfig?.image;
    if (!image) return { ...values, capabilityConfig: defaults };
    if (image.size.parameter !== "aspect_ratio") return values;
    const tier = defaults.image!.size.presets![0].tier;
    const presets = imageSizePresets(image);
    if (presets.length && presets.every((preset) => preset.tier === tier)) return values;
    const ratios = Array.from(new Set(presets.map((preset) => preset.ratio)));
    return {
        ...values,
        capabilityConfig: {
            ...values.capabilityConfig!,
            image: { ...image, size: { ...image.size, presets: ratios.length ? ratios.map((ratio) => imagePresetForRatio(tier, ratio)) : defaults.image!.size.presets } },
        },
    };
}

export function validateChannelModelProtocol(capability: string, protocol: string | undefined, protocols: ModelProtocolDefinition[]) {
    if (!protocols.some((p) => p.value === protocol && p.capability === capability && p.enabled !== false)) {
        throw new Error("请选择当前能力下已启用的请求协议");
    }
}

export function validateChannelModelPrices(values: Pick<ChannelModelFormValues, "capability" | "protocol" | "priceTiers" | "capabilityConfig"> & { referenceVideoBilling?: boolean; protocols?: ModelProtocolDefinition[] }) {
    const { capability, protocol, priceTiers } = values;
    const referenceVideoBilling = capability === "video" && values.referenceVideoBilling === true;
    if (!priceTiers?.length) throw new Error("请至少配置一个价格档");
    if (priceTiers.filter((tier) => tier.matchMode === "default").length > 1) throw new Error("只能配置一个所有规格统一价格");
    const selectorIssues = priceSelectorIssues(values);
    if (selectorIssues.length) throw new Error(selectorIssues.join("；"));
    const operations: Record<string, string[]> = {
        text: ["text_generation"],
        image: ["text_to_image", "image_to_image"],
        video: ["text_to_video", "image_to_video", "video_to_video", ...(values.capabilityConfig?.video?.processing ? ["enhance"] : [])],
        audio: [],
    };
    priceTiers.forEach((tier, index) => {
        const fail = (text: string) => {
            throw new Error(`价格档 ${index + 1}：${text}`);
        };
        if (!["fixed_request", "per_second", "token"].includes(tier.billingMode)) fail("请选择计费方式");
        if (tier.billingMode === "per_second" && capability !== "video" && capability !== "audio") fail("按秒计费仅支持视频或音频，请重新选择计费方式并核对价格");
        if (tier.billingMode === "token" && !modelProtocolSupportsTokenBilling(capability, protocol)) fail("当前模型能力不支持 Token 计费，请重新选择计费方式并核对价格");
        if (tier.matchMode === "advanced") {
            if (tier.operation && tier.operation !== "*" && !operations[capability]?.includes(tier.operation)) fail("生成方式与模型能力不匹配");
            const specific = (value: string | undefined) => Boolean(value && value !== "*");
            const image = values.capabilityConfig?.image;
            const imageCondition =
                Object.values(tier.imageSelector || {}).some(specific) ||
                (image?.resolution.supported !== false && specific(tier.imageResolution)) ||
                (image?.quality.supported !== false && specific(tier.quality)) ||
                specific(tier.resolution) ||
                specific(tier.size);
            if (!(specific(tier.operation) || (capability === "image" && imageCondition) || (capability === "video" && (specific(tier.resolution) || (values.capabilityConfig?.video?.processing && specific(tier.fpsBand))))))
                fail("规格价格至少需要一个匹配条件；统一价格请选择默认价格");
        }
        const prices =
            tier.billingMode !== "token" ? [tier.unitPrice] : capability === "video" ? [tier.outputTokenPrice] : [tier.inputTokenPrice, tier.outputTokenPrice, tier.cachedTokenPrice, tier.cacheWriteTokenPrice === undefined ? 0 : tier.cacheWriteTokenPrice];
        const unconfigured = tier.priceConfigured === false && tier.enabled === false;
        if (prices.some((price) => !(unconfigured && (price === null || price === undefined)) && (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)))
            fail("积分价格必须是 0 到 1000000 之间的有效数值；空金额未配置，不能启用");
        if (referenceVideoBilling && tier.priceConfigured !== false && tier.enabled !== false && (tier.billingMode === "per_second" || tier.billingMode === "token")) {
            const [base, reference] = tier.billingMode === "per_second" ? [tier.unitPrice, tier.referenceVideoUnitPrice] : [tier.outputTokenPrice, tier.referenceVideoOutputTokenPrice];
            if (typeof reference !== "number" || !Number.isFinite(reference) || reference < 0 || reference > 1_000_000) fail("带参考视频的价格必须是 0 到 1000000 之间的有效数值");
            // 与后端一致：基础价收费时带参考视频价不能为 0，避免挂参考视频反而免费。
            if (typeof base === "number" && base > 0 && reference === 0) fail("已开启参考视频计费，请填写带参考视频的价格");
        }
        if (tier.costConfigured) {
            const costs = tier.billingMode !== "token" ? [tier.costUnitPrice] : capability === "video" ? [tier.costOutputTokenPrice] : [tier.costInputTokenPrice, tier.costOutputTokenPrice, tier.costCachedTokenPrice, tier.costCacheWriteTokenPrice ?? 0];
            if (costs.some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)) fail("积分成本价必须是 0 到 1000000 之间的有效数值");
            if (referenceVideoBilling && tier.priceConfigured !== false && tier.enabled !== false && (tier.billingMode === "per_second" || tier.billingMode === "token")) {
                const [baseCost, referenceCost] = tier.billingMode === "per_second" ? [tier.costUnitPrice, tier.costReferenceVideoUnitPrice] : [tier.costOutputTokenPrice, tier.costReferenceVideoOutputTokenPrice];
                if (typeof referenceCost !== "number" || !Number.isFinite(referenceCost) || referenceCost < 0 || referenceCost > 1_000_000) fail("带参考视频的成本价必须是 0 到 1000000 之间的有效数值");
                // 与后端一致：基础成本价不为 0 时必须填写带参考视频成本价，避免挂参考视频的订单记成 0 成本。
                if (baseCost > 0 && referenceCost === 0) fail("已开启参考视频计费，请填写带参考视频的成本价");
            }
        }
        if (capability === "text" && tier.billingMode === "token") {
            try {
                validateTokenPriceRules(tier, tier.tokenRules);
            } catch (error) {
                fail(error instanceof Error ? error.message : "分时与上下文价格无效");
            }
        }
    });
}

/** 与后端 normalizeTokenPriceRules 同口径；只校验会被提交的文本 Token 档规则。 */
export function validateTokenPriceRules(tier: Pick<PriceTierFormValues, "tokenRulesEnabled"> | undefined, rules: TokenPriceRuleFormValues[] | undefined) {
    const list = rules || [];
    if (tier?.tokenRulesEnabled && !list.length) throw new Error("已启用分时与上下文价格，请至少添加一条规则");
    if (list.length > 48) throw new Error("每个价格档最多 48 条分时与上下文规则");
    list.forEach((rule, index) => {
        const fail = (text: string) => {
            throw new Error(`分时规则 ${index + 1}：${text}`);
        };
        if (!rule?.weekdays?.length) fail("请至少选择一天");
        const start = tokenRuleClockMinutes(rule.start);
        const end = tokenRuleClockMinutes(rule.end, true);
        if (start === null) fail("开始时间格式为 HH:MM（00:00–23:59）");
        if (end === null) fail("结束时间格式为 HH:MM，最晚 24:00");
        if (start! >= end!) fail("结束时间必须晚于开始时间；跨零点请拆成两条规则");
        const min = rule.minInputTokens ?? 0;
        if (!Number.isInteger(min) || min < 0) fail("输入上下文下限必须是不小于 0 的整数");
        if (rule.maxInputTokens !== null && rule.maxInputTokens !== undefined && (!Number.isInteger(rule.maxInputTokens) || rule.maxInputTokens <= min)) fail("输入上下文上限必须大于下限，或留空表示不限");
        const prices = [rule.inputTokenPrice, rule.outputTokenPrice, rule.cachedTokenPrice, rule.cacheWriteTokenPrice ?? 0];
        if (prices.some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)) fail("Token 价格必须是 0 到 1000000 之间的有效数值");
    });
}
