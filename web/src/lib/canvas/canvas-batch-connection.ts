import { nanoid } from "nanoid";

import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import { normalizeConnection } from "@/lib/canvas/canvas-project-domain";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type Position } from "@/types/canvas";

export type CanvasBatchConnectionPreview = {
    sourceNodeIds: string[];
    targetNodeId: string | null;
    targetHandleId?: string;
    targetAnchorRatio?: number;
    mouseWorld: Position;
    status: "idle" | "valid" | "partial" | "invalid";
};

export type BatchConnectionPlanOptions = {
    sourceNodeIds: string[];
    targetNodeId: string;
    targetHandleId?: string;
    targetAnchorRatio?: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    config: AiConfig;
    // 创建聚合节点时保留完整图结构；生成提交阶段再按模型能力截取参考素材。
    allowCapacityOverflow?: boolean;
};

export type BatchConnectionSkip = {
    nodeId: string;
    reason: string;
};

export type BatchConnectionPlan = {
    connected: string[];
    duplicates: string[];
    skipped: BatchConnectionSkip[];
    connections: CanvasConnection[];
};

export type BatchConnectionCreateRequest = {
    batchSourceNodeIds: string[];
    connection: ConnectionHandle;
    position: Position;
};

export function buildBatchConnectionCreateRequest(sourceNodeIds: string[], nodes: CanvasNodeData[], position: Position): BatchConnectionCreateRequest | null {
    const eligibleSourceNodeIds = Array.from(new Set(sourceNodeIds)).filter((nodeId) => {
        const node = nodes.find((item) => item.id === nodeId);
        return Boolean(node && !batchSourceRestriction(node));
    });
    const firstSourceNodeId = eligibleSourceNodeIds[0];
    if (!firstSourceNodeId) return null;
    return {
        batchSourceNodeIds: eligibleSourceNodeIds,
        connection: { nodeId: firstSourceNodeId, handleType: "source" },
        position,
    };
}

export function hasBatchConnectionCandidate(sourceNodeIds: string[], targetNodeId: string, nodes: CanvasNodeData[]) {
    return sourceNodeIds.some((sourceNodeId) => {
        const source = nodes.find((node) => node.id === sourceNodeId);
        return Boolean(source && !batchSourceRestriction(source) && normalizeConnection(source.id, targetNodeId, nodes, "source"));
    });
}

export function planBatchConnections({ sourceNodeIds, targetNodeId, targetHandleId, targetAnchorRatio, nodes, connections, config, allowCapacityOverflow = false }: BatchConnectionPlanOptions): BatchConnectionPlan {
    const connected: string[] = [];
    const duplicates: string[] = [];
    const skipped: BatchConnectionSkip[] = [];
    const nextConnections: CanvasConnection[] = [];
    const workingConnections = [...connections];
    const seenSourceIds = new Set<string>();

    sourceNodeIds.forEach((sourceNodeId) => {
        if (seenSourceIds.has(sourceNodeId)) return;
        seenSourceIds.add(sourceNodeId);

        const source = nodes.find((node) => node.id === sourceNodeId);
        if (!source) {
            skipped.push({ nodeId: sourceNodeId, reason: "找不到连接源节点" });
            return;
        }
        const sourceRestriction = batchSourceRestriction(source);
        if (sourceRestriction) {
            skipped.push({ nodeId: source.id, reason: sourceRestriction });
            return;
        }
        if (source.id === targetNodeId) {
            skipped.push({ nodeId: source.id, reason: "目标节点不能连接到自身" });
            return;
        }

        const normalized = normalizeConnection(source.id, targetNodeId, nodes, "source");
        if (!normalized) {
            skipped.push({ nodeId: source.id, reason: "节点之间不能连接" });
            return;
        }

        const fromHandleId = normalized.fromNodeId === source.id ? undefined : targetHandleId;
        const toHandleId = normalized.toNodeId === targetNodeId ? targetHandleId : undefined;
        const duplicate = workingConnections.some((connection) => connection.fromNodeId === normalized.fromNodeId
            && connection.toNodeId === normalized.toNodeId
            && connection.fromHandleId === fromHandleId
            && connection.toHandleId === toHandleId);
        if (duplicate) {
            duplicates.push(source.id);
            return;
        }

        const policyError = canvasConnectionError(config, nodes, workingConnections, normalized, { ignoreCapacity: allowCapacityOverflow });
        if (policyError) {
            skipped.push({ nodeId: source.id, reason: policyError });
            return;
        }

        const connection: CanvasConnection = {
            id: nanoid(),
            ...normalized,
            fromHandleId,
            toHandleId,
            fromAnchorRatio: normalized.fromNodeId === source.id ? 0.5 : targetAnchorRatio,
            toAnchorRatio: normalized.toNodeId === targetNodeId ? targetAnchorRatio : 0.5,
        };
        workingConnections.push(connection);
        nextConnections.push(connection);
        connected.push(source.id);
    });

    return { connected, duplicates, skipped, connections: nextConnections };
}

export function batchSourceRestriction(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Frame) return "背板不能作为连接源";
    if (node.type === CanvasNodeType.Script) return "分镜脚本需要按行连接";
    if (node.type === CanvasNodeType.Config) return "生成配置不能作为聚合连接源";
    return "";
}
