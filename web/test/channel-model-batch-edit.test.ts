import { expect, test } from "bun:test";
import { batchChannelModelUpdates, assertBatchModelSelectionCurrent } from "../src/pages/admin/components/channel-model-batch-edit";
import { defaultPriceTier } from "../src/pages/admin/components/channel-model-price-tier-form";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { SavedCapabilityTemplate } from "../src/pages/admin/components/saved-capability-templates";
import { batchModel, batchPricing, batchProtocols, batchTemplateAvailabilityPayloads, batchTier } from "./fixtures/channel-model-batch-edit.fixtures";

test("批量修改只提交显式勾选字段，保留原始更新时间精度和源模型", () => {
    const models = [batchModel(), batchModel({ id: "second", channelId: "other", capabilityVersion: undefined })];
    const before = structuredClone(models);
    const changes = batchChannelModelUpdates(models, { displayName: "  新目录  ", description: "" }, batchProtocols);
    expect(changes.map((item) => item.changes)).toEqual([
        { displayName: "新目录", description: "" },
        { displayName: "新目录", description: "" },
    ]);
    expect(changes[0].updatedAt).toBe("2026-11-09T02:00:00.123456789Z");
    expect(changes[1].capabilityVersion).toBe(0);
    expect(models).toEqual(before);
});

test("默认不修改、空选择、重复选择、超限和超长备注均拒绝", () => {
    expect(() => batchChannelModelUpdates([batchModel()], {}, batchProtocols)).toThrow("请勾选");
    expect(() => batchChannelModelUpdates([], { enabled: true }, batchProtocols)).toThrow("1–100");
    expect(() => batchChannelModelUpdates([batchModel(), batchModel()], { enabled: true }, batchProtocols)).toThrow("重复");
    expect(() =>
        batchChannelModelUpdates(
            Array.from({ length: 101 }, (_, index) => batchModel({ id: String(index) })),
            { enabled: false },
            batchProtocols,
        ),
    ).toThrow("1–100");
    expect(() => batchChannelModelUpdates([batchModel()], { description: "字".repeat(501) }, batchProtocols)).toThrow("500");
});

test("模型停用和可供用户使用互相独立，未选择价格模板不重写价档", () => {
    expect(batchChannelModelUpdates([batchModel()], { enabled: false }, batchProtocols)[0].changes).toEqual({ enabled: false });
    expect(batchChannelModelUpdates([batchModel()], { pricingEnabled: false }, batchProtocols)[0].changes).toEqual({ pricingEnabled: false });
    expect(batchChannelModelUpdates([batchModel({ enabled: false })], { pricingEnabled: true }, batchProtocols)[0].changes).toEqual({ pricingEnabled: true });
});

test("全部价格档启用前检查金额，后面的未配置零值使整批拒绝", () => {
    const unavailable = batchTier({ selector: { operation: "text_generation" }, id: "unconfigured", priceConfigured: false, enabled: false, unitPriceMicrocredits: 0 });
    const model = batchModel({ priceTiers: [batchTier(), unavailable] });
    expect(() => batchChannelModelUpdates([model], { pricingEnabled: true }, batchProtocols)).toThrow("价格档 2 金额尚未填写完整");
    expect(batchChannelModelUpdates([model], { pricingEnabled: false }, batchProtocols)[0].changes).toEqual({ pricingEnabled: false });
});

test("完整非零停用档可重新开启，明确免费的已配置档也可用", () => {
    const paid = batchModel({ priceTiers: [batchTier({ priceConfigured: false, enabled: false })] });
    const free = batchModel({ priceTiers: [batchTier({ unitPriceMicrocredits: 0, priceConfigured: true, enabled: false })] });
    expect(batchChannelModelUpdates([paid], { pricingEnabled: true }, batchProtocols)[0].changes.pricingEnabled).toBe(true);
    expect(batchChannelModelUpdates([free], { pricingEnabled: true }, batchProtocols)[0].changes.pricingEnabled).toBe(true);
});

for (const enabled of [true, false]) {
    test(`旧模型 enabled=${enabled} 的价格完整性独立于模型开关`, () => {
        const legacy = batchModel({ priceTiers: [], priceConfigured: false, enabled, unitPriceMicrocredits: 0 });
        expect(() => batchChannelModelUpdates([legacy], { pricingEnabled: true }, batchProtocols)).toThrow("金额尚未填写完整");
        expect(batchChannelModelUpdates([legacy], { description: "仅改备注" }, batchProtocols)[0].changes).toEqual({ description: "仅改备注" });
        expect(batchChannelModelUpdates([{ ...legacy, unitPriceMicrocredits: 1_000_000 }], { pricingEnabled: true }, batchProtocols)[0].changes).toEqual({ pricingEnabled: true });
        const free = batchPricing({ pricing: { priceCurrency: "credits", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier(), unitPrice: 0 }] } });
        expect(batchChannelModelUpdates([legacy], { pricingTemplate: free, pricingEnabled: true }, batchProtocols)[0].changes.pricingTemplate!.priceTiers[0]).toMatchObject({ unitPriceMicrocredits: 0, priceConfigured: true, enabled: true });
        const token = { ...legacy, billingMode: "token" as const, inputTokenPriceMicrocredits: 1_000_000, outputTokenPriceMicrocredits: 1_000_000, cachedTokenPriceMicrocredits: 1_000_000, cacheWriteTokenPriceMicrocredits: 0 };
        expect(() => batchChannelModelUpdates([token], { pricingEnabled: true }, batchProtocols)).toThrow("金额尚未填写完整");
        expect(batchChannelModelUpdates([{ ...token, cacheWriteTokenPriceMicrocredits: 1_000_000 }], { pricingEnabled: true }, batchProtocols)[0].changes).toEqual({ pricingEnabled: true });
    });
}

test("文本 Token 的各项必需金额独立检查，不能靠其中非零价格通过", () => {
    const model = batchModel({
        priceTiers: [
            batchTier({ billingMode: "token", priceConfigured: false, enabled: false, inputTokenPriceMicrocredits: 1_000_000, outputTokenPriceMicrocredits: 2_000_000, cachedTokenPriceMicrocredits: 0, cacheWriteTokenPriceMicrocredits: 1_000_000 }),
        ],
    });
    expect(() => batchChannelModelUpdates([model], { pricingEnabled: true }, batchProtocols)).toThrow("金额尚未填写完整");
    model.priceTiers[0].cachedTokenPriceMicrocredits = 1_000_000;
    expect(batchChannelModelUpdates([model], { pricingEnabled: true }, batchProtocols)[0].changes).toEqual({ pricingEnabled: true });
});

test("应用明确免费模板并开启可供用户使用在同一批中生效", () => {
    const template = batchPricing({ pricing: { priceCurrency: "credits", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier(), unitPrice: 0, priceConfigured: true, enabled: false }] } });
    const result = batchChannelModelUpdates([batchModel({ priceTiers: [batchTier({ priceConfigured: false, enabled: false, unitPriceMicrocredits: 0 })] })], { pricingTemplate: template, pricingEnabled: true }, batchProtocols)[0].changes;
    expect(result.pricingTemplate!.priceTiers[0]).toMatchObject({ unitPriceMicrocredits: 0, priceConfigured: true, enabled: true, providerModelKey: "" });
    expect(result.pricingEnabled).toBe(true);
});

test("免费和零缓存价模板与停用组合保留已配置标记，刷新后可重新开启", () => {
    for (const scenario of batchTemplateAvailabilityPayloads()) {
        const changes = scenario.apply.models[0].changes;
        expect(changes.pricingEnabled).toBe(false);
        expect(changes.pricingTemplate!.priceTiers[0]).toMatchObject({ priceConfigured: true, enabled: false });
        expect(batchChannelModelUpdates([scenario.disabled], { pricingEnabled: true }, batchProtocols)[0].changes).toEqual({ pricingEnabled: true });
    }
});

test("积分模板停用不把未填金额变成明确免费", () => {
    for (const pricingEnabled of [false, true]) {
        const template = batchPricing({ pricing: { priceCurrency: "credits", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier(), unitPrice: null }] } });
        expect(() => batchChannelModelUpdates([batchModel()], { pricingTemplate: template, pricingEnabled }, batchProtocols)).toThrow("价格");
    }
});

test("后端 HTTP 往返 fixture 来自当前前端批量请求构造器", async () => {
    const expected = await Bun.file(new URL("../../backend/internal/handler/testdata/batch_template_availability.json", import.meta.url)).json();
    const actual = batchTemplateAvailabilityPayloads().map(({ name, apply, disabled }) => ({ name, apply, reenable: { models: batchChannelModelUpdates([disabled], { pricingEnabled: true }, batchProtocols) } }));
    expect(actual).toEqual(expected);
});

test("积分模板保留价格币种成本与规则，移除独立上游型号", () => {
    const result = batchChannelModelUpdates([batchModel()], { pricingTemplate: batchPricing() }, batchProtocols)[0].changes;
    expect(result.pricingTemplate).toMatchObject({ priceCurrency: "USD", referenceVideoBilling: false, priceTiers: [{ unitPriceMicrocredits: 2_000_000, costPricing: { configured: true, unitPriceMicrocredits: 1_000_000 }, providerModelKey: "" }] });
    expect(result.enabled).toBeUndefined();
    expect(result.capabilityTemplate).toBeUndefined();
});

test("能力与积分模板组合按最终状态校验，单独不兼容的能力模板被拒绝", () => {
    const config = defaultModelCapabilityConfig("openai-image");
    config.image!.quality = { supported: true, values: ["low"], default: "low" };
    const original = structuredClone(config);
    original.image!.quality = { supported: true, values: ["high"], default: "high" };
    const model = batchModel({ capability: "image", protocol: "image-protocol", capabilityConfig: original, priceTiers: [batchTier({ selector: { quality: "high" } })] });
    const template: SavedCapabilityTemplate = { id: "cap-1", revision: "rev-1", name: "新能力", capability: "image", config: { capabilityConfig: config } };
    expect(() => batchChannelModelUpdates([model], { capabilityTemplate: { saved: template } }, batchProtocols)).toThrow("high");
    const pricing = batchPricing({ capability: "image", pricing: { priceCurrency: "credits", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier("advanced"), quality: "low", unitPrice: 1 }] } });
    expect(batchChannelModelUpdates([model], { capabilityTemplate: { saved: template }, pricingTemplate: pricing }, batchProtocols)[0].changes).toMatchObject({
        capabilityTemplate: { capabilityConfig: { image: { quality: { values: ["low"] } } } },
        pricingTemplate: { priceTiers: [{ selector: { quality: "low" } }] },
    });
});

test("内置能力模板不限定型号，批量 payload 不携带协议", async () => {
    const manifest = await Bun.file(new URL("../../plugin-packages/openai-images/manifest.json", import.meta.url)).json();
    const protocols = [{ ...batchProtocols[1], value: "openai-image", imageParameters: manifest.contributes.providers[0].imageParameters }];
    const model = batchModel({ capability: "image", protocol: "openai-image", providerModelKey: "gpt-image-2", capabilityConfig: defaultModelCapabilityConfig("openai-image", "gpt-image-2") });
    const result = batchChannelModelUpdates([model], { capabilityTemplate: { builtin: "gpt-image-openai-v1" } }, protocols);
    expect(result[0].changes.capabilityTemplate!.capabilityConfig.image!.parameters!.length).toBeGreaterThan(0);
    expect(result[0].changes.pricingTemplate).toBeUndefined();
    const updates = batchChannelModelUpdates([model, { ...model, id: "second", providerModelKey: "other-model" }], { capabilityTemplate: { builtin: "gpt-image-openai-v1" } }, protocols);
    expect(updates).toHaveLength(2);
    for (const update of updates) {
        expect(Object.keys(update.changes)).toEqual(["capabilityTemplate"]);
        expect(Object.keys(update.changes.capabilityTemplate!)).toEqual(["capabilityConfig"]);
    }
});

test("混合能力按类型配置协议与模板，未修改的分组不提交", () => {
    const models = [batchModel(), batchModel({ id: "image", capability: "image", protocol: "image-protocol", capabilityConfig: defaultModelCapabilityConfig("openai-image") })];
    expect(batchChannelModelUpdates(models, { description: "统一备注", enabled: false }, batchProtocols)).toHaveLength(2);
    const updates = batchChannelModelUpdates(models, { groups: { text: { pricingTemplate: batchPricing(), protocol: "text-protocol" } } }, batchProtocols);
    expect(updates).toHaveLength(1);
    expect(updates[0].modelId).toBe(models[0].id);
    expect(updates[0].changes).toMatchObject({ protocol: "text-protocol", pricingTemplate: { priceCurrency: "USD" } });
});

test("新模型可一次设置图片类型、协议、积分模板及启用，不静默采用文本", () => {
    const model = batchModel({ capability: "", protocol: "", capabilityConfig: undefined, priceTiers: [], priceConfigured: false, enabled: false, unitPriceMicrocredits: 0 });
    const template = batchPricing({ capability: "image" });
    expect(() => batchChannelModelUpdates([model], { enabled: true }, batchProtocols)).toThrow("请选择模型类型");
    const changes = batchChannelModelUpdates([model], { enabled: true, pricingEnabled: true, groups: { unset: { capability: "image", protocol: "image-protocol", pricingTemplate: template } } }, batchProtocols)[0].changes;
    expect(changes).toMatchObject({ capability: "image", protocol: "image-protocol", enabled: true, pricingEnabled: true, pricingTemplate: { priceCurrency: "USD" } });
    expect(model.capability).toBe("");
});

test("模型版本、更新时间或归属变化均让旧选择失效", () => {
    const original = batchModel();
    for (const patch of [{ priceVersion: 10 }, { capabilityVersion: 4 }, { updatedAt: "changed" }, { channelId: "moved" }]) {
        expect(() => assertBatchModelSelectionCurrent([original], [batchModel(patch)])).toThrow("所选模型已变化");
    }
    expect(() => assertBatchModelSelectionCurrent([original], [])).toThrow("所选模型已变化");
    expect(() => assertBatchModelSelectionCurrent([original], [structuredClone(original)])).not.toThrow();
});

test("新模型可只初始化协议而不启用价格，已有类型不能跨改", () => {
    const model = batchModel({ capability: "", protocol: "", capabilityConfig: undefined, priceTiers: [], priceConfigured: false, enabled: false, unitPriceMicrocredits: 0 });
    const result = batchChannelModelUpdates([model], { groups: { unset: { capability: "image", protocol: "image-protocol" } } }, batchProtocols);
    expect(result[0].changes).toEqual({ capability: "image", protocol: "image-protocol" });
    expect(() => batchChannelModelUpdates([batchModel()], { capability: "image", protocol: "image-protocol" }, batchProtocols)).toThrow("已有模型类型不能跨类型修改");
});

test("未设置或失效的调用配置不阻塞元信息及关闭开关，开启仍校验", () => {
    const model = batchModel({ capability: "", protocol: "", priceTiers: [] });
    expect(batchChannelModelUpdates([model], { displayName: "新分组", description: "备注", enabled: false, pricingEnabled: false }, [])[0].changes).toEqual({ displayName: "新分组", description: "备注", enabled: false, pricingEnabled: false });
    expect(() => batchChannelModelUpdates([batchModel()], { enabled: true }, [])).toThrow("请求协议");
    expect(() => batchChannelModelUpdates([batchModel()], { pricingEnabled: true }, [])).toThrow("请求协议");
});

test("模板可跨协议复用，显式协议与模板独立组合，新模型仍须选择协议", () => {
    const template: SavedCapabilityTemplate = { id: "text", revision: "v1", name: "文本模板", capability: "text", config: { capabilityConfig: defaultModelCapabilityConfig("chat-completion") } };
    const protocols = [...batchProtocols, { ...batchProtocols[0], value: "other-text" }];
    const models = [batchModel(), batchModel({ id: "other", protocol: "other-text" })];
    const before = structuredClone(models);
    const updates = batchChannelModelUpdates(models, { capabilityTemplate: { saved: template } }, protocols);
    for (const update of updates) {
        expect(Object.keys(update.changes)).toEqual(["capabilityTemplate"]);
        expect(Object.keys(update.changes.capabilityTemplate!)).toEqual(["capabilityConfig"]);
    }
    expect(models).toEqual(before);
    expect(batchChannelModelUpdates(models, { protocol: "other-text", capabilityTemplate: { saved: template } }, protocols)[0].changes).toMatchObject({ protocol: "other-text", capabilityTemplate: updates[0].changes.capabilityTemplate });
    const fresh = batchModel({ capability: "", protocol: "", capabilityConfig: undefined, priceTiers: [], priceConfigured: false });
    expect(() => batchChannelModelUpdates([fresh], { capability: "text", capabilityTemplate: { saved: template } }, protocols)).toThrow("请求协议");
    expect(() => batchChannelModelUpdates([batchModel()], { capabilityTemplate: { saved: { ...template, capability: "video" } } }, protocols)).toThrow("能力类型");
});

test("协议修改保留原价格条件，不能清空不兼容选择器后伪报成功", () => {
    const config = defaultModelCapabilityConfig("openai-image");
    config.image!.quality = { supported: true, values: ["low"], default: "low" };
    const model = batchModel({ capability: "image", protocol: "old-image", capabilityConfig: config, priceTiers: [batchTier({ selector: { quality: "high" } })] });
    expect(() => batchChannelModelUpdates([model], { protocol: "image-protocol" }, batchProtocols)).toThrow("high");
    expect(model.priceTiers[0].selector.quality).toBe("high");
});
