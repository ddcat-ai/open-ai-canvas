import { describe, expect, test } from "bun:test";
import { modelQuoteDescription } from "../src/lib/model-pricing";
import { quoteModel, type LogicalModelQuote, type ModelRequestIntent } from "../src/services/api/logical-models";
import { apiClient } from "../src/services/api/request";

const intent: ModelRequestIntent = { capability: "video", operation: "text_to_video", inputs: { image: 0, video: 0, audio: 0 }, options: { videoSeconds: 5, videoGenerateAudio: false } };
const quote: LogicalModelQuote = { logicalModelId: "", billingMode: "token", quantity: 1, amountMicrocredits: 500_000, estimated: true };

describe("model quote API targets", () => {
    test("direct system videos send the actual options and cancellation signal to the catalog quote", async () => {
        const original = apiClient.request;
        const calls: unknown[] = [];
        apiClient.request = (async (config: unknown) => {
            calls.push(config);
            return { data: { code: 0, data: { quote }, msg: "ok" }, status: 200, headers: {} };
        }) as typeof apiClient.request;
        try {
            const controller = new AbortController();
            expect(await quoteModel({ channelId: "channel-1", modelKey: "seedance", intent }, controller.signal)).toEqual({ quote });
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({ method: "post", url: "/model-catalog/quote", data: { channelId: "channel-1", modelKey: "seedance", intent }, signal: controller.signal });
        } finally {
            apiClient.request = original;
        }
    });

    test("logical models retain their dedicated quote route", async () => {
        const original = apiClient.request;
        const calls: unknown[] = [];
        apiClient.request = (async (config: unknown) => {
            calls.push(config);
            return { data: { code: 0, data: { quote }, msg: "ok" }, status: 200, headers: {} };
        }) as typeof apiClient.request;
        try {
            await quoteModel({ logicalModelID: "logical/video", intent });
            expect(calls[0]).toMatchObject({ method: "post", url: "/models/logical%2Fvideo/quote", data: intent });
        } finally {
            apiClient.request = original;
        }
    });

    test("missing quote targets fail before issuing a request", async () => {
        await expect(quoteModel({ intent })).rejects.toThrow("请选择");
    });
});

test("video estimates disclose platform reserves, unknown references and final settlement", () => {
    const description = modelQuoteDescription({
        ...quote,
        videoTokenEstimate: { formulaTokens: 100_000, reservedTokens: 110_000, outputWidth: 1280, outputHeight: 720, framesPerSecond: 24, outputSeconds: 5, referenceSeconds: 15, referenceDurationEstimated: true, dimensionsEstimated: true, reservationMarginPercent: 10 },
    });
    expect(description).toContain("预计消耗 0.5 积分");
    expect(description).toContain("公式预估 100,000 视频 Token");
    expect(description).toContain("平台额外预留 10%");
    expect(description).toContain("15 秒");
    expect(description).toContain("并非费用上限");
    expect(description).toContain("未返回用量时按火山引擎公式结算");
    expect(description).toContain("额外预留不计入公式结算");
    expect(description).toContain("补扣或退回差额");
});

test("text Token quotes retain upstream usage settlement without a video formula", () => {
    const description = modelQuoteDescription(quote);
    expect(description).toContain("实际用量结算");
    expect(description).not.toContain("火山引擎公式");
});
