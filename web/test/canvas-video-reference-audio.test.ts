import { describe, expect, test } from "bun:test";

import { supportsVideoReferenceAudio } from "../src/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";

function videoConfig(protocol: string, model: string, maxAudios?: number): AiConfig {
    const capabilityConfig = defaultModelCapabilityConfig(protocol, model);
    if (maxAudios !== undefined) capabilityConfig.video!.references.maxAudios = maxAudios;
    const channel = createModelChannel({
        id: "video",
        name: "Video",
        baseUrl: "https://video.example/v1",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        models: [model],
        modelCosts: [{ model, capability: "video", protocol, billingMode: "fixed_request", unitPriceMicrocredits: 0, capabilityConfig }],
    });
    return { ...defaultConfig, channels: [channel], model: `video::${model}`, videoModel: `video::${model}` };
}

// 视频重试是否带参考音频与首次生成同一来源：模型能力的参考音频上限，而不是协议 ID 或模型名。
describe("video retry reference audio", () => {
    test("keeps reference audio for models whose capability declares it", () => {
        expect(supportsVideoReferenceAudio(videoConfig("minimax-video", "MiniMax-H3"))).toBe(true);
        expect(supportsVideoReferenceAudio(videoConfig("dashscope-wan-video", "wan2.6-r2v", 3))).toBe(true);
    });

    test("drops reference audio when the capability declares none, even for Seedance names", () => {
        expect(supportsVideoReferenceAudio(videoConfig("newapi", "doubao-seedance-1-0-pro", 0))).toBe(false);
        expect(supportsVideoReferenceAudio(videoConfig("kling-video", "kling-v2"))).toBe(false);
    });
});
