import { maxModelInputCapacity, type ModelInputSummary } from "@/lib/model-selection";
import { getNodeGenerationMode, getNodeInputKind } from "@/lib/canvas/node-registry";
import type { AiConfig } from "@/stores/use-config-store";
import { type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type ConnectionCandidate = Pick<CanvasConnection, "fromNodeId" | "toNodeId">;
type CanvasConnectionPolicyOptions = {
    // 仅跳过参考素材数量上限，媒体类型不兼容仍然拒绝。
    ignoreCapacity?: boolean;
};

export function canvasConnectionError(config: AiConfig, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate: ConnectionCandidate, options: CanvasConnectionPolicyOptions = {}) {
    const target = nodes.find((node) => node.id === candidate.toNodeId);
    if (!target) return "找不到连线目标节点";
    const mode = getNodeGenerationMode(target);
    if (!mode) return "";
    const input = connectionInputSummary(target.id, nodes, connections, candidate);
    const visualInputCount = input.imageCount + input.characterCount;

    if (mode === "image") {
        if (input.videoCount > 0) return "图片生成节点不能连接参考视频";
        if (input.audioCount > 0) return "图片生成节点不能连接参考音频";
        return options.ignoreCapacity ? "" : capacityError(config, mode, "image", visualInputCount, "参考图");
    }
    if (mode === "video") {
        return options.ignoreCapacity ? "" : capacityError(config, mode, "image", visualInputCount, "参考图") || capacityError(config, mode, "video", input.videoCount, "参考视频") || capacityError(config, mode, "audio", input.audioCount, "参考音频");
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
        if (!source) return;
        // 生成配置与背板不是参考素材，不参与容量计数——这一步必须早于角色卡判定，
        // 否则一个带角色元数据的配置/背板节点会被多算成角色。
        const inputKind = getNodeInputKind(source.type);
        if (!inputKind) return;
        // 角色卡是跨类型覆盖：落在可计数类型上时改记为角色。
        if (source.metadata?.workflowKind === "character") input.characterCount += 1;
        else input[`${inputKind}Count`] += 1;
    });
    return input;
}

function capacityError(config: AiConfig, capability: "image" | "video", kind: "image" | "video" | "audio", count: number, label: string) {
    const maximum = maxModelInputCapacity(config, capability, kind);
    if (maximum === null || count <= maximum) return "";
    const unit = kind === "image" ? "张" : "个";
    return maximum > 0 ? `已配置模型最多支持 ${maximum} ${unit}${label}` : `已配置模型均不支持${label}`;
}
