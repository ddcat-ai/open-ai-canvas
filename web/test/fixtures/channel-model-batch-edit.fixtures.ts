import type { ChannelModel, ChannelModelPriceTier } from "../../src/services/api/wallet";
import type { ModelProtocolDefinition } from "../../src/lib/model-protocols";
import { defaultModelCapabilityConfig } from "../../src/lib/model-capabilities";
import { defaultPriceTier } from "../../src/pages/admin/components/channel-model-price-tier-form";
import type { SavedPricingTemplate } from "../../src/pages/admin/components/saved-pricing-templates";
import { batchChannelModelUpdates } from "../../src/pages/admin/components/channel-model-batch-edit";

export const batchProtocols: ModelProtocolDefinition[] = ["text", "image", "video", "audio"].map((capability) => ({
    value: `${capability}-protocol`,
    capability: capability as ModelProtocolDefinition["capability"],
    label: capability,
    create: "POST /generate",
    contentType: "application/json",
    media: "url",
    enabled: true,
}));

export function batchTier(patch: Partial<ChannelModelPriceTier> = {}): ChannelModelPriceTier {
    return {
        id: "tier-1",
        channelModelId: "model-1",
        selector: {},
        selectorKey: "{}",
        resolution: "*",
        videoSeconds: 0,
        providerModelKey: "independent-upstream",
        billingMode: "fixed_request",
        unitPriceMicrocredits: 10_000_000,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        cacheWriteTokenPriceMicrocredits: 0,
        priceConfigured: true,
        enabled: true,
        priceVersion: 7,
        createdAt: "2026-11-09T01:00:00Z",
        updatedAt: "2026-11-09T02:00:00.123456789Z",
        ...patch,
    };
}

export function batchModel(patch: Partial<ChannelModel> = {}): ChannelModel {
    return {
        id: "model-1",
        channelId: "channel-1",
        modelKey: "model-key-1",
        providerModelKey: "target-upstream",
        displayName: "现有名称",
        description: "原备注",
        icon: "icon",
        capability: "text",
        protocol: "text-protocol",
        capabilityConfig: defaultModelCapabilityConfig("openai"),
        billingMode: "fixed_request",
        unitPriceMicrocredits: 10_000_000,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        cacheWriteTokenPriceMicrocredits: 0,
        priceConfigured: true,
        enabled: true,
        priceVersion: 9,
        capabilityVersion: 3,
        priceTiers: [batchTier()],
        createdAt: "2026-11-09T01:00:00Z",
        updatedAt: "2026-11-09T02:00:00.123456789Z",
        ...patch,
    };
}

export function batchPricing(patch: Partial<SavedPricingTemplate> = {}): SavedPricingTemplate {
    return {
        id: "pricing-1",
        revision: "revision-1",
        name: "常用积分",
        capability: "text",
        pricing: { priceCurrency: "USD", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier(), unitPrice: 2, costConfigured: true, costUnitPrice: 1, providerModelKey: "source-upstream" }] },
        ...patch,
    };
}

// Both Bun and the backend HTTP regression consume these real frontend payloads.
export function batchTemplateAvailabilityPayloads() {
    return ["free-request", "zero-token-cache"].map((name) => {
        const source = batchModel();
        const tier = {
            ...defaultPriceTier(),
            unitPrice: 0,
            ...(name === "zero-token-cache" ? { billingMode: "token" as const, inputTokenPrice: 1, outputTokenPrice: 2, cachedTokenPrice: 0, cacheWriteTokenPrice: 0 } : {}),
            costConfigured: true,
            costUnitPrice: 0.25,
            costInputTokenPrice: 0.1,
            costOutputTokenPrice: 0.2,
        };
        const template = batchPricing({ pricing: { priceCurrency: "credits", referenceVideoBilling: false, priceTiers: [tier] } });
        const apply = { models: batchChannelModelUpdates([source], { pricingTemplate: template, pricingEnabled: false }, batchProtocols) };
        const projected = apply.models[0].changes.pricingTemplate!.priceTiers[0];
        const disabled = batchModel({ priceConfigured: false, priceTiers: [batchTier(projected)] });
        return { name, apply, disabled };
    });
}
