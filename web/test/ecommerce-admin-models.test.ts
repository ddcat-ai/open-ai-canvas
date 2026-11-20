import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { modelQuoteRequest, systemModelQuoteRequest } from "../src/lib/model-pricing";
import { matchCommerceAdminModel } from "../src/pages/ecommerce/admin-models";
import { createModelChannel, defaultConfig, selectableModelsByCapability, type AiConfig } from "../src/stores/use-config-store";

// 系统模型已全部是直连渠道模型（没有 logicalModelId）。
function directConfig(): AiConfig {
    const capabilityConfig = defaultModelCapabilityConfig();
    capabilityConfig.text!.references.maxImages = 4;
    const channel = createModelChannel({
        id: "system-zhipu",
        name: "",
        scope: "system",
        baseUrl: "/api/system-zhipu",
        apiKey: "system",
        models: ["glm-5.3-flash", "deepseek-v4-pro"],
        modelCosts: [
            { model: "glm-5.3-flash", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 1000, channelModelId: "MODEL_000191", channelId: "system-zhipu", modelKey: "glm-5.3-flash", capabilityConfig },
            { model: "deepseek-v4-pro", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 1000, channelModelId: "MODEL_000192", channelId: "system-zhipu", modelKey: "deepseek-v4-pro" },
        ],
    });
    return { ...defaultConfig, channels: [channel] };
}

test("matches the administrator's direct channel model without relying on a quote route", () => {
    const config = directConfig();
    const textModels = selectableModelsByCapability(config, "text");
    expect(matchCommerceAdminModel(config, textModels, { channelModelId: "MODEL_000191", channelId: "system-zhipu", modelKey: "glm-5.3-flash" })).toBe("system-zhipu::glm-5.3-flash");
    // 只有行 ID 也能匹配；渠道 + 模型键也能匹配。
    expect(matchCommerceAdminModel(config, textModels, { channelModelId: "MODEL_000191" })).toBe("system-zhipu::glm-5.3-flash");
    expect(matchCommerceAdminModel(config, textModels, { channelModelId: "renamed-row", channelId: "system-zhipu", modelKey: "deepseek-v4-pro" })).toBe("system-zhipu::deepseek-v4-pro");
    expect(matchCommerceAdminModel(config, textModels, { channelModelId: "MODEL_404", channelId: "other", modelKey: "glm-5.3-flash" })).toBe("");
    expect(matchCommerceAdminModel(config, textModels, { logicalModelId: "logical-1" })).toBe("");
});

test("ecommerce quotes direct text models on the server while generic pickers keep local prices", () => {
    const config = directConfig();
    const requirements = { capability: "text" as const, input: { textCount: 1, imageCount: 2, videoCount: 0, audioCount: 0, characterCount: 0 } };
    expect(modelQuoteRequest(config, "system-zhipu::glm-5.3-flash", "text", requirements)).toBeUndefined();
    expect(systemModelQuoteRequest(config, "system-zhipu::glm-5.3-flash", "text", requirements)).toMatchObject({ channelId: "system-zhipu", modelKey: "glm-5.3-flash", intent: { capability: "text", inputs: { image: 2 } } });
});
