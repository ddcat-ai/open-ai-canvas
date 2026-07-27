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
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    domainProjectId?: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

export type CanvasAgentOperationImpact = {
    operationCount: number;
    affectedNodeCount: number;
    destructiveCount: number;
    generationCount: number;
    items: string[];
    warning: string;
};

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
