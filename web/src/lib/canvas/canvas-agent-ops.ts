import { t } from "@/i18n";
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
            items.push(ids.length ? `删除 ${ids.length} 个节点${names.length ? `：${names.join("、")}${ids.length > names.length ? t("canvas:etc") : ""}` : ""}` : `删除全部${canvasNodeTypeLabel(op.nodeType)}`);
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
            items.push(op.all ? t("canvas:delete-all-param-connections", { count: count }) : `删除 ${count || 1} 条连线`);
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
            items.push(t("canvas:select-param-nodes", { length: op.ids.length }));
            return;
        }
        if (op.type === "set_viewport") items.push(t("canvas:adjust-the-current-canvas-view"));
    });

    const warnings = [];
    if (destructiveCount) warnings.push(t("canvas:includes-delete-operations-after-approval-you-can-undo-step-by-step-from"));
    if (generationCount) warnings.push(t("canvas:generation-tasks-may-incur-model-costs-undoing-on-canvas-does-not-cancel"));
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
    if (type === "add_node") return t("canvas:add-nodes");
    if (type === "update_node") return t("canvas:update-node");
    if (type === "delete_node") return t("canvas:delete-node");
    if (type === "delete_connections") return t("canvas:delete-connections");
    if (type === "connect_nodes") return t("canvas:connect-2");
    if (type === "set_viewport") return t("canvas:adjust-view");
    if (type === "select_nodes") return t("canvas:select-nodes");
    if (type === "run_generation") return t("canvas:trigger-generation");
    return type;
}

function canvasNodeTypeLabel(type?: CanvasNodeType) {
    if (type === CanvasNodeType.Image) return t("canvas:image-node");
    if (type === CanvasNodeType.Video) return t("canvas:video-node");
    if (type === CanvasNodeType.Audio) return t("canvas:audio-node");
    if (type === CanvasNodeType.Config) return t("canvas:generation-config");
    if (type === CanvasNodeType.Script) return t("canvas:storyboard-script");
    if (type === CanvasNodeType.Frame) return t("canvas:backplate");
    if (type === CanvasNodeType.Drawing) return t("canvas:drawing-node");
    if (type === CanvasNodeType.Skill) return t("canvas:skill-node");
    return t("canvas:text-node");
}

function generationModeLabel(mode?: "text" | "image" | "video" | "audio") {
    if (mode === "text") return t("canvas:texts-2");
    if (mode === "video") return t("canvas:videos-4");
    if (mode === "audio") return t("canvas:audio-3");
    return t("canvas:images-3");
}
