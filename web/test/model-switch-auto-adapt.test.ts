import { expect, test } from "bun:test";
import snapshot from "./fixtures/nano-banana-2-model-capability.json";
import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "../src/lib/model-capabilities";
import { preserveImageSettings, imageSettingIssues, resolvedMediaConfig, mediaSettingIssues, preserveVideoSettings } from "../src/lib/media-settings";
import { projectImageParameters } from "../src/lib/image-parameters";
import { systemModelQuoteRequest as modelQuoteRequest } from "../src/lib/model-pricing";
import { modelRequestOptions, resolveCompatibleModel, resolveModelGenerationDefaults } from "../src/lib/model-selection";
import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-config";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { specFromConfig, generationSpecMetadata } from "../src/lib/canvas/generation-contract";
import { applyNodeConfigPatch } from "../src/lib/canvas/canvas-project-domain";
import { buildCanvasOperations } from "../src/services/user-data-sync";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { defaultConfig, createModelChannel, encodeChannelModel, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { useUserStore } from "../src/stores/use-user-store";

function fixture(capabilityConfig = structuredClone(snapshot) as ModelCapabilityConfig) {
    const channel = createModelChannel({
        id: "target",
        scope: "system",
        models: ["nano-banana-2"],
        modelCosts: [{ model: "nano-banana-2", capability: "image", protocol: "change2pro-image", capabilityConfig, billingMode: "fixed_request", unitPriceMicrocredits: 12345 }],
    });
    const selected = encodeChannelModel(channel.id, "nano-banana-2");
    return { ...defaultConfig, channels: [channel], model: selected, imageModel: selected, size: "9:16", quality: "high", imageResolution: "2K", imageParameters: "{}", count: "1", transparentBackground: "false" } as AiConfig;
}

test("传统图片模型不支持的可选值在报价与最终请求中一致省略", () => {
    const profile = defaultModelCapabilityConfig();
    Object.assign(profile.image!, {
        parameters: undefined,
        size: { parameter: "none", values: [], default: "auto", allowCustom: false },
        quality: { supported: false, values: [], default: "auto" },
        resolution: { supported: false, values: [], default: "" },
        transparentBackground: { supported: false, default: false },
    });
    const config = fixture(profile);
    expect(modelRequestOptions(config, "image")).toEqual({ count: 1 });
    const requested = backendProviderConfig(config, "image");
    for (const field of ["size", "quality", "imageResolution", "transparentBackground"] as const) expect(requested[field]).toBeUndefined();
});

test("画布批量张数适配不将小数或损坏类型伪装成一张", () => {
    const config = fixture();
    for (const count of ["1.5", "wrong"]) {
        expect(resolveModelGenerationDefaults(config, config.model, "image", { count }).count).toBe(count);
        expect(() => backendProviderConfig({ ...config, count }, "image")).toThrow();
    }
});

test("真实 nano-banana-2 禁用质量：切换、旧节点重开、报价与提交都去除 high", async () => {
    const config = fixture();
    const profile = config.channels[0].modelCosts![0].capabilityConfig!.image!;
    const adapted = preserveImageSettings(profile, config, "change2pro-image");
    expect(imageSettingIssues(profile, adapted, "change2pro-image")).toEqual([]);
    expect(adapted).toMatchObject({ size: "9:16", imageResolution: "2k", quality: "" });
    const node: CanvasNodeData = {
        id: "n",
        type: CanvasNodeType.Image,
        title: "原图",
        position: { x: 0, y: 0 },
        width: 300,
        height: 200,
        metadata: { model: config.model, quality: "high", size: "9:16", imageResolution: "2K", imageParameters: "{}", content: "image.png", prompt: "原提示词" },
    };
    const ui = buildNodeConfig(config, node, "image", { capability: "image" });
    const runtime = buildGenerationConfig(config, node, "image");
    expect(ui).toMatchObject(adapted);
    expect(runtime).toMatchObject(adapted);
    expect(node.metadata!.content).toBe("image.png");
    const reopened = { ...node, metadata: { ...node.metadata, ...generationSpecMetadata(specFromConfig("image", "原提示词", ui)) } };
    expect(buildNodeConfig(config, JSON.parse(JSON.stringify(reopened)), "image", { capability: "image" })).toMatchObject(adapted);
    const quote = modelQuoteRequest(config, config.model, "image", { options: { quality: "high", imageResolution: "2K", old_style: "film" } })!;
    expect(quote.intent.options).toEqual({ size: "9:16", imageResolution: "2k", count: 1 });
    expect(modelRequestOptions(ui, "image")).toEqual(quote.intent.options);
    const submitted = backendProviderConfig(config, "image");
    expect(submitted.quality).toBeUndefined();
    expect(submitted.imageParameters).toEqual(quote.intent.options);
    const task = await prepareBackendGenerationTask({ mode: "image", prompt: "原提示词", config });
    expect(task.input.config).toMatchObject({ quality: undefined, imageParameters: quote.intent.options });
});

test("真实节点模型切换写入适配结果，序列化重开不残留 quality 镜像或旧扩展", () => {
    const config = fixture();
    const node: CanvasNodeData = {
        id: "saved-image",
        type: CanvasNodeType.Image,
        title: "原图",
        position: { x: 12, y: 34 },
        width: 300,
        height: 200,
        metadata: { model: "source::old", quality: "high", size: "9:16", imageResolution: "2K", imageParameters: '{"old_style":"film"}', content: "image.png", prompt: "原提示词" },
    };
    const canonical = applyNodeConfigPatch(node, { composerContent: "保留草稿" });
    const switched = applyNodeConfigPatch(canonical, { model: config.model }, config);
    expect(switched.metadata?.quality).toBeUndefined();
    expect(switched.metadata?.generationSpec?.options).not.toHaveProperty("quality");
    expect(switched.metadata).toMatchObject({ model: config.model, size: "9:16", imageResolution: "2k", imageParameters: "{}", content: "image.png", composerContent: "保留草稿" });
    expect(switched.position).toEqual(node.position);
    expect(canonical.metadata?.quality).toBe("high");
    const reopened: CanvasNodeData = JSON.parse(JSON.stringify(switched));
    const ui = buildNodeConfig(config, reopened, "image", { capability: "image" });
    const request = backendProviderConfig(buildGenerationConfig(config, reopened, "image"), "image");
    expect(ui.quality).toBe("");
    expect(request.quality).toBeUndefined();
    expect(modelQuoteRequest(ui, ui.model, "image")!.intent.options).not.toHaveProperty("quality");
    const before = { id: "canvas", nodes: [canonical], connections: [], chatSessions: [] } as unknown as CanvasProject;
    const operations = JSON.parse(JSON.stringify(buildCanvasOperations(before, { ...before, nodes: [reopened] })));
    const patch = operations.find((operation: { type: string }) => operation.type === "patch_node").patch;
    expect(patch["metadata.quality"]).toBeNull();
    expect(patch["metadata.generationSpec.options.quality"]).toBeNull();
});

test("配置节点切换同样保存目标能力，兼容扩展 0/false 不被清空", () => {
    const profile = structuredClone(snapshot) as ModelCapabilityConfig;
    profile.image!.parameters!.push({ name: "seed2", label: "种子", type: "integer", min: 0, max: 9, default: 3 }, { name: "raw", label: "原始", type: "boolean", default: true });
    const config = fixture(profile);
    const node: CanvasNodeData = {
        id: "config",
        type: CanvasNodeType.Config,
        title: "配置",
        position: { x: 0, y: 0 },
        width: 300,
        height: 200,
        metadata: { generationMode: "image", model: "source::old", quality: "high", imageParameters: '{"seed2":0,"raw":false,"old_style":"film"}', size: "9:16", imageResolution: "2K" },
    };
    const switched = applyNodeConfigPatch(node, { model: config.model }, config);
    expect(switched.metadata?.quality).toBeUndefined();
    expect(JSON.parse(switched.metadata!.imageParameters!)).toEqual({ seed2: 0, raw: false });
    expect(switched.metadata?.generationSpec).toBeUndefined();
});

test("目标关闭分辨率时清除两个存储字段，结构损坏的扩展仍拒绝生成", async () => {
    const profile = structuredClone(snapshot) as ModelCapabilityConfig;
    profile.image!.parameters = profile.image!.parameters!.map((field) => (field.name === "imageResolution" ? { ...field, enabled: false } : field));
    const config = fixture(profile);
    const node: CanvasNodeData = {
        id: "resolution",
        type: CanvasNodeType.Image,
        title: "图片",
        position: { x: 0, y: 0 },
        width: 300,
        height: 200,
        metadata: { model: "source::old", size: "9:16", imageResolution: "8K", quality: "high", imageParameters: "{" },
    };
    const switched = applyNodeConfigPatch(node, { model: config.model }, config);
    expect(switched.metadata?.imageResolution).toBeUndefined();
    expect(switched.metadata?.generationSpec?.options).not.toHaveProperty("imageResolution");
    expect(switched.metadata?.imageParameters).toBe("{");
    await expect(prepareBackendGenerationTask({ mode: "image", prompt: "测试", config: buildGenerationConfig(config, switched, "image") })).rejects.toThrow();
});

test.each([
    [5, 4, 2],
    [3, 3, 2],
    [1, 1, 1],
])("切换模型保留当前画布拆单张数，不受目标单次输出上限限制（账号上限 %d）", (activeTaskLimit, expectedCount, expectedExplicitCount) => {
    const previousLimits = useUserStore.getState().runtimeLimits;
    useUserStore.getState().setRuntimeLimits({ ...previousLimits, activeTaskLimit });
    try {
        const profile = structuredClone(snapshot) as ModelCapabilityConfig;
        profile.image!.maxOutputs = 4;
        profile.image!.parameters = profile.image!.parameters!.filter((field) => field.name !== "count");
        profile.image!.parameters.push({ name: "count", label: "张数", type: "integer", min: 1, max: 4, default: 1 });
        const config = { ...fixture(profile), canvasImageCount: "4", count: "2" };
        for (const type of [CanvasNodeType.Image, CanvasNodeType.Config]) {
            const node: CanvasNodeData = { id: "count", type, title: "张数", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { generationMode: "image", model: "source::old" } };
            const reopened: CanvasNodeData = JSON.parse(JSON.stringify(applyNodeConfigPatch(node, { model: config.model }, config)));
            expect(reopened.metadata?.count).toBe(expectedCount);
            const runtime = buildGenerationConfig(config, reopened, "image");
            expect(runtime.count).toBe(String(expectedCount));
            // 画布按账号上限分发单图任务，单次报价继续按一张计算。
            expect(modelQuoteRequest(runtime, runtime.model, "image")!.intent.options.count).toBe(1);
            if (type === CanvasNodeType.Image) {
                expect(reopened.metadata?.generationSpec?.options.count).toBe(expectedCount);
                expect(buildNodeConfig(config, reopened, "image", { capability: "image" }).count).toBe(String(expectedCount));
            }
            expect(applyNodeConfigPatch({ ...node, metadata: { ...node.metadata, count: 2 } }, { model: config.model }, config).metadata?.count).toBe(expectedExplicitCount);
            const restricted = fixture();
            restricted.canvasImageCount = "4";
            expect(applyNodeConfigPatch(node, { model: restricted.model }, restricted).metadata?.count).toBe(expectedCount);
        }
    } finally {
        useUserStore.getState().setRuntimeLimits(previousLimits);
    }
});

test("视频切换保存有效时长与音轨", () => {
    const profile = defaultModelCapabilityConfig();
    Object.assign(profile.video!, {
        duration: { selection: "enum", values: [5, 10], default: 5 },
        ratios: ["16:9"],
        defaultRatio: "16:9",
        resolutions: ["720p"],
        defaultResolution: "720p",
        generateAudio: { supported: false, default: false },
        watermark: { supported: false, default: false },
    });
    const channel = createModelChannel({
        id: "target",
        scope: "system",
        models: ["video", "live"],
        modelCosts: [{ model: "video", capability: "video", protocol: "newapi-channel-2", capabilityConfig: profile }],
    });
    const config = { ...defaultConfig, channels: [channel] };
    for (const type of [CanvasNodeType.Video, CanvasNodeType.Config]) {
        const node: CanvasNodeData = {
            id: "video",
            type,
            title: "视频",
            position: { x: 0, y: 0 },
            width: 300,
            height: 200,
            metadata: { generationMode: "video", model: "source::old", seconds: "30", size: "21:9", vquality: "2K", generateAudio: "true", watermark: "true", content: "video.mp4", composerContent: "保留提示词" },
        };
        const switched = applyNodeConfigPatch(node, { model: "target::video" }, config);
        const reopened: CanvasNodeData = JSON.parse(JSON.stringify(switched));
        expect(reopened.metadata).toMatchObject({ model: "target::video", seconds: "5", size: "16:9", vquality: "720p", generateAudio: "false", watermark: "false", content: "video.mp4", composerContent: "保留提示词" });
        if (type === CanvasNodeType.Video) expect(reopened.metadata?.generationSpec?.options).toMatchObject({ durationSeconds: 5, resolution: "720p", generateAudio: false, watermark: false });
    }
});

test("开放值域保留自定义质量，缺省值与 0/false 的扩展按目标字段适配", () => {
    const image = projectImageParameters(defaultModelCapabilityConfig().image!, [
        { name: "quality", label: "质量", type: "string", values: [], default: "standard" },
        { name: "seed", label: "种子", type: "integer", min: 0, max: 9, default: 3 },
        { name: "raw", label: "原始", type: "boolean", default: true },
        { name: "optional", label: "可选", type: "string", values: ["a"] },
    ]);
    const result = preserveImageSettings(image, { quality: "high", imageParameters: '{"seed":0,"raw":false,"optional":"old","old_style":"film"}' });
    expect(result.quality).toBe("high");
    expect(JSON.parse(result.imageParameters!)).toMatchObject({ seed: 0, raw: false });
    expect(JSON.parse(result.imageParameters!)).not.toHaveProperty("old_style");
    expect(JSON.parse(result.imageParameters!)).not.toHaveProperty("optional");
    expect(imageSettingIssues(image, result)).toEqual([]);
    expect(JSON.parse(preserveImageSettings(image, { imageParameters: '{"seed":10}' }).imageParameters!).seed).toBe(3);
    expect(imageSettingIssues(image, { imageParameters: '{"seed":"wrong"}' }).some((i) => i.field === "seed")).toBe(true);
    expect(imageSettingIssues(image, { imageParameters: "{" }).some((i) => i.field === "imageParameters")).toBe(true);
});

test("视频不兼容时使用目标默认，2K 不被当成 1440p，结构错误仍拒绝", () => {
    const video = defaultModelCapabilityConfig().video!;
    video.duration = { selection: "enum", values: [5, 10], default: 5 };
    video.ratios = ["16:9", "9:16"];
    video.defaultRatio = "16:9";
    video.resolutions = ["720p", "1440p"];
    video.defaultResolution = "720p";
    expect(preserveVideoSettings(video, { seconds: "11", ratio: "21:9", resolution: "2K" })).toEqual({ seconds: "5", ratio: "16:9", resolution: "720p" });
    expect(preserveVideoSettings(video, { seconds: "10", ratio: "9:16", resolution: "720" })).toEqual({ seconds: "10", ratio: "9:16", resolution: "720p" });
    expect(preserveVideoSettings(video, { seconds: "wrong" }).seconds).toBe("wrong");
});

test("尺寸适配先确定有效分辨率，再用目标精确 preset；无映射时使用配置默认", () => {
    const image = projectImageParameters(defaultModelCapabilityConfig().image!, [
        { name: "size", label: "尺寸", type: "string", values: ["1024x1024", "1536x1024"], default: "1024x1024", encoding: "pixels" },
        { name: "imageResolution", label: "分辨率", type: "string", values: ["1k"], default: "1k" },
    ]);
    image.size.presets = [{ tier: "1k", ratio: "3:2", size: "1536x1024", width: 1536, height: 1024 }];
    expect(preserveImageSettings(image, { size: "3:2", imageResolution: "8k" })).toMatchObject({ size: "1536x1024", imageResolution: "1k" });
    expect(preserveImageSettings(image, { size: "21:9" }).size).toBe("1024x1024");
    expect(preserveImageSettings(image, { size: "1536x1024" }).size).toBe("1536x1024");
});

test("坏 JSON、已知字段错误类型与必填缺省不能被适配伪装成功", async () => {
    const profile = structuredClone(snapshot) as ModelCapabilityConfig;
    profile.image!.parameters!.push({ name: "seed", label: "种子", type: "integer", min: 0, max: 9, default: 3, enabled: true });
    profile.image!.parameters = profile.image!.parameters!.filter((field, index, all) => field.name !== "seed" || index === all.findLastIndex((candidate) => candidate.name === "seed"));
    const config = fixture(profile);
    for (const patch of [{ imageParameters: "{" }, { imageParameters: "[]" }, { imageParameters: '{"seed":"wrong"}' }, { imageParameters: '{"count":"wrong"}' }, { count: "1.5" }, { count: "wrong" }]) {
        const invalid = { ...config, ...patch };
        expect(mediaSettingIssues(invalid, "image").length).toBeGreaterThan(0);
        expect(modelQuoteRequest(invalid, config.model, "image")).toBeUndefined();
        await expect(prepareBackendGenerationTask({ mode: "image", prompt: "fixture", config: invalid })).rejects.toThrow();
    }
    const required = projectImageParameters(profile.image!, [{ name: "style", label: "风格", type: "string", values: ["a"], required: true }]);
    expect(imageSettingIssues(required, { imageParameters: '{"style":"old"}' }).some((issue) => issue.field === "style")).toBe(true);
    required.parameters![0].default = "invalid";
    expect(imageSettingIssues(required, { imageParameters: '{"style":"a"}' }).some((issue) => issue.field === "style")).toBe(true);
});

test("报价 requirements 扩展与逻辑模型最终请求共用适配结果，旧 namespace 不发送", async () => {
    const profile = structuredClone(snapshot) as ModelCapabilityConfig;
    profile.image!.parameters = profile.image!.parameters!.filter((field) => field.name !== "seed");
    profile.image!.parameters.push({ name: "seed", label: "种子", type: "integer", min: 0, max: 9, default: 3, enabled: true });
    const config = fixture(profile);
    config.channels[0].modelCosts![0].logicalModelId = "logical";
    const quote = modelQuoteRequest(config, config.model, "image", { options: { seed: 0, quality: "high", old_style: "film" } })!;
    expect(quote.intent.options).toEqual({ size: "9:16", imageResolution: "2k", count: 1, seed: 0 });
    const task = await prepareBackendGenerationTask({ mode: "image", prompt: "fixture", config: { ...config, imageParameters: '{"seed":0,"old_style":"film"}' }, metadata: { providerOptions: { "old-provider": { old_style: "film" } }, other: "keep" } });
    expect(task.input.capabilityOptions).toEqual(quote.intent.options);
    expect((task.input.config as Record<string, unknown>).imageParameters).toEqual(quote.intent.options);
    expect(task.input.metadata).toEqual({ other: "keep" });
});

test("视频音轨与水印适配不改模型，不支持的字段省略", () => {
    const profile = defaultModelCapabilityConfig();
    profile.video!.generateAudio = { supported: false, default: false };
    profile.video!.watermark = { supported: false, default: false };
    profile.video!.duration = { selection: "enum", values: [5], default: 5 };
    profile.video!.resolutions = ["720p"];
    profile.video!.defaultResolution = "720p";
    const channel = createModelChannel({
        id: "video",
        models: ["A", "B"],
        scope: "system",
        modelCosts: ["A", "B"].map((model) => ({ model, capability: "video", displayName: "同名", protocol: "newapi-channel-2", capabilityConfig: profile, billingMode: "per_second", unitPriceMicrocredits: 1 })),
    });
    const config = { ...defaultConfig, channels: [channel], model: "video::B", videoModel: "video::B", videoSeconds: "30", size: "9:16", vquality: "2K", videoGenerateAudio: "true", videoWatermark: "true" } as AiConfig;
    expect(resolveCompatibleModel(config, "video::B", { capability: "video", videoSeconds: "30", options: { vquality: "2K" } })).toBe("video::B");
    const adapted = resolvedMediaConfig(config, "video");
    expect(adapted).toMatchObject({ model: "video::B", videoSeconds: "5", vquality: "720p", videoGenerateAudio: "false", videoWatermark: "false" });
    const taskConfig = backendProviderConfig(config, "video");
    const options = modelQuoteRequest(config, config.model, "video")!.intent.options;
    expect(options).not.toHaveProperty("videoGenerateAudio");
    expect(taskConfig.videoGenerateAudio).toBeUndefined();
});
