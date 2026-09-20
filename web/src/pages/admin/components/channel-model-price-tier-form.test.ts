import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelModel, ChannelModelPriceTier } from "@/services/api/wallet";

// Node 原生 TypeScript 测试运行器要求保留扩展名，项目编译器不允许该写法。
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { defaultPriceTier, legacyPriceTierToForm, priceTierToForm } from "./channel-model-price-tier-form.ts";

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
