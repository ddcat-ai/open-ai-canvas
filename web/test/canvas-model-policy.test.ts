import { describe, expect, test } from "bun:test";

import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { assertCanvasImageReferenceLimit, buildGenerationConfig, canvasImageReferenceLimitError, resolveCanvasGenerationModel } from "../src/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { groupModelsByDisplayName, inferVideoOperation, modelCompatibilityError, modelGroupReferenceLimits, resolveCompatibleModel, resolveModelGenerationDefaults } from "../src/lib/model-selection";
import { defaultConfig, normalizeModelOptionValue, type AiConfig, type ModelChannel } from "../src/stores/use-config-store";
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
    test("图片逻辑模型忽略全局视频时长，不应显示为不支持当前时长", () => {
        const model = "platform::gpt-image-2";
        const channel: ModelChannel = {
            id: "platform",
            name: "平台模型",
            baseUrl: "/api",
            apiKey: "system",
            apiFormat: "openai",
            scope: "system",
            enabled: true,
            models: ["gpt-image-2"],
            modelCosts: [{
                model: "gpt-image-2",
                displayName: "GPT Image 2",
                capability: "image",
                billingMode: "fixed_request",
                unitPriceMicrocredits: 1,
                logicalCapabilitySpec: {
                    version: 1,
                    capability: "image",
                    options: { size: { values: ["1:1", "3:2"] } },
                },
            }],
        };
        const config: AiConfig = {
            ...defaultConfig,
            channels: [channel],
            models: [model],
            imageModels: [model],
            imageModel: model,
            model,
        };

        expect(modelCompatibilityError(config, model, {
            capability: "image",
            input: { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 },
            videoSeconds: "6",
            imageSize: "3:2",
            options: { size: "3:2" },
        })).toBe("");
    });

    test("后台图片默认比例优先于旧的全局 1:1 配置", () => {
        const model = "platform::managed-image";
        const profile = defaultModelCapabilityConfig(undefined, "managed-image");
        profile.image!.size = { parameter: "size", values: ["1:1", "16:9"], default: "16:9", allowCustom: false };
        const config: AiConfig = {
            ...defaultConfig,
            size: "1:1",
            channels: [{ id: "platform", name: "平台模型", baseUrl: "/api", apiKey: "system", apiFormat: "openai", scope: "system", models: ["managed-image"], modelCosts: [{ model: "managed-image", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1, logicalModelId: "managed-image", logicalCapabilitySpec: { version: 1, capability: "image" }, capabilityConfig: profile }] }],
            models: [model],
            imageModels: [model],
            imageModel: model,
            model,
        };

        expect(resolveModelGenerationDefaults(config, model, "image", {}, { size: "1:1" }).size).toBe("16:9");
    });

    test("后台视频默认时长优先于旧的全局 6 秒配置", () => {
        const model = "platform::managed-video";
        const profile = defaultModelCapabilityConfig(undefined, "managed-video");
        profile.video!.duration = { selection: "enum", values: [6, 15], default: 15 };
        const config: AiConfig = {
            ...defaultConfig,
            videoSeconds: "6",
            channels: [{ id: "platform", name: "平台模型", baseUrl: "/api", apiKey: "system", apiFormat: "openai", scope: "system", models: ["managed-video"], modelCosts: [{ model: "managed-video", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 1, logicalModelId: "managed-video", logicalCapabilitySpec: { version: 1, capability: "video" }, capabilityConfig: profile }] }],
            models: [model],
            videoModels: [model],
            videoModel: model,
            model,
        };

        expect(resolveModelGenerationDefaults(config, model, "video", {}, { videoSeconds: "6" }).videoSeconds).toBe("15");
    });


    test("渠道视频能力配置优先于旧的全局 6 秒和 1:1 配置", () => {
        const model = "autodl-channel::MiniMax H3";
        const profile = defaultModelCapabilityConfig("autodl-comfyui", "MiniMax H3");
        profile.video!.duration = { selection: "range", min: 1, max: 15, step: 1, default: 15 };
        profile.video!.defaultRatio = "16:9";
        const config: AiConfig = {
            ...defaultConfig,
            videoSeconds: "6",
            size: "1:1",
            channels: [{ id: "autodl-channel", name: "AutoDL", baseUrl: "https://autodl.art", apiKey: "system", apiFormat: "openai", scope: "system", models: ["MiniMax H3"], modelCosts: [{ model: "MiniMax H3", capability: "video", protocol: "autodl-comfyui", billingMode: "fixed_request", unitPriceMicrocredits: 1, capabilityConfig: profile }] }],
            models: [model],
            videoModels: [model],
            videoModel: model,
            model,
        };

        const defaults = resolveModelGenerationDefaults(config, model, "video", {}, { videoSeconds: "6", size: "1:1" });
        expect(defaults.videoSeconds).toBe("15");
        expect(defaults.size).toBe("16:9");
    });

    test("不支持画幅的视频模型不会继续提交旧的全局尺寸", () => {
        const model = "autodl-channel::minimax_h3_lightx2v_no_pic";
        const profile = defaultModelCapabilityConfig("autodl-comfyui", "minimax_h3_lightx2v_no_pic");
        profile.video!.ratios = [];
        profile.video!.defaultRatio = "";
        profile.video!.resolutions = ["480p竖", "480p横"];
        profile.video!.defaultResolution = "480p竖";
        const config: AiConfig = {
            ...defaultConfig,
            size: "16:9",
            vquality: "720",
            channels: [{ id: "autodl-channel", name: "AutoDL", baseUrl: "https://autodl.art", apiKey: "system", apiFormat: "openai", scope: "system", models: ["minimax_h3_lightx2v_no_pic"], modelCosts: [{ model: "minimax_h3_lightx2v_no_pic", capability: "video", protocol: "autodl-comfyui", billingMode: "fixed_request", unitPriceMicrocredits: 1, capabilityConfig: profile }] }],
            models: [model],
            videoModels: [model],
            videoModel: model,
            model,
        };
        const videoNode = { ...node("video", CanvasNodeType.Video), metadata: { model, generationMode: "video" as const } };

        const generationConfig = buildGenerationConfig(config, videoNode, "video");

        expect(generationConfig.size).toBe("");
        expect(generationConfig.vquality).toBe("480p竖");
    });

    test("后台标注的视频模型不因内部标识缺少视频关键词而回退", () => {
        const config = policyConfig();
        const selectedModel = config.videoModels[0]!;
        const videoNode = { ...node("video", CanvasNodeType.Video), metadata: { model: selectedModel } };

        expect(resolveCanvasGenerationModel(config, selectedModel, "video")).toBe(selectedModel);
        expect(buildGenerationConfig(config, videoNode, "video").model).toBe(selectedModel);
    });

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

    test("音频仅在单独参考时归类为音频生视频", () => {
        expect(inferVideoOperation({ textCount: 1, imageCount: 0, videoCount: 0, audioCount: 1, characterCount: 0 })).toBe("audio_to_video");
        expect(inferVideoOperation({ textCount: 1, imageCount: 1, videoCount: 0, audioCount: 1, characterCount: 0 })).toBe("image_to_video");
        expect(inferVideoOperation({ textCount: 1, imageCount: 0, videoCount: 1, audioCount: 1, characterCount: 0 })).toBe("reference_to_video");
    });

    test("图片加音频可匹配支持图生视频和参考音频的模型", () => {
        const config = policyConfig();
        const imageModel = "relay::cinema-image";
        const imageCost = config.channels[0]?.modelCosts?.find((item) => item.model === "cinema-image");
        if (!imageCost?.capabilityConfig?.video) throw new Error("缺少图生视频能力配置");
        imageCost.capabilityConfig.video.references.maxAudios = 1;
        const requirements = {
            capability: "video" as const,
            input: { textCount: 0, imageCount: 1, videoCount: 0, audioCount: 1, characterCount: 0 },
            videoSeconds: "6",
        };

        expect(modelCompatibilityError(config, imageModel, requirements)).toBe("");
        expect(resolveCompatibleModel(config, "relay::cinema-text", requirements)).toBe(imageModel);
    });

    test("逻辑视频模型将 720 与 720p 视为同一分辨率", () => {
        const model = "cinema-720p";
        const channel: ModelChannel = {
            id: "logical-video",
            name: "平台视频模型",
            baseUrl: "/api",
            apiKey: "system",
            apiFormat: "openai",
            scope: "system",
            models: [model],
            modelCosts: [{
                model,
                capability: "video",
                billingMode: "per_second",
                unitPriceMicrocredits: 1,
                logicalCapabilitySpec: {
                    version: 1,
                    capability: "video",
                    operations: ["text_to_video"],
                    inputs: {},
                    options: {
                        videoSeconds: { min: 1, max: 15, step: 1 },
                        size: { values: ["16:9"] },
                        vquality: { values: ["720p"] },
                        videoGenerateAudio: { values: [false] },
                        videoWatermark: { values: [false] },
                    },
                },
            }],
        };
        const value = `logical-video::${model}`;
        const config = { ...defaultConfig, channels: [channel], models: [value], videoModels: [value], videoModel: value };

        expect(modelCompatibilityError(config, value, {
            capability: "video",
            input: { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 },
            options: { size: "16:9", videoSeconds: 6, vquality: "720", videoGenerateAudio: false, videoWatermark: false },
        })).toBe("");
    });

    test("已保存的旧 SKU 选择会解析到新的模型家族", () => {
        const channel: ModelChannel = {
            id: "managed",
            name: "平台模型",
            baseUrl: "/api",
            apiKey: "system",
            apiFormat: "openai",
            scope: "system",
            models: ["family-seedance-2-5"],
            modelAliases: { "legacy-seedance-720": "family-seedance-2-5" },
        };

        expect(normalizeModelOptionValue("managed::legacy-seedance-720", [channel])).toBe("managed::family-seedance-2-5");
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

describe("图片参考图上限", () => {
    test("超出当前模型上限时保留全部输入并返回明确错误", () => {
        const config = policyConfig();
        const modelCost = config.channels[0]?.modelCosts?.[0];
        if (!modelCost?.capabilityConfig?.image) throw new Error("缺少图片能力配置");
        modelCost.capabilityConfig.image.references.maxImages = 1;
        const references = [
            { id: "image-a", name: "image-a.png", type: "image/png", dataUrl: "data:image/png;base64,YQ==" },
            { id: "image-b", name: "image-b.png", type: "image/png", dataUrl: "data:image/png;base64,Yg==" },
        ];

        expect(canvasImageReferenceLimitError(config, references)).toContain("最多支持 1 张参考图，当前已连接 2 张");
        expect(() => assertCanvasImageReferenceLimit(config, references)).toThrow("请移除多余连线后重试");
        expect(references).toHaveLength(2);
    });
});
