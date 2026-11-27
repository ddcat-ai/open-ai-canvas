import type { AgentMediaSettings } from "@/services/api/agent";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import type { CanvasNodeData } from "@/types/canvas";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { mediaToolForOperation, validateProcessingParameters, type MediaToolOperation } from "./media-tool-contract";

export type AgentImageApproval = AgentMediaSettings & { prompt: string; referenceNodeIds: string[] };
export type AgentVideoApproval = AgentImageApproval & { referenceTransientIds: string[]; sourceNodeId: string; operation?: MediaToolOperation };

/** 来源选择必须来自服务端审批，空 nodeId 是独立创作选项，不是省略。 */
export function agentMediaSourceChoices(detail: Record<string, unknown>): { nodeId: string; label: string }[] {
    if (!Array.isArray(detail.sourceChoices)) return [];
    return detail.sourceChoices.filter((choice): choice is { nodeId: string; label: string } => Boolean(choice) && typeof choice === "object" && typeof choice.nodeId === "string" && typeof choice.label === "string" && choice.label.length > 0);
}

/**
 * 审批详情里只有这些字段属于后端 mediaSettings；prompt 与引用节点由服务端持有。
 * 展开完整审批对象会把 prompt 回传，被后端 DisallowUnknownFields 拒绝（json: unknown field "prompt"），
 * 表现为“审批未确认，请重试”，所以回传前先窄化。
 */
export function agentMediaSettings(value: AgentMediaSettings): AgentMediaSettings {
    return {
        logicalModelId: value.logicalModelId,
        channelId: value.channelId,
        channelModelKey: value.channelModelKey,
        size: value.size,
        imageResolution: value.imageResolution,
        imageParameters: value.imageParameters,
        quality: value.quality,
        durationSeconds: value.durationSeconds,
        videoGenerateAudio: value.videoGenerateAudio,
        videoWatermark: value.videoWatermark,
        videoArkPrivateAssetUpload: value.videoArkPrivateAssetUpload,
        ...(value.processingParameters ? { processingParameters: value.processingParameters } : {}),
    };
}

function mediaApprovalArguments(detail: Record<string, unknown>): Record<string, unknown> | null {
    const call = detail.call as { function?: { name?: string; arguments?: unknown } } | undefined;
    const toolName = call?.function?.name || detail.toolName;
    if (toolName !== "generate_media" && toolName !== "generate_media_batch") return null;
    const raw = call?.function?.arguments ?? detail.arguments;
    try {
        const args = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!args || typeof args !== "object" || Array.isArray(args)) return null;
        if (toolName === "generate_media_batch") {
            if (!Array.isArray(args.items) || !args.items.length) return null;
            return { ...args, prompt: "", size: typeof args.size === "string" ? args.size : "" };
        }
        return args;
    } catch {
        return null;
    }
}

export function agentVideoApproval(detail: Record<string, unknown>): AgentVideoApproval | null {
    try {
        const args = mediaApprovalArguments(detail);
        if (!args || args.mode !== "video" || typeof args.prompt !== "string") return null;
        return {
            logicalModelId: typeof args.logicalModelId === "string" ? args.logicalModelId : "",
            channelId: typeof args.channelId === "string" ? args.channelId : "",
            channelModelKey: typeof args.channelModelKey === "string" ? args.channelModelKey : "",
            size: typeof args.size === "string" ? args.size : "",
            quality: typeof args.quality === "string" ? args.quality : "",
            durationSeconds: typeof args.durationSeconds === "number" && args.durationSeconds > 0 ? args.durationSeconds : undefined,
            videoGenerateAudio: typeof args.videoGenerateAudio === "boolean" ? args.videoGenerateAudio : undefined,
            videoWatermark: typeof args.videoWatermark === "boolean" ? args.videoWatermark : undefined,
            videoArkPrivateAssetUpload: typeof args.videoArkPrivateAssetUpload === "boolean" ? args.videoArkPrivateAssetUpload : undefined,
            prompt: args.prompt,
            referenceNodeIds: Array.isArray(args.referenceNodeIds) ? args.referenceNodeIds.filter((id: unknown): id is string => typeof id === "string") : [],
            referenceTransientIds: Array.isArray(args.referenceTransientIds) ? args.referenceTransientIds.filter((id: unknown): id is string => typeof id === "string") : [],
            sourceNodeId: typeof args.sourceNodeId === "string" ? args.sourceNodeId : "",
            ...(mediaToolForOperation(args.operation) ? { operation: args.operation as MediaToolOperation, processingParameters: validateProcessingParameters(args.operation, args.processingParameters || {}) } : {}),
        };
    } catch {
        return null;
    }
}

export function agentImageApproval(detail: Record<string, unknown>): AgentImageApproval | null {
    try {
        const args = mediaApprovalArguments(detail);
        if (!args || args.mode !== "image" || typeof args.size !== "string" || typeof args.prompt !== "string") return null;
        return {
            logicalModelId: typeof args.logicalModelId === "string" ? args.logicalModelId : "",
            channelId: typeof args.channelId === "string" ? args.channelId : "",
            channelModelKey: typeof args.channelModelKey === "string" ? args.channelModelKey : "",
            size: args.size,
            ...(typeof args.imageResolution === "string" ? { imageResolution: args.imageResolution } : {}),
            ...(typeof args.imageParameters === "string" ? { imageParameters: args.imageParameters } : {}),
            quality: typeof args.quality === "string" ? args.quality : "",
            prompt: args.prompt,
            referenceNodeIds: Array.isArray(args.referenceNodeIds) ? args.referenceNodeIds.filter((id: unknown): id is string => typeof id === "string") : [],
        };
    } catch {
        return null;
    }
}

export function agentApprovalModel(config: AiConfig, settings: AgentMediaSettings, capability: "image" | "video" = "image"): string {
    return (
        selectableModelsByCapability(config, capability).find((model) => {
            if (settings.logicalModelId) return logicalModelIDForConfig({ ...config, model }) === settings.logicalModelId;
            return resolveModelChannel(config, model).id === settings.channelId && modelOptionName(model) === settings.channelModelKey;
        }) || ""
    );
}

export function agentApprovalMatchesSettings(argumentsValue: unknown, settings: AgentMediaSettings): boolean {
    let args: unknown;
    try {
        args = typeof argumentsValue === "string" ? JSON.parse(argumentsValue) : argumentsValue;
    } catch {
        return false;
    }
    const batch = args && typeof args === "object" && "items" in args;
    const detail = { toolName: batch ? "generate_media_batch" : "generate_media", arguments: args };
    const approved = agentImageApproval(detail) || agentVideoApproval(detail);
    if (!approved) return false;
    const approvedParameters = (approved.processingParameters || {}) as Record<string, unknown>;
    const editedParameters = (settings.processingParameters || {}) as Record<string, unknown>;
    const processingKeys = new Set([...Object.keys(approvedParameters), ...Object.keys(editedParameters)]);
    return (
        [...processingKeys].every((key) => approvedParameters[key] === editedParameters[key]) &&
        (["logicalModelId", "channelId", "channelModelKey", "size", "quality", "durationSeconds", "videoGenerateAudio", "videoWatermark", "videoArkPrivateAssetUpload"] as const).every((key) => {
            const left = approved[key];
            const right = settings[key];
            return (left === undefined ? "" : left) === (right === undefined ? "" : right);
        })
    );
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
