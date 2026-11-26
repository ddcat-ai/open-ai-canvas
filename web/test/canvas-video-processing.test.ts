import { expect, test } from "bun:test";
import { listVideoProcessingModels, videoProcessingTaskInput, videoProcessingQuoteRequest, videoProcessingSourceError } from "@/lib/canvas/canvas-video-processing";
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
