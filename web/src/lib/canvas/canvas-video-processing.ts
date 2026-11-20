import { decodeChannelModel, modelOptionName, modelOptionsFromChannels, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";

export type VideoProcessingOperation = "enhance" | "depth";

/** 处理工具各自只选择对应 operation 的系统模型，避免与普通生成或其他处理工具混用。 */
export function listVideoProcessingModels(config: AiConfig, operation: VideoProcessingOperation): string[] {
    return modelOptionsFromChannels(config.channels).filter((model) => {
        const decoded = decodeChannelModel(model);
        const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : undefined;
        if (!channel || channel.scope !== "system" || channel.enabled === false) return false;
        const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
        const video = cost?.capabilityConfig?.video;
        return cost?.capability === "video" && Boolean(video?.processing) && video?.defaultOperation === operation;
    });
}

export function videoProcessingSourceReference(node: CanvasNodeData): ReferenceVideo {
    const metadata = node.metadata || {};
    return {
        id: node.id,
        name: `${node.title || "video"}.mp4`,
        type: metadata.mimeType || "video/mp4",
        url: metadata.content || "",
        storageKey: metadata.storageKey,
        role: "reference",
        ...(metadata.bytes ? { bytes: metadata.bytes } : {}),
        ...(metadata.naturalWidth ? { width: metadata.naturalWidth } : {}),
        ...(metadata.naturalHeight ? { height: metadata.naturalHeight } : {}),
        ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
    };
}
