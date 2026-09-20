import { describe, expect, test } from "bun:test";

import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";

function agentPlanImageConfig() {
    const channel = createModelChannel({
        id: "ark-plan-image",
        name: "Ark Plan Seedream",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        apiKey: "test-key",
        interfaceType: "volcengine-ark-agent-plan-image",
        models: ["doubao-seedream-4-0-250828"],
        modelCosts: [{
            model: "doubao-seedream-4-0-250828",
            capability: "image",
            protocol: "volcengine-ark-agent-plan-image",
            billingMode: "fixed_request",
            unitPriceMicrocredits: 1,
        }],
    });
    const model = encodeChannelModel(channel.id, "doubao-seedream-4-0-250828");
    return { ...defaultConfig, channels: [channel], model, baseUrl: channel.baseUrl, interfaceType: channel.interfaceType };
}

function agentPlanVideoConfig() {
    const channel = createModelChannel({
        id: "ark-plan-video",
        name: "Ark Plan Seedance",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
        apiKey: "test-key",
        interfaceType: "volcengine-ark-agent-plan-video",
        models: ["doubao-seedance-1-5-pro-251215"],
        modelCosts: [{
            model: "doubao-seedance-1-5-pro-251215",
            capability: "video",
            protocol: "volcengine-ark-agent-plan-video",
            billingMode: "token",
            inputPricePerMillion: 1,
            outputPricePerMillion: 1,
        }],
    });
    const model = encodeChannelModel(channel.id, "doubao-seedance-1-5-pro-251215");
    return { ...defaultConfig, channels: [channel], model, videoModel: model, baseUrl: channel.baseUrl, interfaceType: channel.interfaceType };
}

describe("generation-task ark asset references", () => {
    test("agent plan Seedream image mode does not rewrite references to asset://", async () => {
        const input = await prepareBackendGenerationTask({
            mode: "image",
            prompt: "edit this",
            config: agentPlanImageConfig(),
            referenceImages: [{
                id: "ref-1",
                name: "ref.png",
                type: "image/png",
                url: "https://cdn.example.com/ref.png",
                storageKey: "resource:res-1",
                arkAssetId: "asset-already-synced",
            }],
        });
        const images = (input.input as { referenceImages?: Array<{ url?: string; storageKey?: string }> }).referenceImages || [];
        expect(images).toHaveLength(1);
        expect(images[0]?.url).not.toStartWith("asset://");
        expect(images[0]?.storageKey).toBe("resource:res-1");
    });

    test("agent plan Seedance video mode still prefers asset:// when arkAssetId exists", async () => {
        const input = await prepareBackendGenerationTask({
            mode: "video",
            prompt: "animate this",
            config: agentPlanVideoConfig(),
            referenceImages: [{
                id: "ref-1",
                name: "ref.png",
                type: "image/png",
                url: "https://cdn.example.com/ref.png",
                storageKey: "resource:res-1",
                arkAssetId: "asset-already-synced",
            }],
        });
        const images = (input.input as { referenceImages?: Array<{ url?: string }> }).referenceImages || [];
        expect(images).toHaveLength(1);
        expect(images[0]?.url).toBe("asset://asset-already-synced");
    });
});
