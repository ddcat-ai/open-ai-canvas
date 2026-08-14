import { maxModelInputCapacity, type ModelInputSummary } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";

type ConnectionCandidate = Pick<CanvasConnection, "fromNodeId" | "toNodeId">;

export function canvasConnectionError(config: AiConfig, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate: ConnectionCandidate) {
    const target = nodes.find((node) => node.id === candidate.toNodeId);
    if (!target) return "找不到连线目标节点";
    const mode = nodeGenerationMode(target);
    if (!mode) return "";
    const input = connectionInputSummary(target.id, nodes, connections, candidate);
    const visualInputCount = input.imageCount + input.characterCount;

    if (mode === "image") {
        if (input.videoCount > 0) return "图片生成节点不能连接参考视频";
        if (input.audioCount > 0) return "图片生成节点不能连接参考音频";
        return capacityError(config, mode, "image", visualInputCount, "参考图");
    }
    if (mode === "video") {
        return capacityError(config, mode, "image", visualInputCount, "参考图") || capacityError(config, mode, "video", input.videoCount, "参考视频") || capacityError(config, mode, "audio", input.audioCount, "参考音频");
    }
    if (mode === "text" && input.audioCount > 0) return "文本生成节点不能连接参考音频";
    if (mode === "audio" && input.characterCount > 1) return "角色配音一次只能连接一个角色卡";
    if (mode === "audio" && (input.imageCount > 0 || input.videoCount > 0 || input.audioCount > 0)) return "音频生成节点只接受文本或单个角色卡输入";
    return "";
}

export function connectionInputSummary(targetNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate?: ConnectionCandidate): ModelInputSummary {
    const sourceIds = new Set([...connections, ...(candidate ? [{ id: "candidate", ...candidate }] : [])].filter((connection) => connection.toNodeId === targetNodeId).map((connection) => connection.fromNodeId));
    const input: ModelInputSummary = { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 };
    sourceIds.forEach((sourceId) => {
        const source = nodes.find((node) => node.id === sourceId);
        if (!source || source.type === CanvasNodeType.Config || source.type === CanvasNodeType.Frame) return;
        if (source.metadata?.workflowKind === "character") input.characterCount += 1;
        else if (source.type === CanvasNodeType.Image || source.type === CanvasNodeType.Drawing) input.imageCount += 1;
        else if (source.type === CanvasNodeType.Video) input.videoCount += 1;
        else if (source.type === CanvasNodeType.Audio) input.audioCount += 1;
        else input.textCount += 1;
    });
    return input;
}

function nodeGenerationMode(node: CanvasNodeData): CanvasGenerationMode | null {
    if (node.type === CanvasNodeType.Config) return node.metadata?.generationMode || "image";
    if (node.type === CanvasNodeType.Image) return "image";
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script) return "text";
    return null;
}

function capacityError(config: AiConfig, capability: "image" | "video", kind: "image" | "video" | "audio", count: number, label: string) {
    const maximum = maxModelInputCapacity(config, capability, kind);
    if (maximum === null || count <= maximum) return "";
    const unit = kind === "image" ? "张" : "个";
    return maximum > 0 ? `已配置模型最多支持 ${maximum} ${unit}${label}` : `已配置模型均不支持${label}`;
}
