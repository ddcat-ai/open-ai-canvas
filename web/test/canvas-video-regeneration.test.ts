import { describe, expect, test } from "bun:test";

import { listVideoReferenceModels, validateVideoSegmentBatch, videoReferenceOperationError, videoReferenceRegenerationError, videoReferenceSegmentError } from "../src/lib/canvas/canvas-video-regeneration";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { defaultConfig, type AiConfig, type ModelChannel } from "../src/stores/use-config-store";

function supportedVideoConfig(overrides: { model?: string; maxVideos?: number; maxVideoDurationSeconds?: number; operations?: string[]; baseUrl?: string } = {}): AiConfig {
    const model = overrides.model || "seedance-1.0-pro";
    const capability = defaultModelCapabilityConfig("newapi-channel-2", model);
    if (capability.video) {
        capability.video.references.maxVideos = overrides.maxVideos ?? 3;
        capability.video.references.maxVideoDurationSeconds = overrides.maxVideoDurationSeconds ?? 15;
        capability.video.operations = overrides.operations ?? ["text_to_video", "image_to_video", "extend"];
    }
    const channel: ModelChannel = {
        id: "test",
        name: "测试渠道",
        baseUrl: overrides.baseUrl || "https://api.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        interfaceType: "newapi-channel-2",
        models: [model],
        scope: "user",
        modelCosts: [
            {
                model,
                capability: "video",
                protocol: "newapi-channel-2",
                billingMode: "per_second",
                unitPriceMicrocredits: 1,
                capabilityConfig: capability,
            },
        ],
    };
    return {
        ...defaultConfig,
        model: `test::${model}`,
        videoModel: `test::${model}`,
        models: [`test::${model}`],
        videoModels: [`test::${model}`],
        channels: [channel],
        baseUrl: channel.baseUrl,
    };
}

describe("videoReferenceRegenerationError", () => {
    test("模型不支持参考视频时返回提示", () => {
        const config: AiConfig = { ...defaultConfig, model: "default::grok-imagine-video", videoModel: "default::grok-imagine-video" };
        expect(videoReferenceRegenerationError(config)).toContain("不支持参考视频");
    });

    test("模型没有可用生成模式时返回提示", () => {
        const config = supportedVideoConfig({ operations: [] });
        expect(videoReferenceRegenerationError(config)).toContain("没有可用的视频生成模式");
    });

    test("模型支持参考视频且有可用模式时无错误", () => {
        expect(videoReferenceRegenerationError(supportedVideoConfig())).toBe("");
    });
});

describe("videoReferenceOperationError", () => {
    test("所选模式不在模型能力中时返回提示", () => {
        const config = supportedVideoConfig({ operations: ["text_to_video", "image_to_video", "extend"] });
        expect(videoReferenceOperationError(config, "inpaint")).toContain("不支持所选生成模式");
    });

    test("所选模式在模型能力中时无错误", () => {
        expect(videoReferenceOperationError(supportedVideoConfig(), "extend")).toBe("");
    });
});

describe("listVideoReferenceModels", () => {
    test("默认配置没有可用的参考视频模型", () => {
        const config: AiConfig = { ...defaultConfig, model: "default::grok-imagine-video", videoModel: "default::grok-imagine-video" };
        expect(listVideoReferenceModels(config)).toEqual([]);
    });

    test("只返回支持参考视频且有可用模式的模型", () => {
        expect(listVideoReferenceModels(supportedVideoConfig())).toEqual(["test::seedance-1.0-pro"]);
    });

    test("过滤掉没有可用生成模式的模型", () => {
        const config = supportedVideoConfig({ operations: [] });
        expect(listVideoReferenceModels(config)).toEqual([]);
    });

    test("过滤掉未配置 API Key 的渠道模型", () => {
        const config = supportedVideoConfig();
        config.channels[0].apiKey = "";
        expect(listVideoReferenceModels(config)).toEqual([]);
    });
});

describe("videoReferenceSegmentError", () => {
    test("片段超过模型参考视频上限时返回提示", () => {
        const config = supportedVideoConfig({ maxVideoDurationSeconds: 15 });
        expect(videoReferenceSegmentError(config, 16000)).toContain("不能超过当前模型参考视频上限（15 秒）");
    });

    test("Seedance 单段少于 2 秒时返回提示", () => {
        const config = supportedVideoConfig({ model: "seedance-1.0-pro" });
        expect(videoReferenceSegmentError(config, 1500)).toContain("至少 2 秒");
    });

    test("合法片段时长无错误", () => {
        expect(videoReferenceSegmentError(supportedVideoConfig(), 5000)).toBe("");
    });
});

describe("validateVideoSegmentBatch", () => {
    test("模型、模式与片段时长都合法时无错误", () => {
        expect(validateVideoSegmentBatch(supportedVideoConfig(), [{ startMs: 2000, endMs: 5000 }], "extend")).toBe("");
    });

    test("模型不支持参考视频时返回首个错误", () => {
        const config: AiConfig = { ...defaultConfig, model: "default::grok-imagine-video", videoModel: "default::grok-imagine-video" };
        expect(validateVideoSegmentBatch(config, [{ startMs: 2000, endMs: 5000 }], "extend")).toContain("不支持参考视频");
    });

    test("模式不在模型能力中时返回操作错误", () => {
        expect(validateVideoSegmentBatch(supportedVideoConfig(), [{ startMs: 2000, endMs: 5000 }], "inpaint")).toContain("不支持所选生成模式");
    });

    test("片段超过模型时长上限时返回片段错误", () => {
        expect(validateVideoSegmentBatch(supportedVideoConfig({ maxVideoDurationSeconds: 15 }), [{ startMs: 0, endMs: 16000 }], "extend")).toContain("不能超过当前模型参考视频上限");
    });
});
