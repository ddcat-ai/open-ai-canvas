import { expect, test } from "bun:test";
import { listVideoProcessingModels, videoProcessingTaskInput, videoProcessingQuoteRequest, videoProcessingSourceError, videoProcessingFields } from "@/lib/canvas/canvas-video-processing";
import { videoProcessingTools, validateProcessingParameters } from "@/lib/canvas/media-tool-contract";
import { validateGenerationSpec, readNodeGenerationSpec, generationSpecMetadata } from "@/lib/canvas/generation-contract";
import { agentVideoApproval, agentMediaSettings, agentApprovalMatchesSettings } from "@/lib/canvas/agent-media-approval";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { defaultConfig, createModelChannel, encodeChannelModel } from "@/stores/use-config-store";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const protocols = { depth: "starrouter-comfly-video-depth", upscale: "starrouter-comfly-video-upscale", remove_subtitles: "starrouter-comfly-video-subtitle-removal" };
const config = {
    ...defaultConfig,
    channels: Object.entries(protocols).map(([operation, protocol]) =>
        createModelChannel({
            id: operation,
            scope: "system",
            models: [operation],
            modelCosts: [{ model: operation, protocol, capability: "video", billingMode: "fixed_request", unitPriceMicrocredits: 0, capabilityConfig: defaultModelCapabilityConfig(protocol) }],
        }),
    ),
};

for (const operation of ["depth", "upscale", "remove_subtitles"] as const) {
    const model = encodeChannelModel(operation, operation);
    test(`${operation}: available models follow backend capability and availability`, () => {
        expect(listVideoProcessingModels(config, operation)).toEqual([model]);
        const unavailable = { ...config, channels: config.channels.map((channel) => ({ ...channel, modelCosts: channel.modelCosts?.map((cost) => ({ ...cost, available: false })) })) };
        expect(listVideoProcessingModels(unavailable, operation)).toEqual([]);
        expect(listVideoProcessingModels({ ...config, channels: config.channels.map((channel) => ({ ...channel, scope: "user" as const })) }, operation)).toEqual([]);
    });

    test(`${operation}: task and quote use the same operation and source`, async () => {
        const source = { id: "source", name: "source.mp4", type: "video/mp4", storageKey: "resource:source", durationMs: 12_500 };
        const input = videoProcessingTaskInput({ config: { ...config, taskWorkflowProvider: "runninghub", vquality: "4k", size: "1:1" }, operation, params: { model }, source, sourceNodeId: "source", projectId: "canvas", nodeId: "result" });
        const task = await prepareBackendGenerationTask(input);
        expect(task.operation).toBe(operation);
        expect(task.input.config).toMatchObject({ channelId: operation, model: operation, videoSeconds: "13" });
        expect(task.input.referenceVideos).toMatchObject([{ storageKey: "resource:source" }]);
        expect(task.input.metadata).toMatchObject({ sourceNodeId: "source", videoEditOperation: operation });
        for (const key of ["vquality", "size", "videoGenerateAudio", "videoWatermark"]) expect(task.input.config?.[key]).toBeUndefined();
        expect(task.input.config?.apiKey || "").toBe("");
        expect(videoProcessingQuoteRequest(config, { model }, operation, 12_500)).toMatchObject({ channelId: operation, intent: { operation, inputs: { video: 1 }, options: { videoSeconds: 13 } } });
        expect(videoProcessingQuoteRequest(config, { model }, operation)).toBeUndefined();
    });
}

test("single-video processing validates source duration and size before confirmation", () => {
    const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Video, title: "源视频", position: { x: 0, y: 0 }, width: 640, height: 360, metadata: { storageKey: "resource:source", bytes: 1024, durationMs: 1000 } };
    expect(videoProcessingSourceError(source, 180, "upscale", 100 * 1024 * 1024)).toBe("");
    expect(videoProcessingSourceError({ ...source, metadata: {} }, 180, "upscale")).toContain("为空");
    expect(videoProcessingSourceError({ ...source, metadata: { ...source.metadata, durationMs: 180_001 } }, 180, "upscale")).toContain("180 秒");
    expect(videoProcessingSourceError({ ...source, metadata: { ...source.metadata, bytes: 100 * 1024 * 1024 + 1 } }, 180, "remove_subtitles", 100 * 1024 * 1024)).toContain("100 MiB");
});

test("增强表单参数按共享定义与当前模型帧率配置收窄", () => {
    const protocol = "volcengine-mediakit-video-enhance";
    const profile = defaultModelCapabilityConfig(protocol);
    const enhanced = { ...defaultConfig, channels: [createModelChannel({ id: "enhance", scope: "system", models: ["enhance"], modelCosts: [{ model: "enhance", protocol, capability: "video", capabilityConfig: profile }] })] };
    const model = encodeChannelModel("enhance", "enhance");
    const fields = videoProcessingFields(enhanced, model, "enhance");
    expect(Object.keys(fields)).toContain("resolution");
    expect(Object.keys(fields)).toContain("bitrate");
    expect(fields.fps).toBeUndefined();
    expect(videoProcessingQuoteRequest(enhanced, { model, resolution: "1080p" }, "enhance", 12500)?.intent.processingParameters).toEqual({});
    profile.video!.processing = { ...profile.video!.processing!, fpsPolicy: "user_select", fpsOptions: [30, 60] };
    expect(videoProcessingFields(enhanced, model, "enhance").fps?.enum).toEqual([30, 60]);
    expect(videoProcessingQuoteRequest(enhanced, { model, resolution: "1080p", fps: 60, bitrate: 16000 }, "enhance", 12500)?.intent).toMatchObject({ processingParameters: { fps: 60, bitrate: 16000 }, options: { fpsBand: "le60" } });
    expect(videoProcessingFields(config, encodeChannelModel("upscale", "upscale"), "upscale")).toEqual({});
    expect(() => validateProcessingParameters("upscale", { fps: 60 })).toThrow();
    expect(() => validateProcessingParameters("enhance", { bitrate: 0 })).toThrow();
    expect(() => validateProcessingParameters("enhance", { bitrateLevel: "other" })).toThrow();
});

test("所有注册操作的任务规格能保存、读取并用于 Agent 审批", () => {
    for (const tool of videoProcessingTools) {
        const model = encodeChannelModel("upscale", "upscale");
        const params = { model, ...(tool.operation === "enhance" ? { resolution: "1080p", fps: 60, bitrateLevel: "medium" } : {}) };
        const input = videoProcessingTaskInput({
            config,
            params,
            operation: tool.operation,
            source: { id: "source", name: "source.mp4", type: "video/mp4", storageKey: "resource:source", durationMs: 12500 },
            sourceNodeId: "source",
            projectId: "canvas",
            nodeId: "result",
        });
        const spec = validateGenerationSpec(JSON.parse(JSON.stringify(input.metadata.generationSpec)));
        expect(spec.operation).toBe(tool.operation);
        expect(spec.referenceBindings[0]?.nodeId).toBe("source");
        expect(readNodeGenerationSpec({ type: CanvasNodeType.Video, metadata: generationSpecMetadata(spec) })).toEqual(spec);
        const approval = agentVideoApproval({
            toolName: "generate_media",
            arguments: { mode: "video", operation: tool.operation, prompt: tool.label, processingParameters: spec.processingParameters, quality: spec.options.resolution, referenceNodeIds: ["source"] },
        });
        expect(approval?.operation).toBe(tool.operation);
        expect(agentMediaSettings(approval!).processingParameters).toEqual(spec.processingParameters);
    }
    expect(() =>
        validateGenerationSpec({
            ...videoProcessingTaskInput({ config, params: { model: encodeChannelModel("upscale", "upscale") }, operation: "upscale", source: { id: "s", name: "s", type: "video/mp4" }, sourceNodeId: "s", projectId: "c", nodeId: "n" }).metadata
                .generationSpec,
            operation: "unknown",
        }),
    ).toThrow();
});

test("恢复审批按处理参数值核对，不因字段序列化顺序误判", () => {
    const args = { mode: "video", prompt: "增强", operation: "enhance", quality: "1080p", processingParameters: { fps: 60, bitrate: 1000 } };
    const settings = { size: "", quality: "1080p", processingParameters: { bitrate: 1000, fps: 60 } };
    expect(agentApprovalMatchesSettings(args, settings)).toBe(true);
    expect(agentApprovalMatchesSettings(args, { ...settings, processingParameters: { bitrate: 1000, fps: 30 } })).toBe(false);
});
