import { nanoid } from "nanoid";

import { getNodeSpec } from "@/constant/canvas";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeType; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeType }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string; fromHandleId?: string; toHandleId?: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string; retry?: boolean };

export type CanvasAgentSnapshot = {
    projectId: string;
    domainProjectId?: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
    revision?: number;
    stateHash?: string;
};

export type CanvasAgentOperationImpact = {
    operationCount: number;
    affectedNodeCount: number;
    destructiveCount: number;
    generationCount: number;
    items: string[];
    warning: string;
};

export type CanvasAgentGenerationVerification = {
    nodeId: string;
    taskId?: string;
    taskStatus?: string;
    officialStatus?: string;
    outcome: "not_started" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
    resourceReady: boolean;
    message: string;
};

export type CanvasAgentPostcondition = {
    ok: boolean;
    changed: boolean;
    ranGeneration: boolean;
    createdNodeIds: string[];
    createdConnectionIds: string[];
    connectionCount: number;
    expectedConnectionCount: number;
    removedNodeIds: string[];
    affectedNodeIds: string[];
    missingNodeIds: string[];
    missingConnectionIds: string[];
    generation: CanvasAgentGenerationVerification[];
    warnings: string[];
    overlapWarnings: string[];
    beforeStateHash: string;
    afterStateHash: string;
    hashSource: "browser-local";
};

/**
 * Verify the observable postcondition after a batch has been applied.
 *
 * This is intentionally separate from validation: validation answers whether
 * an operation is safe to attempt, while this function answers whether the
 * browser actually produced the state the Agent asked for. Generation is
 * reported as submitted/running/succeeded rather than being collapsed into
 * a misleading boolean "completed".
 */
export function verifyCanvasAgentOps(before: CanvasAgentSnapshot, after: CanvasAgentSnapshot, ops: CanvasAgentOp[]): CanvasAgentPostcondition {
    const beforeNodeIds = new Set(before.nodes.map((node) => node.id));
    const afterNodeIds = new Set(after.nodes.map((node) => node.id));
    const beforeConnectionIds = new Set(before.connections.map((connection) => connection.id));
    const afterConnectionIds = new Set(after.connections.map((connection) => connection.id));
    const createdNodeIds = after.nodes.filter((node) => !beforeNodeIds.has(node.id)).map((node) => node.id);
    const createdConnectionIds = after.connections.filter((connection) => !beforeConnectionIds.has(connection.id)).map((connection) => connection.id);
    const expectedConnectionCount = ops.filter((op) => op.type === "connect_nodes").length;
    const removedNodeIds = before.nodes.filter((node) => !afterNodeIds.has(node.id)).map((node) => node.id);
    const affectedNodeIds = new Set<string>();
    const missingNodeIds = new Set<string>();
    const missingConnectionIds = new Set<string>();
    const failedPostconditions = new Set<string>();
    const warnings: string[] = [];
    const overlapWarnings = findCanvasNodeOverlaps(after.nodes, createdNodeIds);
    if (overlapWarnings.length) warnings.push(...overlapWarnings);
    const generation: CanvasAgentGenerationVerification[] = [];
    const addNodeCount = ops.filter((op) => op.type === "add_node").length;
    if (createdNodeIds.length < addNodeCount) {
        failedPostconditions.add("add_node:count");
        warnings.push(`预期新增 ${addNodeCount} 个节点，最终只观察到 ${createdNodeIds.length} 个`);
    }

    const requireAfterNode = (nodeId: string) => {
        affectedNodeIds.add(nodeId);
        if (!afterNodeIds.has(nodeId)) missingNodeIds.add(nodeId);
    };
    const connectionExists = (op: Extract<CanvasAgentOp, { type: "connect_nodes" }>) => after.connections.some((connection) => connection.fromNodeId === op.fromNodeId
        && connection.toNodeId === op.toNodeId
        && connection.fromHandleId === op.fromHandleId
        && connection.toHandleId === op.toHandleId);

    for (const op of ops) {
        if (op.type === "add_node") {
            if (op.id && !afterNodeIds.has(op.id)) missingNodeIds.add(op.id);
            continue;
        }
        if (op.type === "update_node") {
            requireAfterNode(op.id);
            const beforeNode = before.nodes.find((node) => node.id === op.id);
            const afterNode = after.nodes.find((node) => node.id === op.id);
            if (beforeNode && afterNode && op.patch) {
                const patch = op.patch as Record<string, unknown>;
                for (const key of ["title", "x", "y", "width", "height", "position", "parentId"]) {
                    if (!(key in patch) || JSON.stringify(afterNode[key as keyof typeof afterNode]) === JSON.stringify(patch[key])) continue;
                    failedPostconditions.add(`${op.id}:${key}`);
                    warnings.push(`节点「${afterNode.title || op.id}」的 ${key} 未达到预期`);
                }
                if ((patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata)) || op.metadata) {
                    const expectedMetadata = { ...beforeNode.metadata, ...(patch.metadata as Record<string, unknown> || {}), ...(op.metadata || {}) };
                    if (JSON.stringify(afterNode.metadata || {}) !== JSON.stringify(expectedMetadata)) {
                        failedPostconditions.add(`${op.id}:metadata`);
                        warnings.push(`节点「${afterNode.title || op.id}」的 metadata 未达到预期`);
                    }
                }
            }
            continue;
        }
        if (op.type === "delete_node") {
            const ids = op.ids || (op.id ? [op.id] : op.nodeType ? before.nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
            ids.forEach((id) => {
                affectedNodeIds.add(id);
                if (afterNodeIds.has(id)) missingNodeIds.add(id);
            });
            continue;
        }
        if (op.type === "delete_connections") {
            const ids = op.all ? before.connections.map((connection) => connection.id) : op.ids || (op.id ? [op.id] : []);
            ids.forEach((id) => {
                if (afterConnectionIds.has(id)) missingConnectionIds.add(id);
            });
            continue;
        }
        if (op.type === "connect_nodes") {
            affectedNodeIds.add(op.fromNodeId);
            affectedNodeIds.add(op.toNodeId);
            if (!connectionExists(op)) missingConnectionIds.add(op.id || `${op.fromNodeId}->${op.toNodeId}`);
            continue;
        }
        if (op.type === "select_nodes") {
            op.ids.forEach((id) => {
                affectedNodeIds.add(id);
                if (afterNodeIds.has(id) && !after.selectedNodeIds.includes(id)) warnings.push(`节点「${id}」未出现在最终选区`);
            });
            continue;
        }
        if (op.type === "run_generation") {
            requireAfterNode(op.nodeId);
            const node = after.nodes.find((item) => item.id === op.nodeId);
            const metadata = node?.metadata || {};
            const taskId = typeof metadata.taskId === "string" && metadata.taskId ? metadata.taskId : undefined;
            const taskStatus = typeof metadata.taskStatus === "string" ? metadata.taskStatus : undefined;
            const officialStatus = typeof metadata.taskOfficialStatus === "string" ? metadata.taskOfficialStatus : undefined;
            const resourceReady = metadata.status === "success" && Boolean(metadata.storageKey || metadata.primaryImageId || (metadata as Record<string, unknown>).resourceId);
            const outcome = generationOutcome(taskStatus, officialStatus, taskId);
            const message = generationVerificationMessage(outcome, resourceReady);
            generation.push({ nodeId: op.nodeId, ...(taskId ? { taskId } : {}), ...(taskStatus ? { taskStatus } : {}), ...(officialStatus ? { officialStatus } : {}), outcome, resourceReady, message });
            if (outcome === "not_started") warnings.push(`节点「${node?.title || op.nodeId}」没有绑定生成任务，工具没有确认任务已提交`);
            else if (outcome === "failed" || outcome === "cancelled") warnings.push(`节点「${node?.title || op.nodeId}」的生成任务未成功：${message}`);
            else if (outcome === "succeeded" && !resourceReady) warnings.push(`节点「${node?.title || op.nodeId}」的 provider 任务已成功，但资源尚未物化`);
            continue;
        }
    }

    const ranGeneration = generation.length > 0;
    const changed = hashCanvasAgentSnapshot(before) !== hashCanvasAgentSnapshot(after) || ranGeneration;
    const generationFailed = generation.some((item) => item.outcome === "not_started" || item.outcome === "failed" || item.outcome === "cancelled");
    return {
        ok: missingNodeIds.size === 0 && missingConnectionIds.size === 0 && failedPostconditions.size === 0 && !generationFailed && overlapWarnings.length === 0,
        changed,
        ranGeneration,
        createdNodeIds,
        createdConnectionIds,
        connectionCount: after.connections.length,
        expectedConnectionCount,
        removedNodeIds,
        affectedNodeIds: [...affectedNodeIds],
        missingNodeIds: [...missingNodeIds],
        missingConnectionIds: [...missingConnectionIds],
        generation,
        warnings: [...new Set(warnings)],
        overlapWarnings,
        beforeStateHash: hashCanvasAgentSnapshot(before),
        afterStateHash: hashCanvasAgentSnapshot(after),
        hashSource: "browser-local",
    };
}

export function findCanvasNodeOverlaps(nodes: CanvasNodeData[], onlyIds?: string[]) {
    const filter = onlyIds ? new Set(onlyIds) : null;
    const candidates = nodes.filter((node) => !filter || filter.has(node.id));
    const overlaps: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
        for (let next = index + 1; next < candidates.length; next += 1) {
            const left = candidates[index];
            const right = candidates[next];
            if (left.position.x >= right.position.x + right.width || right.position.x >= left.position.x + left.width || left.position.y >= right.position.y + right.height || right.position.y >= left.position.y + left.height) continue;
            overlaps.push(`节点「${left.title || left.id}」与「${right.title || right.id}」发生重叠`);
        }
    }
    return overlaps;
}

export function canvasAgentPostconditionMessage(result: CanvasAgentPostcondition) {
    const nodeSummary = result.createdNodeIds.length ? `已创建 ${result.createdNodeIds.length} 个节点` : result.changed ? "画布已更新" : "画布状态未变化";
    const connectionSummary = result.expectedConnectionCount
        ? `预期 ${result.expectedConnectionCount} 条连线，实际新增 ${result.createdConnectionIds.length} 条（当前共 ${result.connectionCount} 条）`
        : `当前共 ${result.connectionCount} 条连线`;
    if (!result.ok) {
        if (result.generation.some((item) => item.outcome === "failed" || item.outcome === "cancelled")) return result.generation.map((item) => item.message).join("；");
        if (result.generation.some((item) => item.outcome === "not_started")) return "画布写入完成，但生成任务没有成功提交，请检查当前生成执行器。";
        const details = [...result.overlapWarnings, ...result.warnings].filter(Boolean).slice(0, 2).join("；");
        return `${nodeSummary}，但事实复核失败：${details || "目标节点或连线没有达到预期状态"}。${result.expectedConnectionCount ? ` ${connectionSummary}。` : ""}`;
    }
    if (result.generation.some((item) => item.outcome === "queued" || item.outcome === "running")) return `${nodeSummary}，${connectionSummary}；已提交生成任务，当前仍在${result.generation.map((item) => item.message).join("、")}，尚未完成。`;
    if (result.generation.some((item) => item.outcome === "succeeded" && !item.resourceReady)) return `${nodeSummary}，${connectionSummary}；生成任务已成功，但资源尚未物化到画布，当前不能把它当作可复用素材。`;
    if (result.generation.some((item) => item.outcome === "succeeded" && item.resourceReady)) return `${nodeSummary}，${connectionSummary}；生成已完成，且资源已在画布节点上就绪。`;
    return `${nodeSummary}，${connectionSummary}，布局无重叠，已复核最终状态。`;
}

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function previewCanvasAgentOps(ops?: CanvasAgentOp[], snapshot?: CanvasAgentSnapshot): CanvasAgentOperationImpact {
    const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
    const nodeById = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
    const affectedNodeIds = new Set<string>();
    let addedNodeCount = 0;
    let destructiveCount = 0;
    let generationCount = 0;
    const items: string[] = [];

    safeOps.forEach((op) => {
        if (op.type === "add_node") {
            addedNodeCount += 1;
            items.push(`新增${canvasNodeTypeLabel(op.nodeType)}${op.title ? `「${op.title}」` : ""}`);
            return;
        }
        if (op.type === "update_node") {
            affectedNodeIds.add(op.id);
            items.push(`修改「${nodeById.get(op.id)?.title || op.id}」`);
            return;
        }
        if (op.type === "delete_node") {
            const ids = op.ids || (op.id ? [op.id] : op.nodeType ? (snapshot?.nodes || []).filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
            ids.forEach((id) => affectedNodeIds.add(id));
            destructiveCount += Math.max(1, ids.length);
            const names = ids.slice(0, 3).map((id) => nodeById.get(id)?.title || id);
            items.push(ids.length ? `删除 ${ids.length} 个节点${names.length ? `：${names.join("、")}${ids.length > names.length ? "等" : ""}` : ""}` : `删除全部${canvasNodeTypeLabel(op.nodeType)}`);
            return;
        }
        if (op.type === "connect_nodes") {
            affectedNodeIds.add(op.fromNodeId);
            affectedNodeIds.add(op.toNodeId);
            items.push(`连接「${nodeById.get(op.fromNodeId)?.title || op.fromNodeId}」到「${nodeById.get(op.toNodeId)?.title || op.toNodeId}」`);
            return;
        }
        if (op.type === "delete_connections") {
            const count = op.all ? snapshot?.connections.length || 0 : op.ids?.length || (op.id ? 1 : 0);
            destructiveCount += Math.max(1, count);
            items.push(op.all ? `删除全部 ${count} 条连线` : `删除 ${count || 1} 条连线`);
            return;
        }
        if (op.type === "run_generation") {
            affectedNodeIds.add(op.nodeId);
            generationCount += 1;
            items.push(`为「${nodeById.get(op.nodeId)?.title || op.nodeId}」触发${generationModeLabel(op.mode)}生成`);
            return;
        }
        if (op.type === "select_nodes") {
            op.ids.forEach((id) => affectedNodeIds.add(id));
            items.push(`选择 ${op.ids.length} 个节点`);
            return;
        }
        if (op.type === "set_viewport") items.push("调整当前画布视图");
    });

    const warnings = [];
    if (destructiveCount) warnings.push("包含删除操作，批准后可从最近 Agent 批次逐步撤销。");
    if (generationCount) warnings.push("生成任务可能产生模型费用，画布撤销不会取消已提交任务。");
    return {
        operationCount: safeOps.length,
        affectedNodeCount: affectedNodeIds.size + addedNodeCount,
        destructiveCount,
        generationCount,
        items: items.slice(0, 8),
        warning: warnings.join(" "),
    };
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;

    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = Object.values(CanvasNodeType).includes(op.nodeType as CanvasNodeType) ? op.nodeType! : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            const current = nodes.find((node) => node.id === op.id);
            const nextPosition = op.patch?.position;
            const dx = current?.type === CanvasNodeType.Frame && nextPosition ? nextPosition.x - current.position.x : 0;
            const dy = current?.type === CanvasNodeType.Frame && nextPosition ? nextPosition.y - current.position.y : 0;
            nodes = nodes.map((node) => {
                if (node.id === op.id) return { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } };
                if (node.parentId === op.id && (dx || dy)) return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
                return node;
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            nodes = nodes.filter((node) => !ids.has(node.id)).map((node) => (node.parentId && ids.has(node.parentId) ? { ...node, parentId: undefined } : node));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const exists = connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId && conn.fromHandleId === op.fromHandleId && conn.toHandleId === op.toHandleId);
            const from = nodes.find((node) => node.id === op.fromNodeId);
            const to = nodes.find((node) => node.id === op.toNodeId);
            const hasNodes = Boolean(from && to && from.type !== CanvasNodeType.Frame && to.type !== CanvasNodeType.Frame);
            if (!exists && hasNodes) connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId, fromHandleId: op.fromHandleId, toHandleId: op.toHandleId }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

export function hashCanvasAgentSnapshot(snapshot: CanvasAgentSnapshot) {
    let hash = 2166136261;
    const text = JSON.stringify({ projectId: snapshot.projectId, domainProjectId: snapshot.domainProjectId, title: snapshot.title, nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selectedNodeIds, viewport: snapshot.viewport });
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function opLabel(type: string) {
    if (type === "add_node") return "新增节点";
    if (type === "update_node") return "更新节点";
    if (type === "delete_node") return "删除节点";
    if (type === "delete_connections") return "删除连线";
    if (type === "connect_nodes") return "连接";
    if (type === "set_viewport") return "调整视图";
    if (type === "select_nodes") return "选择节点";
    if (type === "run_generation") return "触发生成";
    return type;
}

function canvasNodeTypeLabel(type?: CanvasNodeType) {
    if (type === CanvasNodeType.Image) return "图片节点";
    if (type === CanvasNodeType.Video) return "视频节点";
    if (type === CanvasNodeType.Audio) return "音频节点";
    if (type === CanvasNodeType.Config) return "生成配置";
    if (type === CanvasNodeType.Script) return "分镜脚本";
    if (type === CanvasNodeType.Frame) return "背板";
    if (type === CanvasNodeType.Drawing) return "绘图节点";
    if (type === CanvasNodeType.Skill) return "技能节点";
    return "文本节点";
}

function generationModeLabel(mode?: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本";
    if (mode === "video") return "视频";
    if (mode === "audio") return "音频";
    return "图片";
}

function generationOutcome(taskStatus?: string, officialStatus?: string, taskId?: string): CanvasAgentGenerationVerification["outcome"] {
    if (!taskId) return "not_started";
    const status = taskStatus || officialStatus;
    if (status === "queued" || status === "pending" || officialStatus === "pending") return "queued";
    if (status === "running" || status === "processing" || officialStatus === "processing") return "running";
    if (status === "succeeded" || status === "completed" || officialStatus === "completed") return "succeeded";
    if (status === "failed" || officialStatus === "failed") return "failed";
    if (status === "cancelled" || status === "canceled" || officialStatus === "cancelled") return "cancelled";
    return "unknown";
}

function generationVerificationMessage(outcome: CanvasAgentGenerationVerification["outcome"], resourceReady: boolean) {
    if (outcome === "not_started") return "没有成功提交任务";
    if (outcome === "queued") return "排队中";
    if (outcome === "running") return "生成中";
    if (outcome === "failed") return "生成失败";
    if (outcome === "cancelled") return "已取消";
    if (outcome === "succeeded" && resourceReady) return "已完成且资源就绪";
    if (outcome === "succeeded") return "任务已成功但资源未就绪";
    return "状态未知";
}
