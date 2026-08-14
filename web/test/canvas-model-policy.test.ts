import { describe, expect, test } from "bun:test";

import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { groupModelsByDisplayName, modelCompatibilityError, modelGroupReferenceLimits, resolveCompatibleModel } from "../src/lib/model-selection";
import { defaultConfig, type AiConfig, type ModelChannel } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function policyConfig(): AiConfig {
    const variants = [
        { model: "cinema-text", operations: ["text_to_video"], maxImages: 0, maxVideos: 0, maxAudios: 0 },
        { model: "cinema-image", operations: ["image_to_video"], maxImages: 1, maxVideos: 0, maxAudios: 0 },
        { model: "cinema-audio", operations: ["audio_to_video"], maxImages: 0, maxVideos: 0, maxAudios: 1 },
    ];
    const channel: ModelChannel = {
        id: "relay",
        name: "中转渠道",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        models: variants.map((item) => item.model),
        modelCosts: variants.map((item) => {
            const capabilityConfig = defaultModelCapabilityConfig(undefined, item.model);
            capabilityConfig.video!.operations = item.operations;
            capabilityConfig.video!.references.maxImages = item.maxImages;
            capabilityConfig.video!.references.maxVideos = item.maxVideos;
            capabilityConfig.video!.references.maxAudios = item.maxAudios;
            return {
                model: item.model,
                displayName: "Cinema Pro",
                capability: "video" as const,
                billingMode: "per_second" as const,
                unitPriceMicrocredits: 1,
                capabilityConfig,
            };
        }),
    };
    const models = variants.map((item) => `relay::${item.model}`);
    return { ...defaultConfig, channels: [channel], models, videoModels: models, model: models[0], videoModel: models[0] };
}

function node(id: string, type: CanvasNodeType, generationMode?: "image" | "video"): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: generationMode ? { generationMode } : undefined,
    };
}

describe("逻辑模型选择", () => {
    test("同渠道同显示名称合并为一个逻辑模型", () => {
        const config = policyConfig();
        const groups = groupModelsByDisplayName(config, config.videoModels);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.models).toHaveLength(3);
    });

    test("根据参考图自动切换到图生视频细分模型", () => {
        const config = policyConfig();
        const resolved = resolveCompatibleModel(config, "relay::cinema-text", {
            capability: "video",
            input: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 },
            videoOperation: "text_to_video",
            videoSeconds: "6",
        });
        expect(resolved).toBe("relay::cinema-image");
    });

    test("音频输入只匹配支持音频的细分模型", () => {
        const config = policyConfig();
        const requirements = {
            capability: "video" as const,
            input: { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 1, characterCount: 0 },
            videoSeconds: "6",
        };
        expect(resolveCompatibleModel(config, "relay::cinema-text", requirements)).toBe("relay::cinema-audio");
        expect(modelCompatibilityError(config, "relay::cinema-image", requirements)).toContain("参考音频");
    });

    test("逻辑模型容量使用同名细分模型的最大值", () => {
        const config = policyConfig();
        expect(modelGroupReferenceLimits(config, "relay::cinema-text", "video")).toEqual({ maxImages: 1, maxVideos: 0, maxAudios: 1 });
    });
});

describe("画布连线能力", () => {
    test("超过所有视频模型的参考图上限时拒绝连线", () => {
        const config = policyConfig();
        const nodes = [node("image-a", CanvasNodeType.Image), node("image-b", CanvasNodeType.Image), node("target", CanvasNodeType.Config, "video")];
        const connections: CanvasConnection[] = [{ id: "existing", fromNodeId: "image-a", toNodeId: "target" }];
        expect(canvasConnectionError(config, nodes, connections, { fromNodeId: "image-b", toNodeId: "target" })).toContain("最多支持 1");
    });

    test("存在音频细分模型时允许音频连接视频生成节点", () => {
        const config = policyConfig();
        const nodes = [node("audio", CanvasNodeType.Audio), node("target", CanvasNodeType.Config, "video")];
        expect(canvasConnectionError(config, nodes, [], { fromNodeId: "audio", toNodeId: "target" })).toBe("");
    });

    test("视频结果不能连接到图片生成节点", () => {
        const config = policyConfig();
        const nodes = [node("video", CanvasNodeType.Video), node("target", CanvasNodeType.Image)];
        expect(canvasConnectionError(config, nodes, [], { fromNodeId: "video", toNodeId: "target" })).toContain("不能连接参考视频");
    });

    test("单个角色卡可以连接到音频生成节点", () => {
        const config = policyConfig();
        const character = { ...node("character", CanvasNodeType.Image), metadata: { workflowKind: "character" as const, characterAssetId: "character-asset" } };
        const nodes = [character, node("target", CanvasNodeType.Audio)];
        expect(canvasConnectionError(config, nodes, [], { fromNodeId: "character", toNodeId: "target" })).toBe("");
    });
});
