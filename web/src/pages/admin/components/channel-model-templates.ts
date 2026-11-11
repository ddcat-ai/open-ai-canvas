import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { imageHostControls, imageParameterAccepts, initializeImageRatioDefaults, resolveImageParameters, type ImageParameter } from "@/lib/image-parameters";
import { imageResolutionTiers } from "@/lib/image-size-presets";
import { normalizeTierResolution } from "@/lib/model-pricing";
import { modelProtocolSupportsTokenBilling, type ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ChannelModelFormValues } from "./channel-model-editor-form";
import { defaultPriceTier, skuSelectorFromForm, type PriceTierFormValues } from "./channel-model-price-tier-form";

// 固定版本的能力预设。来源仅用于构造默认参数，不要求安装来源协议，也不限定目标型号。
const presetParameters: Record<string, ImageParameter[]> = {
    "gpt-image-openai-v1": [
        { name: "size", label: "画幅 / 尺寸", type: "string", binding: "aspectRatio", encoding: "pixels", pricing: true },
        { name: "imageResolution", label: "分辨率", type: "string", binding: "resolution", values: ["auto", "1k", "2k", "4k"], default: "1k", pricing: true },
        { name: "quality", label: "图片质量", type: "string", binding: "quality", pricing: true },
        { name: "count", label: "生成数量", type: "integer", binding: "imageCount", min: 1, max: 100, step: 1, default: 1 },
        { name: "transparentBackground", label: "透明背景", type: "boolean", binding: "transparentBackground", default: false, enabled: false },
        { name: "outputFormat", label: "输出格式", type: "string", binding: "providerOptions.openai-image.output_format", values: ["png", "jpeg", "webp"], default: "png", enabled: false },
        { name: "outputCompression", label: "压缩质量", type: "integer", binding: "providerOptions.openai-image.output_compression", min: 0, max: 100, step: 1, enabled: false },
    ],
    "nano-banana-gemini-v1": [
        { name: "size", label: "画幅比例", type: "string", binding: "aspectRatio", encoding: "ratio", values: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], default: "1:1" },
        { name: "imageResolution", label: "分辨率", type: "string", binding: "resolution", values: ["auto", "1k", "2k", "4k"], default: "1k", pricing: true },
        { name: "count", label: "生成数量", type: "integer", binding: "imageCount", min: 1, max: 1, step: 1, default: 1 },
        { name: "seed", label: "随机种子", type: "integer", binding: "providerOptions.gemini-image.seed", enabled: false },
        { name: "temperature", label: "随机程度", type: "number", binding: "providerOptions.gemini-image.temperature", min: 0, max: 2, enabled: false },
    ],
};

export const capabilityTemplates = [
    { id: "gpt-image-openai-v1", version: 1, name: "GPT Image · OpenAI Images", sourceProtocol: "openai-image", sourceModel: "gpt-image-2" },
    {
        id: "nano-banana-gemini-v1",
        version: 1,
        name: "Nano Banana · Gemini Image",
        sourceProtocol: "gemini-image",
        sourceModel: "gemini-3-pro-image-preview",
    },
] as const;

export function capabilityTemplateReason(id: string, values: Pick<ChannelModelFormValues, "capability">) {
    const template = capabilityTemplates.find((item) => item.id === id);
    if (!template) return "请选择能力模板";
    if (values.capability !== "image") return "此模板只适用于图片能力";
    return "";
}

export function applyCapabilityTemplate(id: string, values: ChannelModelFormValues): ChannelModelFormValues {
    const reason = capabilityTemplateReason(id, values);
    if (reason) throw new Error(reason);
    const template = capabilityTemplates.find((item) => item.id === id)!;
    const defaults = defaultModelCapabilityConfig(template.sourceProtocol, template.sourceModel).image!;
    const resolved = resolveImageParameters({ ...defaults, size: { ...defaults.size, presets: undefined }, parameters: [] }, structuredClone(presetParameters[id]), template.sourceModel, template.sourceProtocol);
    const image = initializeImageRatioDefaults(resolved, resolved.parameters!, undefined, undefined, template.sourceProtocol);
    const previous = values.capabilityConfig?.image;
    return {
        ...values,
        capabilityConfig: {
            ...(values.capabilityConfig || defaultModelCapabilityConfig()),
            image: {
                ...previous,
                ...image,
                references: { ...previous?.references, ...image.references },
                size: { ...previous?.size, ...image.size },
                resolution: { ...previous?.resolution, ...image.resolution },
                quality: { ...previous?.quality, ...image.quality },
                transparentBackground: { ...previous?.transparentBackground, ...image.transparentBackground },
                responseFormat: { ...previous?.responseFormat, ...image.responseFormat },
                outputFormat: { ...previous?.outputFormat, ...image.outputFormat },
            },
        },
        // 应用能力预设保留目标协议、模型身份和价格，保存模型时再校验最终组合。
        priceTiers: values.priceTiers,
    };
}

export type PricingTemplateId = "fixed" | "specification" | "seconds" | "tokens";
export const pricingTemplates = [
    { id: "fixed", name: "统一按次", billingMode: "fixed_request", unit: "每次" },
    { id: "specification", name: "按规格按次", billingMode: "fixed_request", unit: "每次" },
    { id: "seconds", name: "视频按秒", billingMode: "per_second", unit: "每秒" },
    { id: "tokens", name: "文本 / 视频 Token", billingMode: "token", unit: "每百万 Token" },
] as const;
export const MAX_TEMPLATE_PRICE_TIERS = 48;
export type PricingDimension = { id: string; label: string; values: string[]; field: string; imageParameter?: boolean };
type PricingContext = Pick<ChannelModelFormValues, "capability" | "protocol" | "capabilityConfig"> & { protocols?: ModelProtocolDefinition[] };

export function pricingDimensions(values: PricingContext): PricingDimension[] {
    const dimensions: PricingDimension[] = [];
    const add = (id: string, label: string, choices: string[], field = id, imageParameter = false) => {
        const unique = [...new Set(choices.filter((value) => value && value !== "*" && value !== "auto"))];
        if (unique.length) dimensions.push({ id, label, values: unique, field, imageParameter });
    };
    if (values.capability === "image") {
        const image = values.capabilityConfig?.image;
        if (!image) return dimensions;
        add("operation", "生成方式", ["text_to_image", ...(image.references.maxImages > 0 ? ["image_to_image"] : [])]);
        if (image.parameters) {
            const definitions = values.protocols?.find((protocol) => protocol.value === values.protocol)?.imageParameters;
            for (const field of image.parameters) {
                if (field.enabled === false || !field.pricing) continue;
                const definition = definitions?.find((item) => item.name === field.name && item.pricing);
                if (definitions && !definition && !imageHostControls.has(field.name)) continue;
                const candidates = field.values || (field.type === "boolean" ? [true, false] : []);
                const choices = candidates.filter((value) => imageHostControls.has(field.name) || !definition || imageParameterAccepts(definition, value)).map(String);
                add(`image:${field.name}`, field.label, choices, field.name, true);
            }
        } else {
            if (image.resolution.supported) add("imageResolution", "分辨率", image.resolution.values);
            else add("imageResolution", "分辨率", imageResolutionTiers(image));
            if (image.quality.supported) add("quality", "画质", image.quality.values);
            if (image.size.parameter !== "none") add("size", "画幅 / 尺寸", image.size.values);
        }
    }
    if (values.capability === "video") {
        const video = values.capabilityConfig?.video;
        if (!video) return dimensions;
        add(
            "operation",
            "生成方式",
            video.operations.filter((operation) => ["text_to_video", "image_to_video", "video_to_video", "enhance"].includes(operation)),
        );
        add("resolution", "分辨率", [...video.resolutions, ...(video.fixedScreenSpec?.resolutions || [])].map(normalizeTierResolution));
        // processing 的计价合同固定声明三档（后端 videoProcessingFPSBands）；
        // fpsOptions 只限制用户可选的输出帧率，keep_source 不需要提供该列表。
        if (video.processing) add("fpsBand", "输出帧率档", ["le30", "le60", "le120"]);
    }
    return dimensions;
}

export function pricingTemplateReason(id: string, values: PricingContext) {
    if (!pricingTemplates.some((item) => item.id === id)) return "请选择定价模板";
    if (id === "seconds" && values.capability !== "video") return "视频按秒模板只适用于视频能力";
    if (id === "tokens" && !modelProtocolSupportsTokenBilling(values.capability, values.protocol)) return "当前能力不支持 Token 计费";
    if (id === "specification" && !pricingDimensions(values).length) return "当前能力没有已开启的可枚举计价维度";
    return "";
}

export function buildPricingTemplate(id: string, selectedDimensions: string[], values: PricingContext): PriceTierFormValues[] {
    const reason = pricingTemplateReason(id, values);
    if (reason) throw new Error(reason);
    const template = pricingTemplates.find((item) => item.id === id)!;
    const available = pricingDimensions(values);
    const selected =
        id === "fixed"
            ? []
            : [...new Set(selectedDimensions)].map((key) => {
                  const dimension = available.find((item) => item.id === key);
                  if (!dimension) throw new Error("计价维度已变更，请重新选择");
                  return dimension;
              });
    if (id === "specification" && !selected.length) throw new Error("请选择至少一个计价维度");
    const count = selected.reduce((total, item) => total * item.values.length, 1);
    if (count > MAX_TEMPLATE_PRICE_TIERS) throw new Error(`将生成 ${count} 个档位，最多允许 ${MAX_TEMPLATE_PRICE_TIERS} 个；请减少计价维度`);
    let tiers: PriceTierFormValues[] = [
        {
            ...defaultPriceTier(selected.length ? "advanced" : "default"),
            billingMode: template.billingMode,
            unitPrice: null,
            inputTokenPrice: null,
            outputTokenPrice: null,
            cachedTokenPrice: null,
            cacheWriteTokenPrice: null,
            referenceVideoUnitPrice: null,
            referenceVideoOutputTokenPrice: null,
            priceConfigured: false,
            enabled: false,
        },
    ];
    for (const dimension of selected) tiers = tiers.flatMap((tier) => dimension.values.map((value) => (dimension.imageParameter ? { ...tier, imageSelector: { ...tier.imageSelector, [dimension.field]: value } } : { ...tier, [dimension.field]: value })));
    return tiers;
}

export function priceSelectorIssues(values: PricingContext & { priceTiers: PriceTierFormValues[] }): string[] {
    const issues: string[] = [];
    const dimensions = pricingDimensions(values);
    const specific = (value: unknown) => value !== undefined && value !== "" && value !== "*";
    const selectors = values.priceTiers.map((tier, index) => {
        const fail = (message: string) => issues.push(`价格档 ${index + 1}：${message}`);
        if (tier.matchMode === "advanced") {
            if (specific(tier.operation)) {
                const operations = values.capability === "text" ? ["text_generation"] : dimensions.find((item) => item.id === "operation")?.values;
                if (operations && !operations.includes(tier.operation)) fail(`生成方式 ${tier.operation} 与当前模型能力不匹配`);
            }
            if (values.capability === "image" && values.capabilityConfig?.image) {
                const image = values.capabilityConfig.image;
                if (image.parameters) {
                    for (const [name, value] of Object.entries(tier.imageSelector || {})) {
                        if (!specific(value)) continue;
                        const field = image.parameters.find((item) => item.name === name && item.enabled !== false && item.pricing);
                        const typed = field?.type === "boolean" ? (value === "true" ? true : value === "false" ? false : value) : field?.type === "number" || field?.type === "integer" ? Number(value) : value;
                        const definitions = values.protocols?.find((protocol) => protocol.value === values.protocol)?.imageParameters;
                        const definition = definitions?.find((item) => item.name === name && item.pricing);
                        if (!field || !imageParameterAccepts(field, typed) || (!imageHostControls.has(name) && definitions && (!definition || !imageParameterAccepts(definition, typed))))
                            fail(`条件 ${name}=${value} 不受当前参数支持，请调整或删除该价格档`);
                    }
                    for (const name of ["imageResolution", "quality", "size"] as const) {
                        if (specific(tier[name]) && !specific(tier.imageSelector?.[name])) fail(`旧条件 ${name}=${tier[name]} 尚未映射到当前协议，请重新设置`);
                    }
                } else {
                    for (const name of ["imageResolution", "quality", "size"] as const) {
                        if (!specific(tier[name])) continue;
                        const dimension = dimensions.find((item) => item.id === name);
                        if (!dimension?.values.includes(tier[name]) && !(name === "size" && image.size.allowCustom)) fail(`条件 ${name}=${tier[name]} 不受当前参数支持`);
                    }
                }
            }
            if (values.capability === "video" && values.capabilityConfig?.video) {
                for (const field of ["resolution", "fpsBand"] as const) {
                    if (specific(tier[field]) && !dimensions.find((item) => item.id === field)?.values.includes(field === "resolution" ? normalizeTierResolution(tier[field]) : tier[field])) fail(`条件 ${field}=${tier[field]} 不受当前参数支持`);
                }
            }
        }
        return skuSelectorFromForm(values.capability, tier, values.capabilityConfig);
    });
    selectors.forEach((selector, index) => {
        const entries = Object.entries(selector);
        for (let previous = 0; previous < index; previous++) {
            const other = selectors[previous];
            if (Object.keys(other).length !== entries.length) continue;
            if (entries.every(([key, value]) => other[key] === undefined || other[key] === value)) issues.push(`价格档 ${previous + 1} 与 ${index + 1} 条件重复或同优先级重叠，请调整`);
        }
    });
    return issues;
}

export function priceTierTemplateSummary(tier: PriceTierFormValues) {
    const conditions = Object.entries({ operation: tier.operation, ...(tier.imageSelector || {}), imageResolution: tier.imageResolution, quality: tier.quality, size: tier.size, resolution: tier.resolution, fpsBand: tier.fpsBand }).filter(
        ([, value]) => value && value !== "*",
    );
    return tier.matchMode === "default" ? "所有规格" : conditions.map(([key, value]) => `${key}=${value}`).join(" · ");
}
