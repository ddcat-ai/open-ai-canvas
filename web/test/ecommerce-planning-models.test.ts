import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { AiConfig } from "../src/stores/use-config-store";
import { assertCommerceImageReferenceCapacity, commercePlanningModels } from "../src/pages/ecommerce/workflow";

test("commerce image input limit uses the lower of model capacity and platform maximum", () => {
    expect(() => assertCommerceImageReferenceCapacity(20, 24)).not.toThrow();
    expect(() => assertCommerceImageReferenceCapacity(21, 24)).toThrow("平台单次生图最多接收 20 张");
    expect(() => assertCommerceImageReferenceCapacity(5, 5)).not.toThrow();
    expect(() => assertCommerceImageReferenceCapacity(6, 5)).toThrow("当前图片模型最多接收 5 张");
    expect(() => assertCommerceImageReferenceCapacity(0, 24)).not.toThrow();
    expect(() => assertCommerceImageReferenceCapacity(0, 0)).not.toThrow();
});

test("commerce planning only offers text channels configured for every reference image", () => {
    const text = defaultModelCapabilityConfig().text!;
    const vision = (maxImages: number) => ({ text: { ...text, references: { ...text.references, maxImages, maxImageBytes: 30 * 1024 * 1024 } } });
    const config = {
        channels: [
            { id: "text", models: ["deepseek"], modelCosts: [{ model: "deepseek" }] },
            {
                id: "vision",
                models: ["one", "four"],
                modelCosts: [
                    { model: "one", capabilityConfig: vision(1) },
                    { model: "four", capabilityConfig: vision(4) },
                ],
            },
        ],
    } as unknown as AiConfig;
    const models = ["text::deepseek", "vision::one", "vision::four"];

    expect(commercePlanningModels(config, models, 0)).toEqual(models);
    expect(commercePlanningModels(config, models, 1)).toEqual(["vision::one", "vision::four"]);
    expect(commercePlanningModels(config, models, 2)).toEqual(["vision::four"]);
    expect(commercePlanningModels(config, models, 5)).toEqual([]);
});
