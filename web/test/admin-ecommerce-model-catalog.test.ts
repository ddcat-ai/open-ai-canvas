import { expect, test } from "bun:test";
import { commercePlanningModelOptions } from "../src/pages/admin/ecommerce-model-catalog";
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
function catalog(count: number): ModelCatalogResponse {
    return { source: "system", models: [], channels: Array.from({ length: count }, (_, i) => ({ id: `channel-${i}`, name: `渠道 ${i}`, displayName: `渠道 ${i}`, models: [model(`${i}`)] })) };
}

test("admin discovers the complete shared catalog, including newly added and same-named channel models", () => {
    for (const count of [20, 100, 101]) expect(commercePlanningModelOptions(catalog(count))).toHaveLength(count);
    const oneChannel = catalog(1);
    oneChannel.channels![0].models = Array.from({ length: 100 }, (_, i) => model(`single-${i}`));
    expect(commercePlanningModelOptions(oneChannel)).toHaveLength(100);
    const input = catalog(2);
    input.channels![0].models[0].displayName = "同名";
    input.channels![1].models[0].displayName = "同名";
    const options = commercePlanningModelOptions(input);
    expect(options.map((item) => item.value)).toEqual(["channel:0", "channel:1"]);
    expect(options[0].label).toContain("渠道 0");
    expect(options[0].label).toContain("key-0");
    input.channels![0].models[0].available = false;
    expect(commercePlanningModelOptions(input)).toHaveLength(1);
});

test("text-only and unknown vision capability remain searchable but cannot be selected", () => {
    const input = catalog(3);
    input.channels![0].models[0] = model("plain", 0);
    input.channels![1].models[0] = model("unknown");
    input.channels![1].models[0].capabilityConfig = {};
    const options = commercePlanningModelOptions(input);
    expect(options.find((item) => item.value === "channel:plain")).toMatchObject({ disabled: true, label: expect.stringContaining("未配置图片输入") });
    expect(options.find((item) => item.value === "channel:unknown")).toMatchObject({ disabled: true, label: expect.stringContaining("能力未知") });
    expect(options.find((item) => item.value === "channel:2")?.disabled).toBe(false);
    const textOptions = commercePlanningModelOptions(input, false);
    expect(textOptions.find((item) => item.value === "channel:plain")?.disabled).toBe(false);
    expect(textOptions.find((item) => item.value === "channel:unknown")?.disabled).toBe(false);
});
