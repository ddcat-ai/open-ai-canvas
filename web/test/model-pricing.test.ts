import { describe, expect, test } from "bun:test";

import { modelQuoteRequest, normalizeTierResolution, priceTierSummaryLabel, priceTiersForCurrentSelection, requestCreditCost } from "../src/lib/model-pricing";
import type { ModelRequirements } from "../src/lib/model-selection";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelChannel, type AiConfig } from "../src/stores/use-config-store";
import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { modelRequestOptions } from "../src/lib/model-selection";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function systemConfig(input: { capability?: "image" | "video"; logicalModelId?: string; tiers: Array<{ selector: Record<string, string>; billingMode: "fixed_request" | "per_second" | "token"; unitPriceMicrocredits: number }> }) {
    const capability = input.capability || "video";
    const model = capability === "video" ? "agnes-video-2.5" : "image-model";
    const channel = createModelChannel({
        id: "system-channel",
        name: "系统渠道",
        scope: "system",
        baseUrl: "/api/system-channel",
        apiKey: "system",
        apiFormat: "openai",
        models: [model],
        modelCosts: [
            {
                model,
                capability,
                pricePolicy: "channel",
                billingMode: input.tiers[0]?.billingMode || "fixed_request",
                unitPriceMicrocredits: input.tiers[0]?.unitPriceMicrocredits || 0,
                logicalModelId: input.logicalModelId,
                logicalPriceTiers: input.tiers.map((tier) => ({
                    ...tier,
                    resolution: tier.selector.vquality || "*",
                    videoSeconds: Number(tier.selector.videoSeconds || 0),
                    inputTokenPriceMicrocredits: 0,
                    outputTokenPriceMicrocredits: 0,
                    cachedTokenPriceMicrocredits: 0,
                })),
            },
        ],
    });
    return normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            channels: [channel],
            model: `${channel.id}::${model}`,
            imageModel: capability === "image" ? `${channel.id}::${model}` : defaultConfig.imageModel,
            videoModel: capability === "video" ? `${channel.id}::${model}` : defaultConfig.videoModel,
            quality: "high",
            size: "16:9",
            vquality: "720P",
            videoSeconds: "5",
            count: "3",
        },
    }).config;
}

const textVideoRequirements: ModelRequirements = {
    capability: "video",
    input: { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 },
    videoSeconds: "5",
    options: { size: "16:9", vquality: "720", videoSeconds: 5 },
};

describe("model request pricing", () => {
    test("keeps the panel quote and generation options aligned without selecting a price tier as quality", () => {
        const config = systemConfig({
            capability: "image",
            tiers: [
                { selector: { quality: "1k" }, billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000 },
                { selector: { quality: "2k" }, billingMode: "fixed_request", unitPriceMicrocredits: 2_000_000 },
                { selector: { quality: "4k" }, billingMode: "fixed_request", unitPriceMicrocredits: 4_000_000 },
            ],
        });
        for (const size of ["auto", "1024x1024", "2048x2048"]) {
            const node: CanvasNodeData = { id: "image-1", type: CanvasNodeType.Image, title: "Image", position: { x: 0, y: 0 }, width: 400, height: 400, metadata: { model: config.model, quality: "auto", size } };
            const requirements: ModelRequirements = { capability: "image", options: { quality: "auto", size } };
            const panel = buildNodeConfig(config, node, "image", requirements);
            const generation = buildGenerationConfig(config, node, "image", requirements);
            expect(modelRequestOptions(panel, "image")).toEqual(modelRequestOptions(generation, "image"));
            expect(panel.quality).toBe("auto");
        }
    });

    test("uses image dimensions to match resolution pricing when quality is automatic", () => {
        const config = systemConfig({
            capability: "image",
            tiers: [
                { selector: { quality: "1k" }, billingMode: "fixed_request", unitPriceMicrocredits: 2_000_000 },
                { selector: { quality: "2k" }, billingMode: "fixed_request", unitPriceMicrocredits: 3_000_000 },
                { selector: { quality: "4k" }, billingMode: "fixed_request", unitPriceMicrocredits: 5_000_000 },
            ],
        });
        for (const [size, price] of [["1024x1024", 2], ["2048x2048", 3], ["2880x2880", 5]] as const) {
            expect(requestCreditCost({ channelMode: "remote", modelCosts: resolveModelChannel(config, config.model).modelCosts, model: "image-model", capability: "image", config: { ...config, quality: "auto", size }, requirements: { capability: "image", options: { quality: "auto", size } }, count: 1 })).toBe(price);
        }
    });

    test("matches each image resolution and generation operation for quotes and displayed costs", () => {
        const qualities = ["1k", "2k", "4k"];
        const config = systemConfig({
            capability: "image",
            logicalModelId: "logical-image",
            tiers: ["text_to_image", "image_to_image"].flatMap((operation, operationIndex) =>
                qualities.map((quality, index) => ({
                    selector: { operation, quality },
                    billingMode: "fixed_request" as const,
                    unitPriceMicrocredits: (index + 1 + operationIndex * 3) * 1_000_000,
                })),
            ),
        });
        const channel = resolveModelChannel(config, config.model);
        for (const imageCount of [0, 1]) {
            for (const [index, quality] of qualities.entries()) {
                const requirements: ModelRequirements = {
                    capability: "image",
                    input: { textCount: 1, imageCount, characterCount: 0, videoCount: 0, audioCount: 0 },
                    options: { quality: quality.toUpperCase(), size: "16:9" },
                };
                expect(requestCreditCost({ channelMode: "remote", modelCosts: channel.modelCosts, model: "image-model", capability: "image", config, requirements, count: 1 })).toBe(index + 1 + imageCount * 3);
                expect(modelQuoteRequest(config, config.model, "image", requirements)?.intent).toMatchObject({
                    operation: imageCount ? "image_to_image" : "text_to_image",
                    inputs: { image: imageCount },
                    options: { quality: quality.toUpperCase() },
                });
            }
        }
        const characterRequirements: ModelRequirements = { capability: "image", input: { textCount: 1, imageCount: 0, characterCount: 1, videoCount: 0, audioCount: 0 }, options: { quality: "2k" } };
        expect(modelQuoteRequest(config, config.model, "image", characterRequirements)?.intent).toMatchObject({ operation: "image_to_image", inputs: { image: 1 } });
        expect(requestCreditCost({ channelMode: "remote", modelCosts: channel.modelCosts, model: "image-model", capability: "image", config, requirements: characterRequirements, count: 1 })).toBe(5);
        expect(priceTiersForCurrentSelection(channel.modelCosts![0]!.logicalPriceTiers!, "image", { ...config, quality: "8k" })).toHaveLength(0);
    });

    test("prefers a matching image specification over the uniform fallback", () => {
        const config = systemConfig({ capability: "image", tiers: [
            { selector: {}, billingMode: "fixed_request", unitPriceMicrocredits: 1_000_000 },
            { selector: { operation: "text_to_image", quality: "2k" }, billingMode: "fixed_request", unitPriceMicrocredits: 2_000_000 },
        ] });
        const tiers = resolveModelChannel(config, config.model).modelCosts![0]!.logicalPriceTiers!;
        expect(priceTiersForCurrentSelection(tiers, "image", { ...config, quality: "2k" })[0]?.unitPriceMicrocredits).toBe(2_000_000);
        expect(priceTiersForCurrentSelection(tiers, "image", { ...config, quality: "4k" })[0]?.unitPriceMicrocredits).toBe(1_000_000);
    });

    test("preserves provider-specific resolution enums when matching price tiers", () => {
        expect(normalizeTierResolution("768P竖")).toBe("768p竖");
        expect(normalizeTierResolution("HD_Portrait")).toBe("hd_portrait");
    });

    test("matches the current Agnes resolution and duration tier and totals per-second credits", () => {
        const config = systemConfig({
            tiers: [
                { selector: { operation: "text_to_video", vquality: "720p", videoSeconds: "5" }, billingMode: "per_second", unitPriceMicrocredits: 25_000 },
                { selector: { operation: "text_to_video", vquality: "960p", videoSeconds: "5" }, billingMode: "per_second", unitPriceMicrocredits: 40_000 },
                { selector: { operation: "image_to_video", vquality: "720p", videoSeconds: "5", imageCount: "1" }, billingMode: "per_second", unitPriceMicrocredits: 30_000 },
            ],
        });
        const channel = resolveModelChannel(config, config.model);

        expect(
            requestCreditCost({
                channelMode: "remote",
                modelCosts: channel.modelCosts,
                model: "agnes-video-2.5",
                capability: "video",
                config,
                requirements: textVideoRequirements,
                seconds: "5",
            }),
        ).toBe(0.125);
    });

    test("displays zero-price system tiers as configured free pricing", () => {
        const fixedConfig = systemConfig({
            capability: "image",
            tiers: [{ selector: {}, billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
        });
        const perSecondConfig = systemConfig({
            tiers: [{ selector: {}, billingMode: "per_second", unitPriceMicrocredits: 0 }],
        });

        expect(priceTierSummaryLabel(resolveModelChannel(fixedConfig, fixedConfig.model).modelCosts![0]!.logicalPriceTiers!)).toBe("0 积分");
        expect(priceTierSummaryLabel(resolveModelChannel(perSecondConfig, perSecondConfig.model).modelCosts![0]!.logicalPriceTiers!)).toBe("0 积分/秒");
    });

    test("uses reference count and operation to avoid a text-video price tier", () => {
        const config = systemConfig({
            tiers: [
                { selector: { operation: "text_to_video", vquality: "720p", videoSeconds: "5" }, billingMode: "per_second", unitPriceMicrocredits: 25_000 },
                { selector: { operation: "image_to_video", vquality: "720p", videoSeconds: "5", imageCount: "1" }, billingMode: "per_second", unitPriceMicrocredits: 30_000 },
            ],
        });
        const requirements: ModelRequirements = {
            ...textVideoRequirements,
            input: { ...textVideoRequirements.input!, imageCount: 1 },
        };
        const matched = priceTiersForCurrentSelection(resolveModelChannel(config, config.model).modelCosts![0]!.logicalPriceTiers!, "video", config, requirements);

        expect(matched).toHaveLength(1);
        expect(matched[0]?.unitPriceMicrocredits).toBe(30_000);
    });

    test("multiplies fixed image request pricing by output count", () => {
        const config = systemConfig({
            capability: "image",
            tiers: [{ selector: { quality: "high", size: "16:9" }, billingMode: "fixed_request", unitPriceMicrocredits: 10_000 }],
        });
        const channel = resolveModelChannel(config, config.model);

        expect(
            requestCreditCost({
                channelMode: "remote",
                modelCosts: channel.modelCosts,
                model: "image-model",
                capability: "image",
                config,
                requirements: { capability: "image" },
                count: 3,
            }),
        ).toBe(0.03);
    });

    test("builds a logical-model quote using the normalized current request", () => {
        const config = systemConfig({
            logicalModelId: "logical-video-1",
            tiers: [{ selector: {}, billingMode: "per_second", unitPriceMicrocredits: 25_000 }],
        });
        const quote = modelQuoteRequest(config, config.model, "video", textVideoRequirements);

        expect(quote).toMatchObject({
            logicalModelID: "logical-video-1",
            intent: {
                capability: "video",
                operation: "text_to_video",
                inputs: { image: 0, video: 0, audio: 0 },
                options: { vquality: "720", videoSeconds: 5 },
            },
        });
    });
});
