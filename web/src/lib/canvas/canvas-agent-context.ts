import { hashCanvasAgentSnapshot, type CanvasAgentOp, type CanvasAgentSnapshot } from "./canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

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

export function buildCanvasAgentContext(snapshot: CanvasAgentSnapshot, options: { stateHash?: string; hashSource?: "browser-local" | "canvas-agent-server" } = {}) {
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
        revision: snapshot.revision ?? 0,
        // The browser can build a fast local fingerprint synchronously, but the
        // canonical hash used by the Canvas Agent Runtime is calculated on the
        // server. Local Runtime callers may override this value after a state
        // sync; otherwise make the source explicit so it is never mistaken for
        // the server hash in a write precondition.
        stateHash: options.stateHash || hashCanvasAgentSnapshot(snapshot),
        hashSource: options.hashSource || "browser-local",
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

export function getCanvasAgentNode(snapshot: CanvasAgentSnapshot, input: { id: string }) {
    const node = snapshot.nodes.find((candidate) => candidate.id === input.id);
    if (!node) return { found: false, id: input.id, node: null, connections: [] };
    const nodeById = new Map(snapshot.nodes.map((candidate) => [candidate.id, candidate]));
    const connections = snapshot.connections
        .filter((connection) => connection.fromNodeId === node.id || connection.toNodeId === node.id)
        .map((connection) => connectionSummary(connection, nodeById));
    return { found: true, id: node.id, node: compactNode(node), resource: resourceFromNode(node), connections };
}

export function getCanvasAgentConnection(snapshot: CanvasAgentSnapshot, input: { id: string }) {
    const connection = snapshot.connections.find((candidate) => candidate.id === input.id);
    if (!connection) return { found: false, id: input.id, connection: null };
    const nodeById = new Map(snapshot.nodes.map((candidate) => [candidate.id, candidate]));
    return {
        found: true,
        id: connection.id,
        connection: connectionSummary(connection, nodeById),
        fromNode: nodeById.get(connection.fromNodeId) ? compactNode(nodeById.get(connection.fromNodeId)!) : null,
        toNode: nodeById.get(connection.toNodeId) ? compactNode(nodeById.get(connection.toNodeId)!) : null,
    };
}

export function getCanvasAgentGenerationTasks(snapshot: CanvasAgentSnapshot, input: { status?: string; nodeIds?: string[]; limit?: number }) {
    const nodeIds = input.nodeIds?.length ? new Set(input.nodeIds) : null;
    const tasks = snapshot.nodes.flatMap((node) => {
        const metadata = (node.metadata || {}) as Record<string, unknown>;
        const taskId = stringValue(metadata.taskId);
        if (!taskId || (nodeIds && !nodeIds.has(node.id))) return [];
        const status = stringValue(metadata.taskStatus) || stringValue(metadata.status) || "unknown";
        if (input.status && status !== input.status) return [];
        const resource = resourceFromNode(node);
        return [{
            taskId,
            nodeId: node.id,
            nodeTitle: node.title || "未命名节点",
            mode: stringValue(metadata.generationMode),
            nodeStatus: stringValue(metadata.status) || "idle",
            status,
            progress: numberValue(metadata.taskProgress ?? metadata.progress),
            stage: stringValue(metadata.taskStage),
            provider: stringValue(metadata.taskProvider),
            errorCode: stringValue(metadata.taskErrorCode || metadata.generationErrorCode),
            officialStatus: stringValue(metadata.taskOfficialStatus),
            resourceReady: Boolean(resource?.ready),
        }];
    });
    const limit = Math.min(Math.max(input.limit || 100, 1), 200);
    return { total: tasks.length, truncated: tasks.length > limit, tasks: tasks.slice(0, limit) };
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
    const liveNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const connectionKeys = new Set(snapshot.connections.map(connectionKey));
    const liveConnections = new Map<string, { key: string; fromNodeId: string; toNodeId: string }>();
    snapshot.connections.forEach((connection) => liveConnections.set(connection.id, { key: connectionKey(connection), fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId }));
    const issues: Array<{ index: number; severity: "error" | "warning"; message: string }> = [];
    const removeConnection = (id: string) => {
        const connection = liveConnections.get(id);
        if (!connection) return;
        liveConnections.delete(id);
        if (![...liveConnections.values()].some((item) => item.key === connection.key)) connectionKeys.delete(connection.key);
    };
    const requireNode = (index: number, id: unknown, label: string) => {
        if (typeof id !== "string" || !id) issues.push({ index, severity: "error", message: `${label} 缺少节点 id` });
        else if (!liveNodeIds.has(id)) issues.push({ index, severity: "error", message: `${label}「${id}」不存在，请先重新读取画布上下文` });
    };
    ops.forEach((op, index) => {
        if (op.type === "add_node") {
            validateNodeNumbers(issues, index, op as unknown as Record<string, unknown>);
            if (op.id && liveNodeIds.has(op.id)) issues.push({ index, severity: "error", message: `新增节点 id「${op.id}」重复` });
            if (op.id) liveNodeIds.add(op.id);
        } else if (op.type === "update_node") {
            requireNode(index, op.id, "更新目标");
            const patch = op.patch as Record<string, unknown> | undefined;
            if (patch && ("id" in patch || "type" in patch)) issues.push({ index, severity: "error", message: "不能通过 update_node 修改节点 id 或类型" });
            if (patch) validateNodeNumbers(issues, index, patch);
            const node = snapshot.nodes.find((item) => item.id === op.id);
            const metadata = op.metadata && typeof op.metadata === "object" && !Array.isArray(op.metadata) ? op.metadata as Record<string, unknown> : undefined;
            const patchMetadata = patch?.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata) ? patch.metadata as Record<string, unknown> : undefined;
            if (isMediaNodeType(node?.type) && ((metadata && "status" in metadata) || (patchMetadata && "status" in patchMetadata))) issues.push({ index, severity: "error", message: "不能直接修改媒体节点 status；生成状态必须由任务结果回写" });
        } else if (op.type === "run_generation") {
            requireNode(index, op.nodeId, "生成目标");
            const node = snapshot.nodes.find((item) => item.id === op.nodeId);
            if (node && op.mode && op.mode !== node.type && !(op.mode === "text" && node.type === CanvasNodeType.Script)) issues.push({ index, severity: "error", message: `生成模式「${op.mode}」与节点类型「${node.type}」不匹配` });
        } else if (op.type === "delete_node") {
            const ids = op.ids || (op.id ? [op.id] : op.nodeType ? snapshot.nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
            if (!ids.length) issues.push({ index, severity: "error", message: "删除节点必须提供 id、ids 或 nodeType" });
            if (new Set(ids).size !== ids.length) issues.push({ index, severity: "error", message: "删除节点 id 不能重复" });
            ids.forEach((id) => requireNode(index, id, "删除目标"));
            ids.forEach((id) => liveNodeIds.delete(id));
            for (const [connectionId, connection] of liveConnections) if (ids.includes(connection.fromNodeId) || ids.includes(connection.toNodeId)) removeConnection(connectionId);
        } else if (op.type === "connect_nodes") {
            requireNode(index, op.fromNodeId, "连接起点");
            requireNode(index, op.toNodeId, "连接终点");
            if (op.fromNodeId === op.toNodeId) issues.push({ index, severity: "error", message: "不能连接节点自身" });
            if (op.id && liveConnections.has(op.id)) issues.push({ index, severity: "error", message: `连线 id「${op.id}」重复` });
            const key = connectionKey(op);
            if (connectionKeys.has(key)) issues.push({ index, severity: "error", message: "相同端点和 handle 的连线已存在" });
            connectionKeys.add(key);
            liveConnections.set(op.id || `__anonymous_${index}`, { key, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId });
        } else if (op.type === "select_nodes") {
            if (new Set(op.ids).size !== op.ids.length) issues.push({ index, severity: "error", message: "选区节点 id 不能重复" });
            op.ids.forEach((id) => requireNode(index, id, "选区节点"));
        } else if (op.type === "delete_connections") {
            if (op.all && (op.id || op.ids?.length)) issues.push({ index, severity: "error", message: "delete_connections 不能同时使用 all 和 id/ids" });
            if (!op.all && !op.id && !op.ids?.length) issues.push({ index, severity: "error", message: "删除连线必须提供 id、ids 或 all=true" });
            const ids = op.ids || (op.id ? [op.id] : []);
            if (new Set(ids).size !== ids.length) issues.push({ index, severity: "error", message: "删除连线 id 不能重复" });
            ids.filter((id) => !liveConnections.has(id)).forEach((id) => issues.push({ index, severity: "error", message: `连线「${id}」不存在，请先读取画布上下文` }));
            if (op.all) [...liveConnections.keys()].forEach(removeConnection);
            else ids.forEach(removeConnection);
        } else if (op.type === "set_viewport") validateViewport(issues, index, op.viewport);
    });
    return { ok: !issues.some((issue) => issue.severity === "error"), issues, operationCount: ops.length, currentStateHash: hashCanvasAgentSnapshot(snapshot) };
}

function validateNodeNumbers(issues: Array<{ index: number; severity: "error" | "warning"; message: string }>, index: number, value: Record<string, unknown>) {
    for (const key of ["x", "y"]) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) issues.push({ index, severity: "error", message: `节点 ${key} 坐标必须是有限数字` });
    if (value.position !== undefined && (!value.position || typeof value.position !== "object" || Array.isArray(value.position))) issues.push({ index, severity: "error", message: "节点 position 参数无效" });
    if (value.position && typeof value.position === "object" && !Array.isArray(value.position)) validateNodeNumbers(issues, index, value.position as Record<string, unknown>);
    for (const key of ["width", "height"]) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] <= 0)) issues.push({ index, severity: "error", message: `节点 ${key} 必须是正数` });
}

function validateViewport(issues: Array<{ index: number; severity: "error" | "warning"; message: string }>, index: number, viewport: Record<string, unknown>) {
    for (const key of ["x", "y", "k"]) if (typeof viewport?.[key] !== "number" || !Number.isFinite(viewport[key])) issues.push({ index, severity: "error", message: `视口 ${key} 必须是有限数字` });
    if (typeof viewport?.k === "number" && (viewport.k < 0.05 || viewport.k > 8)) issues.push({ index, severity: "error", message: "视口缩放 k 必须在 0.05 到 8 之间" });
}

function connectionKey(connection: { fromNodeId: string; toNodeId: string; fromHandleId?: string; toHandleId?: string }) {
    return [connection.fromNodeId, connection.toNodeId, connection.fromHandleId || "", connection.toHandleId || ""].join("\0");
}

function connectionSummary(connection: { id: string; fromNodeId: string; toNodeId: string; fromHandleId?: string; toHandleId?: string }, nodeById: Map<string, CanvasNodeData>) {
    return {
        id: connection.id,
        fromNodeId: connection.fromNodeId,
        fromTitle: nodeById.get(connection.fromNodeId)?.title || "未知节点",
        toNodeId: connection.toNodeId,
        toTitle: nodeById.get(connection.toNodeId)?.title || "未知节点",
        fromHandleId: connection.fromHandleId,
        toHandleId: connection.toHandleId,
    };
}

function isMediaNodeType(type: CanvasNodeData["type"] | undefined) {
    return type === CanvasNodeType.Image || type === CanvasNodeType.Video || type === CanvasNodeType.Audio;
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
        generation: metadata.generationMode || metadata.workflowKind || metadata.taskId ? { mode: metadata.generationMode, model: metadata.model, workflowKind: metadata.workflowKind, workflowTitle: metadata.workflowTitle, taskId: metadata.taskId, status: metadata.taskStatus || metadata.status, progress: numberValue(metadata.taskProgress ?? metadata.progress), stage: metadata.taskStage, provider: metadata.taskProvider, errorCode: metadata.taskErrorCode || metadata.generationErrorCode } : undefined,
        error: metadata.status === "error" ? preview(metadata.errorDetails || metadata.generationErrorCode, 360) : undefined,
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

function preview(value: unknown, limit: number) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const text = value.trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
