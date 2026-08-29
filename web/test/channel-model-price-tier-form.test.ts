import { describe, expect, test } from "bun:test";

import { defaultPriceTier, priceTierResolutionFromForm, priceTierToForm, priceTierVideoSecondsFromForm, skuSelectorFromForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import type { ChannelModelPriceTier } from "../src/services/api/wallet";

describe("channel model price tier defaults", () => {
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
        const tier = { ...defaultPriceTier("advanced"), resolution: "1080p", videoSeconds: 10, imageCount: 2 };
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
    });
});
