import type { AgentMediaSettings } from "@/services/api/agent";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import type { CanvasNodeData } from "@/types/canvas";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export type AgentImageApproval = AgentMediaSettings & { prompt: string; referenceNodeIds: string[] };

export function agentImageApproval(detail: Record<string, unknown>): AgentImageApproval | null {
    const call = detail.call as { function?: { name?: string; arguments?: unknown } } | undefined;
    if ((call?.function?.name || detail.toolName) !== "generate_media") return null;
    const raw = call?.function?.arguments ?? detail.arguments;
    try {
        const args = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!args || args.mode !== "image" || typeof args.size !== "string" || typeof args.prompt !== "string") return null;
        return {
            logicalModelId: typeof args.logicalModelId === "string" ? args.logicalModelId : "",
            channelId: typeof args.channelId === "string" ? args.channelId : "",
            channelModelKey: typeof args.channelModelKey === "string" ? args.channelModelKey : "",
            size: args.size,
            quality: typeof args.quality === "string" ? args.quality : "",
            prompt: args.prompt,
            referenceNodeIds: Array.isArray(args.referenceNodeIds) ? args.referenceNodeIds.filter((id: unknown): id is string => typeof id === "string") : [],
        };
    } catch {
        return null;
    }
}

export function agentApprovalModel(config: AiConfig, settings: AgentMediaSettings): string {
    return selectableModelsByCapability(config, "image").find((model) => {
        if (settings.logicalModelId) return logicalModelIDForConfig({ ...config, model }) === settings.logicalModelId;
        return resolveModelChannel(config, model).id === settings.channelId && modelOptionName(model) === settings.channelModelKey;
    }) || "";
}

export function agentApprovalMatchesSettings(argumentsValue: unknown, settings: AgentMediaSettings): boolean {
    const approved = agentImageApproval({ toolName: "generate_media", arguments: argumentsValue });
    return Boolean(approved && (["logicalModelId", "channelId", "channelModelKey", "size", "quality"] as const).every((key) => (approved[key] || "") === (settings[key] || "")));
}

export function agentApprovalModelSelection(config: AiConfig, model: string): Pick<AgentMediaSettings, "logicalModelId" | "channelId" | "channelModelKey"> {
    const logicalModelId = logicalModelIDForConfig({ ...config, model });
    if (logicalModelId) return { logicalModelId };
    const channel = resolveModelChannel(config, model);
    if (channel.scope !== "system") throw new Error("Agent 生成仅支持平台模型");
    return { channelId: channel.id, channelModelKey: modelOptionName(model) };
}

/** 后端在用户直接从节点提交生成时写入的审批决定（与 Go 侧 cloudAgentApprovalSuperseded 一致）。 */
export const AGENT_APPROVAL_SUPERSEDED_BY_NODE = "superseded_by_node";

/** 待审批 generate_media 的目标节点；其他工具返回空串。 */
export function agentMediaApprovalTargetNodeId(detail: Record<string, unknown>): string {
    const call = detail.call as { function?: { name?: string; arguments?: unknown } } | undefined;
    if ((call?.function?.name || detail.toolName) !== "generate_media") return "";
    const raw = call?.function?.arguments ?? detail.arguments;
    try {
        const args = typeof raw === "string" ? JSON.parse(raw) : raw;
        return args && typeof args.nodeId === "string" ? args.nodeId.trim() : "";
    } catch {
        return "";
    }
}

/**
 * 审批的目标节点已经在画布上生成中（用户直接点了节点的生成）。
 * 后端会随后推送 superseded 决定；这里只负责在事件到达前挡住重复点击“同意执行”。
 */
export function agentApprovalTargetGenerating(detail: Record<string, unknown>, nodes: readonly CanvasNodeData[] | undefined, runningNodeId?: string | null): CanvasNodeData | undefined {
    const nodeId = agentMediaApprovalTargetNodeId(detail);
    if (!nodeId || !nodes) return undefined;
    const target = nodes.find((node) => node.id === nodeId);
    return target && isCanvasNodeGenerating(target, runningNodeId) ? target : undefined;
}
