import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";

// Node 原生 TypeScript 测试运行器要求保留扩展名，项目编译器不允许该写法。
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { defaultPriceTier, legacyPriceTierToForm, priceTierPayloadFromForm, priceTierToForm } from "./channel-model-price-tier-form.ts";

test("编辑无价格档的旧模型时不再把顶层上游键固化进统一价格档", () => {
    const legacy: ChannelModel = {
        id: "model-1",
        modelKey: "deepseek-v4.1-flash",
        providerModelKey: "deepseek-v4.1-flash",
        billingMode: "fixed_request",
        unitPriceMicrocredits: 10,
        priceConfigured: true,
        enabled: true,
    } as unknown as ChannelModel;

    const tier = legacyPriceTierToForm(legacy);

    assert.equal(tier.providerModelKey, "");
    assert.equal(tier.matchMode, "default");
});

test("已存档位键在回显时保持原值，清除与否交给管理端告警处理", () => {
    const tier = priceTierToForm({
        selector: {},
        resolution: "*",
        videoSeconds: 0,
        providerModelKey: "sku-preview",
        billingMode: "fixed_request",
        unitPriceMicrocredits: 10,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        priceConfigured: true,
        enabled: true,
    } as unknown as ChannelModelPriceTier);

    assert.equal(tier.providerModelKey, "sku-preview");
    assert.equal(tier.matchMode, "default");
});

test("新建默认价格档不携带上游键", () => {
    assert.equal(defaultPriceTier().providerModelKey, "");
    assert.equal(defaultPriceTier("advanced").providerModelKey, "");
});

test("文本 Token 价格档回显并提交缓存写入价，旧档缺字段时按 0", () => {
    const base = {
        selector: {},
        resolution: "*",
        videoSeconds: 0,
        providerModelKey: "",
        billingMode: "token",
        unitPriceMicrocredits: 0,
        inputTokenPriceMicrocredits: 3_000_000,
        outputTokenPriceMicrocredits: 15_000_000,
        cachedTokenPriceMicrocredits: 300_000,
        priceConfigured: true,
        enabled: true,
    };
    const legacy = priceTierToForm({ ...base, costPricing: { configured: true, unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 } } as unknown as ChannelModelPriceTier);
    assert.equal(legacy.cacheWriteTokenPrice, 0);
    assert.equal(legacy.costCacheWriteTokenPrice, 0);

    const tier = priceTierToForm({
        ...base,
        cacheWriteTokenPriceMicrocredits: 3_750_000,
        costPricing: { configured: true, unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 2_000_000, outputTokenPriceMicrocredits: 10_000_000, cachedTokenPriceMicrocredits: 200_000, cacheWriteTokenPriceMicrocredits: 2_500_000 },
    } as unknown as ChannelModelPriceTier);
    assert.equal(tier.cacheWriteTokenPrice, 3.75);
    const payload = priceTierPayloadFromForm("text", tier, "claude-sonnet");
    assert.equal(payload.cacheWriteTokenPriceMicrocredits, 3_750_000);
    assert.equal(payload.costPricing.cacheWriteTokenPriceMicrocredits, 2_500_000);
    // 视频 Token 只按输出计费，缓存写入价强制为 0。
    assert.equal(priceTierPayloadFromForm("video", tier, "video-model").cacheWriteTokenPriceMicrocredits, 0);
});
