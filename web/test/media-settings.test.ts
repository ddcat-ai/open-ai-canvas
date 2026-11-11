import { describe, expect, test } from "bun:test";
import axios from "axios";
import { requestGeneration } from "../src/services/api/image";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { preserveVideoSettings, preserveImageSettings, videoSettingIssues, imageSettingIssues, mediaSettingIssues, resolvedMediaConfig } from "../src/lib/media-settings";
import { projectImageParameters } from "../src/lib/image-parameters";
import { defaultConfig, createModelChannel, encodeChannelModel, type AiConfig } from "../src/stores/use-config-store";
import { resolveModelGenerationDefaults } from "../src/lib/model-selection";
import { systemModelQuoteRequest as modelQuoteRequest } from "../src/lib/model-pricing";
import { applyNodeConfigPatch } from "../src/lib/canvas/canvas-project-domain";
import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-config";
import { runBackendCanvasGenerationTask } from "../src/lib/canvas/canvas-project-generation";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function videoConfig() {
    const capabilityConfig = defaultModelCapabilityConfig();
    capabilityConfig.video = {
        ...capabilityConfig.video!,
        duration: { selection: "enum", values: [5, 10], default: 5 },
        ratios: ["16:9", "9:16"],
        defaultRatio: "16:9",
        resolutions: ["720p", "1440p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: false },
        watermark: { supported: false, default: false },
    };
    const channel = createModelChannel({
        id: "models",
        scope: "system",
        interfaceType: "newapi-channel-2",
        models: ["A", "B"],
        modelCosts: ["A", "B"].map((model) => ({ model, capability: "video", capabilityConfig, billingMode: "per_second", unitPriceMicrocredits: 1 })),
    });
    return {
        ...defaultConfig,
        channels: [channel],
        model: encodeChannelModel(channel.id, "B"),
        videoModel: encodeChannelModel(channel.id, "B"),
        size: "9:16",
        videoSeconds: "10",
        vquality: "720",
        videoGenerateAudio: "true",
        videoWatermark: "false",
    } as AiConfig;
}

describe("媒体模型切换兼容设置", () => {
    for (const protocol of ["grok-image", "agnes-image"] as const) {
        for (const protocolSource of ["model", "channel"] as const) {
            test(`${protocol} 历史 quality 档位在 ${protocolSource} 协议下切换后报价与提交一致`, () => {
                const capabilityConfig = defaultModelCapabilityConfig(protocol);
                const channel = createModelChannel({
                    id: "legacy",
                    scope: "system",
                    interfaceType: protocolSource === "channel" ? protocol : "openai-image",
                    models: ["A", "B"],
                    modelCosts: ["A", "B"].map((model) => ({ model, capability: "image", protocol: protocolSource === "model" ? protocol : undefined, capabilityConfig, billingMode: "fixed_request", unitPriceMicrocredits: 0 })),
                });
                const config = { ...defaultConfig, channels: [channel], model: "legacy::A", imageModel: "legacy::A", size: "16:9", quality: "1k", count: "1", imageResolution: undefined, imageParameters: "{}" } as AiConfig;
                for (const imageResolution of [undefined, "auto"]) {
                    const original: CanvasNodeData = {
                        id: "legacy",
                        type: CanvasNodeType.Image,
                        title: "原图",
                        position: { x: 0, y: 0 },
                        width: 300,
                        height: 200,
                        metadata: { model: config.model, size: "16:9", quality: "1k", imageResolution, count: 1, content: "old.png" },
                    };
                    const switched = applyNodeConfigPatch(original, { model: "legacy::B" });
                    const ui = buildNodeConfig(config, switched, "image", { capability: "image" });
                    expect(ui).toMatchObject({ size: "16:9", quality: "auto", imageResolution: "1k" });
                    expect(switched.metadata?.content).toBe("old.png");
                    const raw = { ...config, model: "legacy::B", imageResolution } as AiConfig;
                    expect(mediaSettingIssues(raw, "image")).toEqual([]);
                    const quote = modelQuoteRequest(raw, raw.model, "image")!;
                    const submitted = backendProviderConfig(raw, "image");
                    expect(quote.intent.options).toMatchObject({ size: submitted.size, imageResolution: submitted.imageResolution });
                    expect(submitted).toMatchObject({ imageResolution: "1k", interfaceType: protocol });
                    expect(modelQuoteRequest(ui, ui.model, "image")?.intent.options).toEqual(quote.intent.options);
                }
                const explicit = { ...config, model: "legacy::B", imageResolution: "2K" };
                expect(backendProviderConfig(explicit, "image").imageResolution).toBe("2k");
                expect(modelQuoteRequest(explicit, explicit.model, "image")?.intent.options?.imageResolution).toBe("2k");
                const invalid = { ...explicit, imageResolution: "8k" };
                expect(preserveImageSettings(capabilityConfig.image!, invalid, protocol).imageResolution).toBe(capabilityConfig.image!.resolution.default);
                expect(modelQuoteRequest(invalid, invalid.model, "image")?.intent.options?.imageResolution).toBe(capabilityConfig.image!.resolution.default);
                expect(backendProviderConfig(invalid, "image").imageResolution).toBe(capabilityConfig.image!.resolution.default);
                expect(mediaSettingIssues({ ...config, quality: "9k" }, "image")).toEqual([]);
            });
        }
    }
    test("历史 quality 映射限定已声明协议，Grok 实际请求保留 1K 而不是默认 2K", async () => {
        const capabilityConfig = defaultModelCapabilityConfig("grok-image");
        expect(preserveImageSettings(capabilityConfig.image!, { quality: "1k" }, "openai-image").imageResolution).toBe(capabilityConfig.image!.resolution.default);
        const channel = createModelChannel({ id: "legacy", scope: "system", models: ["grok"], modelCosts: [{ model: "grok", capability: "image", protocol: "grok-image", capabilityConfig, billingMode: "fixed_request", unitPriceMicrocredits: 0 }] });
        const config = { ...defaultConfig, channels: [channel], model: "legacy::grok", quality: "1k", imageResolution: undefined, size: "16:9", count: "1", imageParameters: "{}" } as AiConfig;
        const original = axios.request;
        const bodies: unknown[] = [];
        axios.request = (async (input: { data: unknown }) => {
            bodies.push(input.data);
            return { data: { data: [{ b64_json: "abc" }] } };
        }) as typeof original;
        try {
            const quote = modelQuoteRequest(config, config.model, "image")!;
            await requestGeneration(config, "图片");
            expect(bodies).toEqual([expect.objectContaining({ resolution: quote.intent.options?.imageResolution, aspect_ratio: "16:9" })]);
            expect(quote.intent.options?.imageResolution).toBe("1k");
            await requestGeneration({ ...config, imageResolution: "8k" }, "图片");
            expect(bodies).toHaveLength(2);
            expect(bodies[1]).toMatchObject({ resolution: capabilityConfig.image!.resolution.default });
        } finally {
            axios.request = original;
        }
    });
    test("图片直连提交使用与报价相同的明确尺寸映射，旧扩展参数不发送", async () => {
        const image = projectImageParameters(defaultModelCapabilityConfig().image!, [
            { name: "size", label: "尺寸", type: "string", values: ["1024x1024", "1536x1024"], default: "1024x1024", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1k"], default: "1k" },
        ]);
        image.size.presets = [{ tier: "1k", ratio: "3:2", size: "1536x1024", width: 1536, height: 1024 }];
        const channel = createModelChannel({
            id: "direct",
            scope: "system",
            interfaceType: "openai-image",
            models: ["B"],
            modelCosts: [{ model: "B", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 0, capabilityConfig: { version: 1, image } }],
        });
        const config = { ...defaultConfig, channels: [channel], model: "direct::B", size: "3:2", imageResolution: "1k", quality: "auto", count: "1", transparentBackground: "false", imageParameters: "{}" };
        const original = axios.request;
        const bodies: unknown[] = [];
        axios.request = (async (input: { data: unknown }) => {
            bodies.push(input.data);
            return { data: { data: [{ b64_json: "abc" }] } };
        }) as typeof original;
        try {
            const quote = modelQuoteRequest(config, config.model, "image")!;
            await requestGeneration(config, "图片");
            expect(bodies).toHaveLength(1);
            expect(bodies[0]).toMatchObject({ size: quote.intent.options?.size });
            expect(quote.intent.options?.size).toBe("1536x1024");
            await requestGeneration({ ...config, imageParameters: '{"old_style":"film"}' }, "图片");
            expect(bodies).toHaveLength(2);
            expect(bodies[1]).toEqual(bodies[0]);
        } finally {
            axios.request = original;
        }
    });
    test("A→B→A 与同值重选保持原设置，同批显式新值优先", () => {
        const original: CanvasNodeData = {
            id: "roundtrip",
            type: CanvasNodeType.Image,
            title: "原图",
            position: { x: 0, y: 0 },
            width: 300,
            height: 200,
            metadata: { model: "models::A", size: "21:9", imageResolution: "4k", imageParameters: '{"seed":42}', content: "image.png", prompt: "原提示词" },
        };
        const canonical = applyNodeConfigPatch(original, { model: "models::A" });
        const switched = applyNodeConfigPatch(canonical, { model: "models::B" });
        expect(switched.metadata).toMatchObject({ ...original.metadata, model: "models::B" });
        expect(applyNodeConfigPatch(switched, { model: "models::B" })).toEqual(switched);
        expect(applyNodeConfigPatch(switched, { model: "models::A" })).toEqual(canonical);
        expect(applyNodeConfigPatch(original, { model: "models::B", size: "16:9", imageResolution: "1k" }).metadata).toMatchObject({ model: "models::B", size: "16:9", imageResolution: "1k", imageParameters: '{"seed":42}', content: "image.png" });
    });
    test("视频保留受支持时长、比例、音频和明确分辨率别名", () => {
        const config = videoConfig();
        const value = resolveModelGenerationDefaults(config, config.model, "video", { size: "9:16", videoSeconds: "10", vquality: "720", videoGenerateAudio: "true" });
        expect(value).toMatchObject({ size: "9:16", videoSeconds: "10", vquality: "720", videoGenerateAudio: "true" });
        expect(mediaSettingIssues(config, "video")).toEqual([]);
        expect(resolveModelGenerationDefaults(config, config.model, "video", {}).videoSeconds).toBe("5");
    });

    test("视频 auto 仅在支持省略分辨率的协议保留，未填写仍使用模型默认", () => {
        const config = { ...videoConfig(), vquality: "auto" };
        const profile = modelCapabilityConfigFor(config, config.model).video!;
        for (const protocol of ["newapi", "openai-video", "newapi-channel-2"]) {
            expect(preserveVideoSettings(profile, { resolution: "auto" }, protocol).resolution).toBe("auto");
            expect(videoSettingIssues(profile, { resolution: "auto" }, protocol)).toEqual([]);
            expect(preserveVideoSettings(profile, {}, protocol).resolution).toBe(profile.defaultResolution);
        }
        expect(preserveVideoSettings(profile, { resolution: "auto" }, "volcengine-ark-video").resolution).toBe(profile.defaultResolution);
        expect(resolvedMediaConfig(config, "video").vquality).toBe("auto");
        expect(resolveModelGenerationDefaults(config, config.model, "video", { vquality: "auto" }).vquality).toBe("auto");
        expect(mediaSettingIssues(config, "video")).toEqual([]);
    });

    test("不兼容整数时长使用默认，错误类型不取整，2K 使用默认而非 1440p", () => {
        const profile = modelCapabilityConfigFor(videoConfig(), videoConfig().model).video!;
        for (const seconds of ["7", "30"]) {
            expect(preserveVideoSettings(profile, { seconds }).seconds).toBe("5");
            expect(videoSettingIssues(profile, { seconds })).toEqual([]);
        }
        expect(preserveVideoSettings(profile, { seconds: "10.5" }).seconds).toBe("10.5");
        expect(videoSettingIssues(profile, { seconds: "10.5" }).some((item) => item.field === "videoSeconds")).toBe(true);
        expect(preserveVideoSettings(profile, { resolution: "2K" }).resolution).toBe("720p");
        expect(videoSettingIssues(profile, { resolution: "2K" })).toEqual([]);
        const range = { ...profile, duration: { selection: "range" as const, min: 4, max: 10, step: 2, default: 6 } };
        expect(preserveVideoSettings(range, { seconds: "5.9" }).seconds).toBe("5.9");
        expect(videoSettingIssues(range, { seconds: "5.9" })[0].field).toBe("videoSeconds");
    });

    test("图片使用目标模型精确预设，未知扩展移除且不兼容值用有效默认", () => {
        const profile = projectImageParameters(defaultModelCapabilityConfig().image!, [
            { name: "size", label: "尺寸", type: "string", values: ["1024x1024", "1536x1024"], default: "1024x1024", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1k"], default: "1k" },
            { name: "seed", label: "种子", type: "integer", min: 0, max: 100, default: 1 },
        ]);
        profile.size.presets = [{ tier: "1k", ratio: "3:2", size: "1536x1024", width: 1536, height: 1024 }];
        const source = { size: "3:2", imageResolution: "1K", imageParameters: '{"seed":42,"old_style":"film"}' };
        const preserved = preserveImageSettings(profile, source);
        expect(preserved.size).toBe("1536x1024");
        expect(preserved.imageResolution).toBe("1k");
        expect(JSON.parse(preserved.imageParameters!)).toEqual({ seed: 42 });
        expect(imageSettingIssues(profile, source)).toEqual([]);
        expect(preserveImageSettings(profile, { size: "21:9" }).size).toBe("1024x1024");
        expect(imageSettingIssues(profile, { size: "21:9" })).toEqual([]);
        expect(JSON.parse(preserveImageSettings(profile, { imageParameters: '{"seed":101}' }).imageParameters!)).toEqual({ seed: 1 });
    });

    test("画布保存重开保留原媒体、产出模型、提示词、扩展参数和同批显式值", () => {
        const node: CanvasNodeData = {
            id: "node",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 0, y: 0 },
            width: 300,
            height: 200,
            metadata: {
                model: "models::A",
                seconds: "10",
                size: "9:16",
                vquality: "720",
                content: "video.mp4",
                storageKey: "resource:video",
                producedModel: { value: "models::A" } as never,
                prompt: "原提示词",
                generationSpec: {
                    version: 1,
                    mode: "video",
                    prompt: "原提示词",
                    textInputMode: "prompt-only",
                    modelSelection: { kind: "channel", channelId: "models", modelKey: "A" },
                    options: { durationSeconds: 10, size: "9:16", resolution: "720", generateAudio: true },
                    referenceBindings: [{ id: "ref", nodeId: "ref-node", mediaType: "image", role: "reference", order: 0, resolution: "latest" }],
                },
            },
        };
        const next = applyNodeConfigPatch(node, { model: "models::B", seconds: "5" });
        const reopened = JSON.parse(JSON.stringify(next));
        expect(reopened.metadata.generationSpec.options.durationSeconds).toBe(5);
        expect(reopened.metadata.generationSpec.referenceBindings).toEqual(node.metadata!.generationSpec!.referenceBindings);
        expect(reopened.metadata.content).toBe("video.mp4");
        expect(reopened.metadata.producedModel).toEqual(node.metadata!.producedModel);
        expect(reopened.metadata.generationSpec.prompt).toBe("原提示词");
        const image = { ...node, type: CanvasNodeType.Image, metadata: { ...node.metadata, generationSpec: { ...node.metadata!.generationSpec!, mode: "image" as const, options: { size: "3:2", imageParameters: '{"seed":42}' } } } };
        expect(applyNodeConfigPatch(image, { model: "models::B" }).metadata?.generationSpec?.options.imageParameters).toBe('{"seed":42}');
    });

    test("界面报价与提交使用相同适配值；结构错误不创建任务", async () => {
        const config = videoConfig();
        const node: CanvasNodeData = {
            id: "n",
            type: CanvasNodeType.Video,
            title: "视频",
            position: { x: 0, y: 0 },
            width: 300,
            height: 200,
            metadata: { model: config.model, seconds: "10", vquality: "720", size: "9:16", generateAudio: "true", watermark: "false" },
        };
        const ui = buildNodeConfig(config, node, "video", { capability: "video" });
        const quote = modelQuoteRequest(ui, ui.model, "video")!;
        const submitted = backendProviderConfig(ui, "video");
        expect(quote.intent.options).toMatchObject({ size: submitted.size, videoSeconds: Number(submitted.videoSeconds), vquality: submitted.vquality, videoGenerateAudio: true });
        let created = 0;
        const adapted = { ...ui, videoSeconds: "11" };
        expect(modelQuoteRequest(adapted, adapted.model, "video")?.intent.options?.videoSeconds).toBe(5);
        expect(backendProviderConfig(adapted, "video").videoSeconds).toBe("5");
        const invalid = { ...ui, videoSeconds: "wrong" };
        expect(modelQuoteRequest(invalid, invalid.model, "video")).toBeUndefined();
        await expect(
            runBackendCanvasGenerationTask(
                { projectId: "p", nodeId: "n", mode: "video", prompt: "测试", config: invalid },
                {
                    createId: () => "task",
                    createTask: async () => {
                        created++;
                        throw new Error("unexpected submission");
                    },
                    waitTask: async () => {
                        throw new Error("unexpected wait");
                    },
                },
            ),
        ).rejects.toThrow("时长“wrong”待调整");
        expect(created).toBe(0);
    });
});
