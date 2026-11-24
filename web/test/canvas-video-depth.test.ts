import { expect, test } from "bun:test";
import { listVideoProcessingModels, videoProcessingSourceReference } from "@/lib/canvas/canvas-video-processing";
import { videoDepthQuoteRequest, videoDepthSourceError, videoDepthTaskInput } from "@/lib/canvas/canvas-video-depth";
import { defaultModelCapabilityConfig, VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL } from "@/lib/model-capabilities";
import { createModelChannel, defaultConfig, encodeChannelModel, type AiConfig } from "@/stores/use-config-store";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { buildPricingTemplate, pricingDimensions, priceSelectorIssues } from "@/pages/admin/components/channel-model-templates";
import { defaultPriceTier } from "@/pages/admin/components/channel-model-price-tier-form";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function channel(id: string, protocol: string, scope: "system" | "user" = "system") {
    return createModelChannel({ id, scope, models: [id], modelCosts: [{ model: id, protocol, capability: "video", billingMode: "per_second", unitPriceMicrocredits: 10, capabilityConfig: defaultModelCapabilityConfig(protocol, id) }] });
}

const config: AiConfig = {
    ...defaultConfig,
    channels: [channel("depth", VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL), channel("enhance", VOLCENGINE_MEDIAKIT_ENHANCE_VIDEO_PROTOCOL), channel("ordinary", "openai-video"), channel("custom", VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, "user")],
};
const model = encodeChannelModel("depth", "depth");
const source: CanvasNodeData = {
    id: "source",
    type: CanvasNodeType.Video,
    title: "舞蹈参考",
    position: { x: 0, y: 0 },
    width: 720,
    height: 405,
    metadata: { storageKey: "resource:source", content: "/source.mp4", mimeType: "video/mp4", naturalWidth: 2560, naturalHeight: 1440, durationMs: 300_500 },
};

test("processing model lists isolate depth, enhance, generation and custom channels", () => {
    expect(listVideoProcessingModels(config, "depth")).toEqual([model]);
    expect(listVideoProcessingModels(config, "enhance")).toEqual([encodeChannelModel("enhance", "enhance")]);
    expect(listVideoProcessingModels({ ...config, channels: config.channels.map((item) => ({ ...item, enabled: false })) }, "depth")).toEqual([]);
    expect(config.channels[0]!.modelCosts![0]!.capabilityConfig?.video?.processing?.maxSourceSeconds).toBe(600);
});

test("depth accepts longer 2K sources without enhancement settings and rejects excessive duration", () => {
    expect(videoDepthSourceError(source, 600)).toBe("");
    expect(videoDepthSourceError({ ...source, metadata: { ...source.metadata, durationMs: 600_001 } }, 600)).toContain("600 秒");
    expect(videoDepthSourceError({ ...source, metadata: {} }, 600)).toContain("为空");
});

test("depth uses the real task builder with one source, independent operation and no output specification", async () => {
    const input = videoDepthTaskInput({
        config: { ...config, vquality: "4k", size: "1:1", taskWorkflowProvider: "runninghub" },
        params: { model },
        source: videoProcessingSourceReference(source),
        sourceNodeId: source.id,
        projectId: "canvas",
        nodeId: "result",
    });
    const task = await prepareBackendGenerationTask(input);
    expect(task.operation).toBe("depth");
    expect(task.type).toBe("canvas_video");
    expect(task.input.config).toMatchObject({ channelId: "depth", model: "depth", videoSeconds: "301" });
    for (const name of ["vquality", "size", "videoGenerateAudio", "videoWatermark"]) expect(task.input.config?.[name]).toBeUndefined();
    expect(task.input.referenceVideos).toMatchObject([{ storageKey: "resource:source", durationMs: 300_500 }]);
    expect(task.input.metadata).toMatchObject({ sourceNodeId: "source", videoEditOperation: "depth" });
});

test("quote uses source duration and the depth operation without enhancement billing dimensions", () => {
    expect(videoDepthQuoteRequest(config, { model }, 300_500)).toMatchObject({ channelId: "depth", modelKey: "depth", intent: { operation: "depth", inputs: { video: 1 }, options: { videoSeconds: 301 } } });
    expect(videoDepthQuoteRequest(config, { model }, undefined)).toBeUndefined();
    expect(videoDepthQuoteRequest(config, { model: encodeChannelModel("custom", "custom") }, 1000)).toBeUndefined();
});

test("admin pricing templates keep depth independent and reject enhancement dimensions", () => {
    const context = { capability: "video" as const, protocol: VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, capabilityConfig: defaultModelCapabilityConfig(VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL) };
    expect(pricingDimensions(context)).toEqual([{ id: "operation", label: "生成方式", values: ["depth"], field: "operation", imageParameter: false }]);
    const tiers = buildPricingTemplate("seconds", ["operation"], context);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ operation: "depth", billingMode: "per_second", priceConfigured: false, enabled: false });
    expect(priceSelectorIssues({ ...context, priceTiers: tiers })).toEqual([]);
    expect(priceSelectorIssues({ ...context, priceTiers: [{ ...defaultPriceTier("advanced"), operation: "depth", fpsBand: "le30" }] }).join()).toContain("fpsBand");
});
