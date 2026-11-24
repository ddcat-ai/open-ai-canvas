import { describe, expect, test } from "bun:test";
import { imagePricingPayload, imagePricingToForm, seedream55OfficialPricing, validImagePricingForm } from "../src/lib/image-usage-pricing";
import { defaultPriceTier, priceTierPayloadFromForm, priceTierToForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import { modelQuoteDescription } from "../src/lib/model-pricing";
import type { ChannelModelPriceTier } from "../src/services/api/wallet";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { pricingSnapshot } from "../src/pages/admin/components/saved-pricing-templates";
import { changeChannelModelCapability, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

describe("image usage pricing", () => {
    test("official plugin scopes the new controls to 5.5 and preserves older model sizes", async () => {
        const manifest = await Bun.file(new URL("../../plugin-packages/volcengine-ark-seedream/manifest.json", import.meta.url)).json();
        const provider = manifest.contributes.providers[0];
        const protocols = [{ value: "volcengine-ark-image", capability: "image", enabled: true, imageParameters: provider.imageParameters, create: "/api/v3/images/generations" }] as ModelProtocolDefinition[];
        for (const model of ["doubao-seedream-5-5-261028", "doubao-seedream-5-0-pro-260628"]) {
            const values = changeChannelModelCapability({ ...initialChannelModelValues(null, protocols), capability: "image", protocol: "volcengine-ark-image", modelKey: model, providerModelKey: model }, protocols);
            const image = values.capabilityConfig!.image!;
            if (model.includes("5-5")) {
                expect(image.size.parameter).toBe("size");
                expect(image.resolution.values).toEqual(["1k", "1.5k", "2k"]);
                expect(image.size.presets).toHaveLength(24);
                expect(image.parameters?.some((field) => field.name === "layerDecomposition")).toBe(true);
            } else {
                expect(image.size.parameter).not.toBe("none");
                expect(image.size.values).toEqual(defaultImageCapabilityConfig("volcengine-ark-image", model).size.values);
                expect(image.parameters?.some((field) => field.name === "imageResolution")).toBe(false);
                expect(image.parameters?.some((field) => field.name === "layerDecomposition")).toBe(false);
            }
        }
    });
    test("official model presets include 1K and 1.5K without 4K", () => {
        const image = defaultImageCapabilityConfig("volcengine-ark-image", "doubao-seedream-5-5-261028");
        expect(image.references.maxImages).toBe(10);
        expect(image.maxOutputs).toBe(1);
        expect(image.resolution.values).toEqual(["1k", "1.5k", "2k"]);
        expect(image.size.presets?.find((preset) => preset.tier === "1.5k" && preset.ratio === "1:1")?.size).toBe("1536x1536");
    });
    test("official CNY rates round trip without applying a third-party discount", () => {
        const form = seedream55OfficialPricing();
        const payload = imagePricingPayload(form);
        expect(payload.inputPriceMicrocredits).toBe(50_000);
        expect(payload.outputTiers).toEqual([
            { maxPixels: 2_610_000, unitPriceMicrocredits: 130_000 },
            { maxPixels: 4_630_000, unitPriceMicrocredits: 230_000 },
        ]);
        expect(imagePricingToForm(payload)).toEqual(form);
    });
    test("incomplete and overlapping tiers fail, explicit free remains valid", () => {
        expect(validImagePricingForm({ inputPrice: null, freeInputImages: 0, outputTiers: [{ maxPixels: 0, unitPrice: 0 }] })).toBe(false);
        expect(validImagePricingForm({ inputPrice: 0, freeInputImages: 0, outputTiers: [{ maxPixels: 0, unitPrice: 0 }] })).toBe(true);
        expect(
            validImagePricingForm({
                inputPrice: 0,
                freeInputImages: 0,
                outputTiers: [
                    { maxPixels: 200, unitPrice: 1 },
                    { maxPixels: 100, unitPrice: 2 },
                ],
            }),
        ).toBe(false);
    });
    test("model editor preserves independent image sale and cost pricing", () => {
        const sale = seedream55OfficialPricing();
        const cost = { ...sale, inputPrice: 0.01 };
        const payload = priceTierPayloadFromForm("image", { ...defaultPriceTier(), billingMode: "image_usage", imagePricing: sale, costConfigured: true, costImagePricing: cost }, "doubao-seedream-5-5-261028");
        expect(payload.imagePricing?.inputPriceMicrocredits).toBe(50_000);
        expect(payload.costPricing.imagePricing?.inputPriceMicrocredits).toBe(10_000);
        const restored = priceTierToForm(payload as ChannelModelPriceTier);
        expect(restored.imagePricing).toEqual(sale);
        expect(restored.costImagePricing).toEqual(cost);
    });
    test("quote labels a reservation ceiling and includes the base image", () => {
        const label = modelQuoteDescription({ logicalModelId: "", billingMode: "image_usage", quantity: 10, amountMicrocredits: 2_350_000, estimated: true, imageUsage: { inputImages: 1, maxOutputImages: 10 } });
        expect(label).toContain("最多冻结 2.35 积分");
        expect(label).toContain("最多输出 10 张（含底图）");
        expect(label).toContain("退回差额");
    });
    test("saved templates retain image sale and independent cost rules", () => {
        const pricing = seedream55OfficialPricing();
        const template = pricingSnapshot({ priceCurrency: "CNY", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier(), billingMode: "image_usage", imagePricing: pricing, costConfigured: true, costImagePricing: pricing }] });
        expect(template.priceTiers[0].imagePricing).toEqual(pricing);
        expect(template.priceTiers[0].costImagePricing).toEqual(pricing);
        template.priceTiers[0].imagePricing!.outputTiers[0].unitPrice = 1;
        expect(pricing.outputTiers[0].unitPrice).toBe(0.13);
    });
});
