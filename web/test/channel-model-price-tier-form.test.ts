import { describe, expect, test } from "bun:test";

import { defaultPriceTier, priceTierPayloadFromForm, priceTierResolutionFromForm, priceTierToForm, priceTierVideoSecondsFromForm, skuSelectorFromForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import type { ChannelModelPriceTier } from "../src/services/api/wallet";
import { validateChannelModelPrices } from "../src/pages/admin/components/channel-model-editor-form";

describe("channel model price tier defaults", () => {
    test("cost edit payload preserves independent sale and cost prices including explicit zero", () => {
        const tier = { ...defaultPriceTier(), unitPrice: 0.09, costConfigured: true, costUnitPrice: 0.035678 };
        const payload = priceTierPayloadFromForm("video", tier, "MiniMax-H3");
        expect(payload.unitPriceMicrocredits).toBe(90_000);
        expect(payload.costPricing).toMatchObject({ configured: true, unitPriceMicrocredits: 35_678 });
        expect(priceTierToForm(payload as ChannelModelPriceTier)).toMatchObject({ unitPrice: 0.09, costConfigured: true, costUnitPrice: 0.035678 });
        expect(priceTierPayloadFromForm("video", { ...tier, costUnitPrice: 0 }, "MiniMax-H3").costPricing).toMatchObject({ configured: true, unitPriceMicrocredits: 0 });
        expect(defaultPriceTier().costConfigured).toBe(false);
        for (const costUnitPrice of [-1, NaN, Infinity, 1_000_001]) {
            expect(() => validateChannelModelPrices({ capability: "video", protocol: "minimax-video", priceTiers: [{ ...tier, costUnitPrice }] })).toThrow("积分成本价");
        }
    });

    test("video Token cost uses only output price while text cost keeps separate token rates", () => {
        const tier = { ...defaultPriceTier(), billingMode: "token" as const, costConfigured: true, costInputTokenPrice: 1.5, costOutputTokenPrice: 3, costCachedTokenPrice: 0.1 };
        expect(priceTierPayloadFromForm("video", tier, "video").costPricing).toMatchObject({ configured: true, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 3_000_000, cachedTokenPriceMicrocredits: 0 });
        expect(priceTierPayloadFromForm("text", tier, "text").costPricing).toMatchObject({ inputTokenPriceMicrocredits: 1_500_000, outputTokenPriceMicrocredits: 3_000_000, cachedTokenPriceMicrocredits: 100_000 });
    });
    test("creates a usable all-spec fallback price by default", () => {
        const tier = defaultPriceTier();

        expect(tier.matchMode).toBe("default");
        expect(tier.priceConfigured).toBe(true);
        expect(tier.enabled).toBe(true);
        expect(skuSelectorFromForm("image", { ...tier, quality: "2k", size: "1:1" })).toEqual({});
    });

    test("keeps explicit image specification pricing when advanced mode is selected", () => {
        const tier = defaultPriceTier("advanced");

        expect(skuSelectorFromForm("image", { ...tier, quality: "2k", size: "1:1" })).toEqual({ quality: "2k", size: "1:1" });
    });

    test("drops stale video selectors after switching back to the default price", () => {
        const tier = { ...defaultPriceTier("advanced"), resolution: "1080p", videoSeconds: 10, videoGenerateAudio: "false", imageCount: 2 };
        const defaultTier = { ...tier, matchMode: "default" as const };

        expect(skuSelectorFromForm("video", defaultTier)).toEqual({});
        expect(priceTierResolutionFromForm("video", defaultTier)).toBe("*");
        expect(priceTierVideoSecondsFromForm("video", defaultTier)).toBe(0);
    });

    test("restores existing specific tiers in advanced mode and wildcard tiers as defaults", () => {
        const base: ChannelModelPriceTier = {
            id: "tier-1",
            channelModelId: "model-1",
            selector: {},
            selectorKey: "{}",
            resolution: "*",
            videoSeconds: 0,
            providerModelKey: "gpt-image-2",
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 4_000_000,
            inputTokenPriceMicrocredits: 0,
            outputTokenPriceMicrocredits: 0,
            cachedTokenPriceMicrocredits: 0,
            priceConfigured: true,
            enabled: true,
            priceVersion: 1,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
        };

        expect(priceTierToForm(base).matchMode).toBe("default");
        expect(priceTierToForm({ ...base, selector: { quality: "2k" } }).matchMode).toBe("advanced");
        expect(priceTierToForm({ ...base, selector: { videoGenerateAudio: "false" } })).toMatchObject({ matchMode: "default", videoGenerateAudio: "false" });
    });

    test("keeps video matching limited to operation and resolution", () => {
        for (const videoGenerateAudio of ["true", "false"]) {
            const tier = { ...defaultPriceTier("advanced"), operation: "image_to_video", resolution: "1080p", videoSeconds: 10, videoGenerateAudio, imageCount: 2 };
            expect(skuSelectorFromForm("video", tier)).toEqual({ operation: "image_to_video", vquality: "1080p" });
            expect(priceTierVideoSecondsFromForm("video", tier)).toBe(0);
            expect(skuSelectorFromForm("image", { ...defaultPriceTier("advanced"), videoSeconds: 10, videoGenerateAudio, imageCount: 2 })).toEqual({});
        }
        expect(skuSelectorFromForm("video", defaultPriceTier("advanced"))).toEqual({});
    });

    test("video Token writes discard hidden text prices without changing the configured video rate", () => {
        const tier = { ...defaultPriceTier("advanced"), billingMode: "token" as const, videoGenerateAudio: "false", inputTokenPrice: 10, outputTokenPrice: 0.25, cachedTokenPrice: 5 };
        expect(priceTierPayloadFromForm("video", tier, "seedance")).toMatchObject({ selector: {}, videoSeconds: 0, providerModelKey: "seedance", inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 250_000, cachedTokenPriceMicrocredits: 0 });
        expect(priceTierPayloadFromForm("text", tier, "text-model")).toMatchObject({ inputTokenPriceMicrocredits: 10_000_000, outputTokenPriceMicrocredits: 250_000, cachedTokenPriceMicrocredits: 5_000_000 });
        expect(priceTierPayloadFromForm("video", { ...tier, outputTokenPrice: 0 }, "seedance").outputTokenPriceMicrocredits).toBe(0);
    });
});
