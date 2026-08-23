import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasAgentResource = {
    nodeId: string;
    nodeTitle: string;
    nodeType: CanvasNodeData["type"];
    status: string;
    resourceId?: string;
    storageKey?: string;
    assetId?: string;
    assetCategory?: string;
    mimeType?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    ready: boolean;
};

export function buildCanvasAgentContext(snapshot: CanvasAgentSnapshot) {
    const nodes = snapshot.nodes || [];
    const selectedIds = new Set(snapshot.selectedNodeIds || []);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const resources = nodes.flatMap((node) => {
        const resource = resourceFromNode(node);
        return resource ? [resource] : [];
    });
    const nodeTypeCounts = nodes.reduce<Record<string, number>>((counts, node) => {
        counts[node.type] = (counts[node.type] || 0) + 1;
        return counts;
    }, {});
    return {
        schemaVersion: 1,
        stateHash: hashSnapshot(snapshot),
        canvas: { projectId: snapshot.projectId, domainProjectId: snapshot.domainProjectId, title: snapshot.title, viewport: snapshot.viewport, nodeCount: nodes.length, connectionCount: snapshot.connections.length, selectedNodeCount: selectedIds.size, nodeTypeCounts },
        selection: nodes.filter((node) => selectedIds.has(node.id)).map(compactNode),
        nodes: nodes.map(compactNode),
        connections: snapshot.connections.map((connection) => ({ id: connection.id, fromNodeId: connection.fromNodeId, fromTitle: nodeById.get(connection.fromNodeId)?.title || "未知节点", toNodeId: connection.toNodeId, toTitle: nodeById.get(connection.toNodeId)?.title || "未知节点", fromHandleId: connection.fromHandleId, toHandleId: connection.toHandleId })),
        resources,
        warnings: [
            ...(nodes.some((node) => node.metadata?.status === "error") ? ["画布中存在生成失败节点；重试前先检查错误信息。"] : []),
            ...(resources.some((resource) => !resource.ready) ? ["存在未就绪或缺少持久化引用的媒体节点，不要把占位节点当作可用参考素材。"] : []),
        ],
    };
}

export function findCanvasAgentNodes(snapshot: CanvasAgentSnapshot, input: { query?: string; ids?: string[]; types?: string[]; statuses?: string[]; resourceOnly?: boolean; limit?: number }) {
    const query = input.query?.trim().toLocaleLowerCase();
    const ids = input.ids?.length ? new Set(input.ids) : null;
    const types = input.types?.length ? new Set(input.types) : null;
    const statuses = input.statuses?.length ? new Set(input.statuses) : null;
    const limit = Math.min(Math.max(input.limit || 50, 1), 200);
    const nodes = snapshot.nodes.filter((node) => {
        const metadata = (node.metadata || {}) as Record<string, unknown>;
        if (ids && !ids.has(node.id)) return false;
        if (types && !types.has(node.type)) return false;
        if (statuses && !statuses.has(String(metadata.status || "idle"))) return false;
        if (input.resourceOnly && !resourceFromNode(node)) return false;
        if (!query) return true;
        return [node.id, node.title, metadata.content, metadata.prompt, metadata.composerContent, metadata.assetId, Array.isArray(metadata.assetTags) ? metadata.assetTags.join(" ") : "", metadata.workflowKind, metadata.workflowTitle, metadata.characterName]
            .some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
    return { query: input.query || "", total: nodes.length, truncated: nodes.length > limit, nodes: nodes.slice(0, limit).map(compactNode) };
}

export function getCanvasAgentResources(snapshot: CanvasAgentSnapshot, input: { nodeIds?: string[]; status?: string; limit?: number }) {
    const nodeIds = input.nodeIds?.length ? new Set(input.nodeIds) : null;
    const limit = Math.min(Math.max(input.limit || 100, 1), 300);
    const resources = snapshot.nodes.flatMap((node) => {
        if (nodeIds && !nodeIds.has(node.id)) return [];
        const resource = resourceFromNode(node);
        return resource && (!input.status || resource.status === input.status) ? [resource] : [];
    });
    return { total: resources.length, truncated: resources.length > limit, resources: resources.slice(0, limit) };
}

export function validateCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops: CanvasAgentOp[]) {
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const addedIds = new Set<string>();
    const issues: Array<{ index: number; severity: "error" | "warning"; message: string }> = [];
    const requireNode = (index: number, id: unknown, label: string) => {
        if (typeof id !== "string" || !id) issues.push({ index, severity: "error", message: `${label} 缺少节点 id` });
        else if (!nodeIds.has(id) && !addedIds.has(id)) issues.push({ index, severity: "error", message: `${label}「${id}」不存在，请先重新读取画布上下文` });
    };
    ops.forEach((op, index) => {
        if (op.type === "add_node") {
            if (op.id && (nodeIds.has(op.id) || addedIds.has(op.id))) issues.push({ index, severity: "error", message: `新增节点 id「${op.id}」重复` });
            if (op.id) addedIds.add(op.id);
        } else if (op.type === "update_node") requireNode(index, op.id, "更新目标");
        else if (op.type === "run_generation") requireNode(index, op.nodeId, "生成目标");
        else if (op.type === "delete_node") (op.ids || (op.id ? [op.id] : [])).forEach((id) => requireNode(index, id, "删除目标"));
        else if (op.type === "connect_nodes") { requireNode(index, op.fromNodeId, "连接起点"); requireNode(index, op.toNodeId, "连接终点"); }
        else if (op.type === "select_nodes") op.ids.forEach((id) => requireNode(index, id, "选区节点"));
    });
    return { ok: !issues.some((issue) => issue.severity === "error"), issues, operationCount: ops.length, currentStateHash: hashSnapshot(snapshot) };
}

function compactNode(node: CanvasNodeData) {
    const metadata = (node.metadata || {}) as Record<string, unknown>;
    const resource = resourceFromNode(node);
    return {
        id: node.id,
        type: node.type,
        title: node.title || "未命名节点",
        position: node.position,
        size: { width: node.width, height: node.height },
        parentId: node.parentId,
        status: String(metadata.status || "idle"),
        content: preview(metadata.content, 240),
        prompt: preview(metadata.prompt || metadata.composerContent, 300),
        generation: metadata.generationMode || metadata.workflowKind ? { mode: metadata.generationMode, model: metadata.model, workflowKind: metadata.workflowKind, workflowTitle: metadata.workflowTitle } : undefined,
        asset: metadata.assetId || metadata.characterAssetId ? { assetId: metadata.assetId || metadata.characterAssetId, versionId: metadata.characterVersionId, category: metadata.assetCategory, tags: metadata.assetTags, characterName: metadata.characterName } : undefined,
        resource: resource ? { resourceId: resource.resourceId, storageKey: resource.storageKey, mimeType: resource.mimeType, bytes: resource.bytes, width: resource.width, height: resource.height, durationMs: resource.durationMs, ready: resource.ready } : undefined,
    };
}

function resourceFromNode(node: CanvasNodeData): CanvasAgentResource | null {
    const metadata = (node.metadata || {}) as Record<string, unknown>;
    const storageKey = typeof metadata.storageKey === "string" && metadata.storageKey.trim() ? metadata.storageKey.trim() : undefined;
    const resourceId = storageKey?.startsWith("resource:") ? storageKey.slice("resource:".length) : stringValue(metadata.resourceId);
    const hasSignal = Boolean(storageKey || resourceId || metadata.assetId || metadata.primaryImageId || metadata.mimeType || ["image", "video", "audio"].includes(node.type));
    if (!hasSignal) return null;
    const status = String(metadata.status || "idle");
    return { nodeId: node.id, nodeTitle: node.title || "未命名节点", nodeType: node.type, status, resourceId, storageKey, assetId: stringValue(metadata.assetId || metadata.characterAssetId), assetCategory: stringValue(metadata.assetCategory), mimeType: stringValue(metadata.mimeType), bytes: numberValue(metadata.bytes), width: numberValue(metadata.naturalWidth), height: numberValue(metadata.naturalHeight), durationMs: numberValue(metadata.durationMs), ready: status === "success" && Boolean(storageKey || resourceId || metadata.primaryImageId) };
}

function hashSnapshot(snapshot: CanvasAgentSnapshot) {
    let hash = 2166136261;
    const text = JSON.stringify({ projectId: snapshot.projectId, title: snapshot.title, nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selectedNodeIds, viewport: snapshot.viewport });
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function preview(value: unknown, limit: number) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const text = value.trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
