import { describe, expect, test } from "bun:test";

import { modelQuoteDescription, referenceVideoBillingLabel, referenceVideoQuoteBreakdown, systemModelQuoteRequest } from "../src/lib/model-pricing";
import { connectionInputSummary } from "../src/lib/canvas/canvas-connection-policy";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const tier = (prices: { reference?: number } = {}) => ({
    selector: {},
    resolution: "*",
    videoSeconds: 0,
    billingMode: "per_second" as const,
    unitPriceMicrocredits: 1_000_000,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    referenceVideoUnitPriceMicrocredits: prices.reference ?? 0,
});

describe("reference video billing labels", () => {
    test("marks billed, unbilled and free video models", () => {
        expect(referenceVideoBillingLabel({ capability: "video", referenceVideoBilling: true, logicalPriceTiers: [tier({ reference: 2_000_000 })] })).toBe("参考视频另计费");
        expect(referenceVideoBillingLabel({ capability: "video", referenceVideoBilling: false, logicalPriceTiers: [tier()] })).toBe("参考视频不计费");
        // 免费模型（带参考视频价格为 0）也标注不计费，作为卖点。
        expect(referenceVideoBillingLabel({ capability: "video", referenceVideoBilling: true, logicalPriceTiers: [{ ...tier(), unitPriceMicrocredits: 0 }] })).toBe("参考视频不计费");
        expect(referenceVideoBillingLabel({ capability: "image", referenceVideoBilling: true })).toBe("");
        expect(referenceVideoBillingLabel(undefined)).toBe("");
    });

    test("describes the quote composition", () => {
        expect(referenceVideoQuoteBreakdown({ count: 1, billed: true, generatedSeconds: 5, referenceSeconds: 7.2, billedSeconds: 8, estimated: false })).toBe("生成 5 秒 + 参考视频 8 秒（参考视频另计费）");
        expect(referenceVideoQuoteBreakdown({ count: 1, billed: false, generatedSeconds: 5, referenceSeconds: 8, billedSeconds: 0, estimated: false })).toBe("生成 5 秒 + 参考视频 8 秒（参考视频不计费）");
        expect(referenceVideoQuoteBreakdown({ count: 2, billed: false, generatedSeconds: 5, referenceSeconds: 0, billedSeconds: 0, estimated: false })).toBe("生成 5 秒 + 参考视频 2 个（参考视频不计费）");
        expect(referenceVideoQuoteBreakdown({ count: 1, billed: true, generatedSeconds: 5, referenceSeconds: 15, billedSeconds: 0, estimated: true })).toContain("按 15 秒预估");
        expect(referenceVideoQuoteBreakdown(undefined)).toBe("");
        const description = modelQuoteDescription({
            logicalModelId: "",
            billingMode: "per_second",
            quantity: 13,
            amountMicrocredits: 26_000_000,
            estimated: false,
            referenceVideo: { count: 1, billed: true, generatedSeconds: 5, referenceSeconds: 7.2, billedSeconds: 8, estimated: false },
        });
        expect(description).toBe("本次消耗 26 积分；生成 5 秒 + 参考视频 8 秒（参考视频另计费）");
    });
});

describe("reference video quote durations", () => {
    const config = (): AiConfig => {
        const channel = createModelChannel({
            id: "system-channel",
            name: "系统渠道",
            scope: "system",
            baseUrl: "/api/system-channel",
            apiKey: "system",
            apiFormat: "openai",
            models: ["video-model"],
            modelCosts: [{ model: "video-model", capability: "video", pricePolicy: "channel", billingMode: "per_second", unitPriceMicrocredits: 1_000_000, referenceVideoBilling: true, logicalPriceTiers: [tier({ reference: 2_000_000 })] }],
        });
        return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "system-channel::video-model", videoModel: "system-channel::video-model", vquality: "720P", videoSeconds: "5" } }).config;
    };

    test("sends known canvas reference durations and omits partially unknown ones", () => {
        const nodes = [
            { id: "target", type: CanvasNodeType.Video, metadata: {} },
            { id: "v1", type: CanvasNodeType.Video, metadata: { durationMs: 3_000 } },
            { id: "v2", type: CanvasNodeType.Video, metadata: { durationMs: 4_500 } },
        ] as unknown as CanvasNodeData[];
        const connections = [
            { id: "c1", fromNodeId: "v1", toNodeId: "target" },
            { id: "c2", fromNodeId: "v2", toNodeId: "target" },
        ] as never;
        const input = connectionInputSummary("target", nodes, connections);
        expect(input.videoDurationsMs).toEqual([3_000, 4_500]);
        const request = systemModelQuoteRequest(config(), "system-channel::video-model", "video", { capability: "video", input, videoSeconds: "5" });
        expect(request?.intent.inputs?.video).toBe(2);
        expect(request?.intent.referenceVideoDurationsMs).toEqual([3_000, 4_500]);

        const unknown = systemModelQuoteRequest(config(), "system-channel::video-model", "video", { capability: "video", input: { ...input, videoDurationsMs: [3_000, 0] }, videoSeconds: "5" });
        expect(unknown?.intent.referenceVideoDurationsMs).toBeUndefined();
    });
});
