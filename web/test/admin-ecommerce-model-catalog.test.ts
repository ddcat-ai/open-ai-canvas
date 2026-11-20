import { expect, test } from "bun:test";
import { COMMERCE_VISION_DISABLED_REASON, commerceStageChannelModelId, commerceStageModelConfig, commerceStageModelCounts, commerceStageModelValue, commerceVisionDisabledReason } from "../src/pages/admin/ecommerce-model-catalog";
import type { ModelCatalogResponse, PublicChannelModel } from "../src/services/api/logical-models";
function model(id: string, vision: number | undefined = 1): PublicChannelModel {
    return {
        id,
        modelKey: `key-${id}`,
        displayName: `模型 ${id}`,
        icon: "",
        capability: "text",
        protocol: "chat-completion",
        available: true,
        priceLabel: "1 积分",
        pricingMode: "token",
        priceTiers: [{ id: `price-${id}`, resolution: "*", videoSeconds: 0, billingMode: "token", unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 1, outputTokenPriceMicrocredits: 1, cachedTokenPriceMicrocredits: 0 }],
        capabilityConfig: vision === undefined ? {} : { text: { references: { maxImages: vision } } },
    };
}
// 真实目录不返回系统渠道名称，这里也留空，避免测试依赖接口不会给的字段。
function catalog(count: number): ModelCatalogResponse {
    return { source: "system", models: [], channels: Array.from({ length: count }, (_, i) => ({ id: `channel-${i}`, name: "", displayName: "", models: [model(`${i}`)] })) };
}

test("stage pickers use the full shared catalog and round-trip the channel-model row id", () => {
    for (const count of [20, 101]) expect(commerceStageModelCounts(commerceStageModelConfig(catalog(count)))).toEqual({ text: count, vision: count });
    const input = catalog(2);
    input.channels![0].models[0].displayName = "同名";
    input.channels![1].models[0].displayName = "同名";
    const config = commerceStageModelConfig(input);
    const second = commerceStageModelValue(config, "1");
    expect(second).toBe("channel-1::key-1");
    expect(commerceStageChannelModelId(config, second)).toBe("1");
    expect(commerceStageModelValue(config, "missing")).toBe("");
    input.channels![0].models[0].available = false;
    expect(commerceStageModelCounts(commerceStageModelConfig(input)).text).toBe(1);
});

test("text models without image input stay listed but explain how to enable vision", () => {
    const input = catalog(3);
    input.channels![0].models[0] = model("plain", 0);
    input.channels![1].models[0] = model("unknown");
    input.channels![1].models[0].capabilityConfig = {};
    const config = commerceStageModelConfig(input);
    expect(commerceStageModelCounts(config)).toEqual({ text: 3, vision: 1 });
    expect(commerceVisionDisabledReason(config, commerceStageModelValue(config, "plain"))).toBe(COMMERCE_VISION_DISABLED_REASON);
    expect(commerceVisionDisabledReason(config, commerceStageModelValue(config, "unknown"))).toContain("最多识别图片数");
    expect(commerceVisionDisabledReason(config, commerceStageModelValue(config, "2"))).toBe("");
});

test("rejects a catalog that is not the system projection", () => {
    expect(() => commerceStageModelConfig({ source: "custom", models: [] } as unknown as ModelCatalogResponse)).toThrow("模型目录响应无效");
});
