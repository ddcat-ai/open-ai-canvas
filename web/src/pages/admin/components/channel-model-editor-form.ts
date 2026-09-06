import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolSupportsTokenBilling, type ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ChannelModel } from "@/services/api/wallet";
import { defaultPriceTier, legacyPriceTierToForm, priceTierToForm, type PriceTierFormValues } from "./channel-model-price-tier-form";

export type ChannelModelFormValues = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    icon?: string;
    capability: ModelCapabilityChoice;
    protocol?: string;
    priceTiers: PriceTierFormValues[];
    enabled: boolean;
    capabilityConfig?: ModelCapabilityConfig;
};

export type EditorSection = "identity" | "capabilities" | "pricing";

export function editorSectionForField(name: (string | number)[]): EditorSection {
    return name[0] === "priceTiers" ? "pricing" : name[0] === "capabilityConfig" ? "capabilities" : "identity";
}

export function initialChannelModelValues(item: ChannelModel | null, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = item?.capability || "text";
    const protocol = item ? item.protocol : protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const upstreamModel = item?.providerModelKey || item?.modelKey || "";
    return {
        modelKey: item?.modelKey || "",
        providerModelKey: upstreamModel,
        displayName: item?.displayName || "",
        icon: item?.icon || "",
        capability,
        protocol,
        priceTiers: item ? (item.priceTiers?.length ? item.priceTiers.map(priceTierToForm) : [legacyPriceTierToForm(item)]) : [defaultPriceTier()],
        enabled: item?.enabled ?? true,
        capabilityConfig: capability === "audio" ? undefined : normalizeModelCapabilityConfig(item?.capabilityConfig || defaultModelCapabilityConfig(protocol, upstreamModel)),
    };
}

// Clear incompatible selectors, but never silently convert prices or billing units.
export function changeChannelModelCapability(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = values.capability;
    const protocol = protocols.find((p) => p.value === values.protocol && p.capability === capability && p.enabled !== false)?.value || protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    return {
        ...values,
        protocol,
        capabilityConfig: capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim()),
        priceTiers: values.priceTiers.map((tier) => ({
            ...tier,
            operation: "*",
            quality: "*",
            size: "*",
            resolution: "*",
            videoSeconds: 0,
            imageCount: 0,
        })),
    };
}

export function validateChannelModelProtocol(capability: string, protocol: string | undefined, protocols: ModelProtocolDefinition[]) {
    if (!protocols.some((p) => p.value === protocol && p.capability === capability && p.enabled !== false)) {
        throw new Error("请选择当前能力下已启用的请求协议");
    }
}

export function validateChannelModelPrices(values: Pick<ChannelModelFormValues, "capability" | "protocol" | "priceTiers">) {
    const { capability, protocol, priceTiers } = values;
    if (!priceTiers?.length) throw new Error("请至少配置一个价格档");
    if (priceTiers.filter((tier) => tier.matchMode === "default").length > 1) throw new Error("只能配置一个所有规格统一价格");
    const operations: Record<string, string[]> = {
        text: ["text_generation"],
        image: ["text_to_image", "image_to_image"],
        video: ["text_to_video", "image_to_video", "video_to_video"],
        audio: [],
    };
    priceTiers.forEach((tier, index) => {
        const fail = (text: string) => {
            throw new Error(`价格档 ${index + 1}：${text}`);
        };
        if (!["fixed_request", "per_second", "token"].includes(tier.billingMode)) fail("请选择计费方式");
        if (tier.billingMode === "per_second" && capability !== "video") fail("按秒计费仅支持视频，请重新选择计费方式并核对价格");
        if (tier.billingMode === "token" && !modelProtocolSupportsTokenBilling(capability, protocol)) fail("当前协议不支持 Token 计费，请重新选择计费方式并核对价格");
        if (tier.matchMode === "advanced") {
            if (tier.operation && tier.operation !== "*" && !operations[capability]?.includes(tier.operation)) fail("生成方式与模型能力不匹配");
            const specific = (value: string | undefined) => Boolean(value && value !== "*");
            if (!(specific(tier.operation) || (capability === "image" && (specific(tier.quality) || specific(tier.size))) || (capability === "video" && (specific(tier.resolution) || tier.videoSeconds > 0 || tier.imageCount > 0))))
                fail("规格价格至少需要一个匹配条件；统一价格请选择默认价格");
        }
        const prices = tier.billingMode !== "token" ? [tier.unitPrice] : capability === "video" ? [tier.outputTokenPrice] : [tier.inputTokenPrice, tier.outputTokenPrice, tier.cachedTokenPrice];
        if (prices.some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)) fail("积分价格必须是 0 到 1000000 之间的有效数值");
        if (tier.billingMode === "token" && capability === "video" && tier.outputTokenPrice < 0.000001) fail("视频 Token 价格必须至少为 0.000001");
    });
}
