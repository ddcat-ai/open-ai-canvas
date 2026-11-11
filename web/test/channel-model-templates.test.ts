import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { initialChannelModelValues, validateChannelModelPrices } from "../src/pages/admin/components/channel-model-editor-form";
import { defaultPriceTier, priceTierAmountsComplete, priceTierPayloadFromForm, priceTierToForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import { applyCapabilityTemplate, buildPricingTemplate, capabilityTemplateReason, priceSelectorIssues, pricingDimensions } from "../src/pages/admin/components/channel-model-templates";
import type { ChannelModelPriceTier } from "../src/services/api/wallet";

const protocols: ModelProtocolDefinition[] = await Promise.all(
    ["openai-images", "google-gemini-image"].map(async (name) => {
        const manifest = await Bun.file(new URL(`../../plugin-packages/${name}/manifest.json`, import.meta.url)).json();
        const provider = manifest.contributes.providers[0];
        return { value: provider.id, label: provider.label, capability: "image", imageParameters: provider.imageParameters, create: "POST /test", contentType: "application/json", media: "image" };
    }),
);
const draft = () => ({
    ...initialChannelModelValues(null, protocols),
    capability: "image" as const,
    protocol: "openai-image",
    modelKey: "gpt-image-2",
    providerModelKey: "gpt-image-2",
    capabilityConfig: defaultModelCapabilityConfig("openai-image", "gpt-image-2"),
});

test("能力模板显式应用且仅改声明字段，保留媒体传输、扩展与所有价格", () => {
    const original = draft();
    original.capabilityConfig = { ...original.capabilityConfig, mediaTransport: { image: "url" }, extension: { keep: true } } as typeof original.capabilityConfig;
    original.priceTiers = [{ ...defaultPriceTier("advanced"), imageSelector: { quality: "old-quality" }, unitPrice: 13, cacheWriteTokenPrice: 2, tokenRulesEnabled: true }];
    const snapshot = structuredClone(original);
    const result = applyCapabilityTemplate("gpt-image-openai-v1", original);
    expect(original).toEqual(snapshot);
    expect(result.priceTiers).toBe(original.priceTiers);
    expect(result.capabilityConfig?.mediaTransport).toEqual(original.capabilityConfig.mediaTransport);
    expect((result.capabilityConfig as any).extension).toEqual({ keep: true });
    expect(result.capabilityConfig?.image?.parameters?.map((field) => field.name)).toEqual(protocols[0].imageParameters!.map((field) => field.name));
    expect(result.capabilityConfig?.image?.references.maxImages).toBe(defaultModelCapabilityConfig("openai-image", "gpt-image-2").image!.references.maxImages);
});

test("内置模板无需来源插件或指定型号，应用保留目标协议，类型仍隔离", () => {
    const values = { ...draft(), protocol: "another-image", providerModelKey: "other-model" };
    expect(capabilityTemplateReason("gpt-image-openai-v1", values)).toBe("");
    expect(() => applyCapabilityTemplate("gpt-image-openai-v1", { ...values, capability: "video" })).toThrow("图片能力");
    const nano = applyCapabilityTemplate("nano-banana-gemini-v1", values);
    expect(nano.protocol).toBe("another-image");
    expect(nano.providerModelKey).toBe("other-model");
    // 固定版本模板独立于当前安装插件的参数范围。
    expect(nano.capabilityConfig?.image?.parameters?.find((field) => field.name === "imageResolution")?.values).toEqual(["auto", "1k", "2k", "4k"]);
});

test("能力模板留下不兼容价格条件并阻止保存，不会变成通配收费", () => {
    const values = draft();
    values.providerModelKey = "gemini-3-pro-image-preview";
    values.priceTiers = [{ ...defaultPriceTier("advanced"), imageSelector: { quality: "high" }, unitPrice: 10 }];
    const next = applyCapabilityTemplate("nano-banana-gemini-v1", values);
    expect(next.priceTiers[0].imageSelector).toEqual({ quality: "high" });
    expect(priceSelectorIssues(next)[0]).toContain("quality=high");
    expect(() => validateChannelModelPrices(next)).toThrow("不受当前参数支持");
});

test("定价模板只展开开启且允许计价的值，保留币种且不携带旧金额", () => {
    const values = applyCapabilityTemplate("gpt-image-openai-v1", draft());
    const resolution = values.capabilityConfig!.image!.parameters!.find((field) => field.name === "imageResolution")!;
    resolution.values = ["1k", "2k"];
    const dimensions = pricingDimensions(values);
    expect(dimensions.find((item) => item.id === "image:imageResolution")!.values).toEqual(["1k", "2k"]);
    expect(dimensions.some((item) => item.id === "image:count")).toBe(false);
    const tiers = buildPricingTemplate("specification", ["image:imageResolution"], values);
    expect(tiers.map((tier) => tier.imageSelector)).toEqual([{ imageResolution: "1k" }, { imageResolution: "2k" }]);
    for (const tier of tiers) expect(tier).toMatchObject({ unitPrice: null, priceConfigured: false, enabled: false, costConfigured: false });
    expect(() => validateChannelModelPrices({ ...values, priceTiers: tiers })).not.toThrow();
    resolution.enabled = false;
    expect(() => buildPricingTemplate("specification", ["image:imageResolution"], values)).toThrow("维度已变更");
    resolution.enabled = true;
    resolution.values = ["1k", "8k"];
    expect(buildPricingTemplate("specification", ["image:imageResolution"], { ...values, protocols }).map((tier) => tier.imageSelector)).toEqual([{ imageResolution: "1k" }, { imageResolution: "8k" }]);
    expect(priceSelectorIssues({ ...values, protocols, priceTiers: [{ ...tiers[0], imageSelector: { imageResolution: "8k" } }] })).toEqual([]);
});

test("空价可作为停用结构保存，不能启用；显式零价仍可免费", () => {
    const values = draft();
    const [tier] = buildPricingTemplate("fixed", [], values);
    const payload = priceTierPayloadFromForm("image", tier, "gpt-image-2");
    expect(payload).toMatchObject({ unitPriceMicrocredits: 0, priceConfigured: false, enabled: false });
    expect(priceTierToForm(payload as ChannelModelPriceTier).unitPrice).toBeNull();
    const legacyUnconfigured = { ...payload, enabled: true } as ChannelModelPriceTier;
    expect(priceTierPayloadFromForm("image", priceTierToForm(legacyUnconfigured), "gpt-image-2")).toEqual(legacyUnconfigured);
    expect(priceTierAmountsComplete("image", tier)).toBe(false);
    expect(() => priceTierPayloadFromForm("image", { ...tier, enabled: true }, "gpt-image-2")).toThrow("空金额");
    expect(() => validateChannelModelPrices({ ...values, priceTiers: [{ ...tier, enabled: true }] })).toThrow("空金额");
    const free = { ...tier, unitPrice: 0, enabled: true, priceConfigured: true };
    expect(priceTierAmountsComplete("image", free)).toBe(true);
    expect(() => validateChannelModelPrices({ ...values, priceTiers: [free] })).not.toThrow();
    expect(priceTierPayloadFromForm("image", free, "gpt-image-2")).toMatchObject({ unitPriceMicrocredits: 0, priceConfigured: true, enabled: true });
});

test("视频模板使用当前操作与分辨率；秒、Token、参考视频价格独立留空", () => {
    const values = { ...draft(), capability: "video" as const, protocol: "video", capabilityConfig: defaultModelCapabilityConfig("video") };
    values.capabilityConfig.video!.resolutions = ["720p"];
    values.capabilityConfig.video!.operations = ["text_to_video"];
    const seconds = buildPricingTemplate("seconds", ["resolution"], values);
    expect(seconds).toHaveLength(1);
    expect(seconds[0]).toMatchObject({ resolution: "720p", billingMode: "per_second", unitPrice: null, referenceVideoUnitPrice: null });
    const [tokens] = buildPricingTemplate("tokens", [], values);
    expect(tokens.outputTokenPrice).toBeNull();
    expect(priceTierAmountsComplete("video", { ...tokens, outputTokenPrice: 2 }, true)).toBe(false);
    expect(() => buildPricingTemplate("seconds", [], draft())).toThrow("视频");
    expect(() => buildPricingTemplate("tokens", [], draft())).toThrow("Token");
    const [text] = buildPricingTemplate("tokens", [], { ...values, capability: "text" });
    expect(text.cacheWriteTokenPrice).toBeNull();
    expect(priceTierAmountsComplete("text", { ...text, inputTokenPrice: 1, outputTokenPrice: 1, cachedTokenPrice: 0 })).toBe(false);
});

test("限制组合数量，重复选择器和同优先级冲突在保存前报告", () => {
    const values = draft();
    values.capabilityConfig.image!.size.values = Array.from({ length: 60 }, (_, i) => `${i + 1}:1`);
    expect(() => buildPricingTemplate("specification", ["size"], values)).toThrow("最多允许 48");
    const tiers = [
        { ...defaultPriceTier("advanced"), size: "1:1" },
        { ...defaultPriceTier("advanced"), quality: "high" },
    ];
    expect(priceSelectorIssues({ ...values, priceTiers: tiers }).join()).toContain("同优先级重叠");
    expect(() => validateChannelModelPrices({ ...values, priceTiers: [tiers[0], tiers[0]] })).toThrow("重复");
});

test("视频处理计价帧率档遵循固定合同，keep_source 无 fpsOptions 仍可生成和保存三档", () => {
    const values = { ...draft(), capability: "video" as const, protocol: "volcengine-mediakit-enhance-video", capabilityConfig: defaultModelCapabilityConfig("volcengine-mediakit-enhance-video") };
    expect(values.capabilityConfig.video?.processing).toMatchObject({ fpsPolicy: "keep_source" });
    expect(values.capabilityConfig.video?.processing?.fpsOptions).toBeUndefined();
    expect(pricingDimensions(values).find((dimension) => dimension.id === "fpsBand")?.values).toEqual(["le30", "le60", "le120"]);
    const tiers = buildPricingTemplate("seconds", ["fpsBand"], values);
    expect(tiers.map((tier) => tier.fpsBand)).toEqual(["le30", "le60", "le120"]);
    expect(tiers.every((tier) => tier.unitPrice === null && !tier.enabled && !tier.priceConfigured)).toBe(true);
    expect(() => validateChannelModelPrices({ ...values, priceTiers: tiers })).not.toThrow();
    const configured = tiers.map((tier, index) => ({ ...tier, unitPrice: index + 1, enabled: true, priceConfigured: true }));
    expect(() => validateChannelModelPrices({ ...values, priceTiers: configured })).not.toThrow();
    expect(configured.map((tier) => priceTierPayloadFromForm("video", tier, "enhance", values.capabilityConfig).selector)).toEqual([{ fpsBand: "le30" }, { fpsBand: "le60" }, { fpsBand: "le120" }]);
    values.capabilityConfig.video!.processing = { fpsPolicy: "user_select", fpsOptions: [24, 60] };
    expect(pricingDimensions(values).find((dimension) => dimension.id === "fpsBand")?.values).toEqual(["le30", "le60", "le120"]);
    expect(() => validateChannelModelPrices({ ...values, priceTiers: [{ ...configured[0], fpsBand: "le240" }] })).toThrow("不受当前参数支持");
    values.capabilityConfig.video!.processing = undefined;
    expect(pricingDimensions(values).some((dimension) => dimension.id === "fpsBand")).toBe(false);
    expect(() => buildPricingTemplate("seconds", ["fpsBand"], values)).toThrow("维度已变更");
    expect(() => validateChannelModelPrices({ ...values, priceTiers: configured })).toThrow("不受当前参数支持");
});
