import crypto from "node:crypto";

import type { CanvasConnection, CanvasNode, CanvasSnapshot } from "./types.js";

export type CanvasResourceSummary = {
    nodeId: string;
    nodeTitle: string;
    nodeType: CanvasNode["type"];
    status?: string;
    resourceId?: string;
    storageKey?: string;
    assetId?: string;
    assetCategory?: string;
    mimeType?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    isReady: boolean;
};

export type CanvasGenerationTaskSummary = {
    taskId: string;
    nodeId: string;
    nodeTitle: string;
    mode?: string;
    nodeStatus: string;
    status: string;
    progress?: number;
    stage?: string;
    provider?: string;
    errorCode?: string;
    officialStatus?: string;
    resourceReady: boolean;
};

export type CanvasContext = {
    schemaVersion: 1;
    revision: number;
    stateHash: string;
    canvas: {
        projectId?: string;
        domainProjectId?: string;
        title?: string;
        viewport?: CanvasSnapshot["viewport"];
        nodeCount: number;
        connectionCount: number;
        selectedNodeCount: number;
        nodeTypeCounts: Record<string, number>;
    };
    selection: ReturnType<typeof compactContextNode>[];
    nodes: ReturnType<typeof compactContextNode>[];
    connections: Array<{
        id: string;
        fromNodeId: string;
        fromTitle: string;
        toNodeId: string;
        toTitle: string;
        fromHandleId?: string;
        toHandleId?: string;
    }>;
    resources: CanvasResourceSummary[];
    warnings: string[];
};

export function buildCanvasContext(state: CanvasSnapshot | null): CanvasContext {
    if (!state) throw new Error("当前没有已连接画布");
    const nodes = state.nodes || [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const selectedIds = new Set(state.selectedNodeIds || []);
    const nodeTypeCounts = nodes.reduce<Record<string, number>>((counts, node) => {
        counts[node.type] = (counts[node.type] || 0) + 1;
        return counts;
    }, {});
    const resources = nodes.flatMap((node) => {
        const resource = resourceSummary(node);
        return resource ? [resource] : [];
    });
    const warnings: string[] = [];
    if (!nodes.length) warnings.push("画布为空；创建前先确认用户要放置的区域或使用默认网格布局。");
    if (nodes.some((node) => node.metadata?.status === "error")) warnings.push("画布中存在生成失败节点；重试前应读取节点的 errorDetails 或 generationErrorCode。");
    if (resources.some((resource) => !resource.isReady)) warnings.push("存在尚未就绪或缺少持久化资源引用的媒体节点；不要把占位节点当作可用参考素材。");

    return {
        schemaVersion: 1,
        revision: state.revision ?? 0,
        stateHash: hashState(state),
        canvas: {
            projectId: state.projectId,
            domainProjectId: state.domainProjectId,
            title: state.title,
            viewport: state.viewport,
            nodeCount: nodes.length,
            connectionCount: (state.connections || []).length,
            selectedNodeCount: selectedIds.size,
            nodeTypeCounts,
        },
        selection: nodes.filter((node) => selectedIds.has(node.id)).map(compactContextNode),
        nodes: nodes.map(compactContextNode),
        connections: (state.connections || []).map((connection) => connectionSummary(connection, nodeById)),
        resources,
        warnings,
    };
}

export function findCanvasNodes(state: CanvasSnapshot | null, input: { query?: string; ids?: string[]; types?: string[]; statuses?: string[]; resourceOnly?: boolean; limit?: number }) {
    if (!state) throw new Error("当前没有已连接画布");
    const query = input.query?.trim().toLocaleLowerCase();
    const ids = input.ids?.length ? new Set(input.ids) : null;
    const types = input.types?.length ? new Set(input.types) : null;
    const statuses = input.statuses?.length ? new Set(input.statuses) : null;
    const limit = Math.min(Math.max(input.limit || 50, 1), 200);
    const nodes = (state.nodes || []).filter((node) => {
        const metadata = node.metadata || {};
        if (ids && !ids.has(node.id)) return false;
        if (types && !types.has(node.type)) return false;
        if (statuses && !statuses.has(String(metadata.status || "idle"))) return false;
        if (input.resourceOnly && !resourceSummary(node)) return false;
        if (!query) return true;
        return [node.id, node.title, metadata.content, metadata.prompt, metadata.composerContent, metadata.assetId, Array.isArray(metadata.assetTags) ? metadata.assetTags.join(" ") : "", metadata.workflowKind, metadata.workflowTitle, metadata.characterName]
            .some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
    return { query: input.query || "", total: nodes.length, truncated: nodes.length > limit, nodes: nodes.slice(0, limit).map(compactContextNode) };
}

export function getCanvasNode(state: CanvasSnapshot | null, input: { id: string }) {
    if (!state) throw new Error("当前没有已连接画布");
    const node = (state.nodes || []).find((candidate) => candidate.id === input.id);
    if (!node) return { found: false, id: input.id, node: null, connections: [] };
    const nodeById = new Map((state.nodes || []).map((candidate) => [candidate.id, candidate]));
    const connections = (state.connections || [])
        .filter((connection) => connection.fromNodeId === node.id || connection.toNodeId === node.id)
        .map((connection) => connectionSummary(connection, nodeById));
    return {
        found: true,
        id: node.id,
        node: compactContextNode(node),
        resource: resourceSummary(node),
        connections,
    };
}

export function getCanvasConnection(state: CanvasSnapshot | null, input: { id: string }) {
    if (!state) throw new Error("当前没有已连接画布");
    const connection = (state.connections || []).find((candidate) => candidate.id === input.id);
    if (!connection) return { found: false, id: input.id, connection: null };
    const nodeById = new Map((state.nodes || []).map((candidate) => [candidate.id, candidate]));
    return {
        found: true,
        id: connection.id,
        connection: connectionSummary(connection, nodeById),
        fromNode: nodeById.get(connection.fromNodeId) ? compactContextNode(nodeById.get(connection.fromNodeId)!) : null,
        toNode: nodeById.get(connection.toNodeId) ? compactContextNode(nodeById.get(connection.toNodeId)!) : null,
    };
}

export function getCanvasGenerationTasks(state: CanvasSnapshot | null, input: { status?: string; nodeIds?: string[]; limit?: number }) {
    if (!state) throw new Error("当前没有已连接画布");
    const nodeIds = input.nodeIds?.length ? new Set(input.nodeIds) : null;
    const tasks = (state.nodes || []).flatMap<CanvasGenerationTaskSummary>((node) => {
        const metadata = node.metadata || {};
        const taskId = stringValue(metadata.taskId);
        if (!taskId || (nodeIds && !nodeIds.has(node.id))) return [];
        const status = stringValue(metadata.taskStatus) || stringValue(metadata.status) || "unknown";
        if (input.status && status !== input.status) return [];
        const resource = resourceSummary(node);
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
            resourceReady: Boolean(resource?.isReady),
        }];
    });
    const limit = Math.min(Math.max(input.limit || 100, 1), 200);
    return { total: tasks.length, truncated: tasks.length > limit, tasks: tasks.slice(0, limit) };
}

export function getCanvasResources(state: CanvasSnapshot | null, input: { nodeIds?: string[]; status?: string; limit?: number }) {
    if (!state) throw new Error("当前没有已连接画布");
    const nodeIds = input.nodeIds?.length ? new Set(input.nodeIds) : null;
    const limit = Math.min(Math.max(input.limit || 100, 1), 300);
    const resources = (state.nodes || []).flatMap((node) => {
        if (nodeIds && !nodeIds.has(node.id)) return [];
        const resource = resourceSummary(node);
        if (!resource || (input.status && resource.status !== input.status)) return [];
        return [resource];
    });
    return { total: resources.length, truncated: resources.length > limit, resources: resources.slice(0, limit) };
}

export function validateCanvasOps(state: CanvasSnapshot | null, ops: unknown[]) {
    if (!state) throw new Error("当前没有已连接画布");
    const nodes = state.nodes || [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connectionKeys = new Set((state.connections || []).map(connectionKey));
    const liveConnections = new Map<string, { key: string; fromNodeId: string; toNodeId: string }>();
    (state.connections || []).forEach((connection) => {
        liveConnections.set(connection.id, { key: connectionKey(connection), fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId });
    });
    const issues: Array<{ index: number; severity: "error" | "warning"; message: string }> = [];
    const addedIds = new Set<string>();
    const liveNodeIds = new Set(nodeIds);
    const removeConnection = (id: string) => {
        const connection = liveConnections.get(id);
        if (!connection) return;
        liveConnections.delete(id);
        if (![...liveConnections.values()].some((item) => item.key === connection.key)) connectionKeys.delete(connection.key);
    };
    const requireNode = (index: number, id: unknown, label: string) => {
        if (typeof id !== "string" || !id) issues.push({ index, severity: "error", message: `${label} 缺少节点 id` });
        else if (!liveNodeIds.has(id)) issues.push({ index, severity: "error", message: `${label}「${id}」不在当前画布状态中；先重新读取 canvas_get_context 或 canvas_find_nodes` });
    };
    ops.forEach((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            issues.push({ index, severity: "error", message: "操作必须是对象" });
            return;
        }
        const op = raw as Record<string, unknown>;
        switch (op.type) {
            case "add_node":
                if (op.nodeType !== undefined && !["image", "text", "script", "config", "video", "audio", "frame"].includes(String(op.nodeType))) issues.push({ index, severity: "error", message: `新增节点类型「${String(op.nodeType)}」不受支持` });
                validateFiniteNumber(issues, index, op.x, "x 坐标");
                validateFiniteNumber(issues, index, op.y, "y 坐标");
                validatePosition(issues, index, op.position, "position");
                validatePositiveNumber(issues, index, op.width, "节点宽度");
                validatePositiveNumber(issues, index, op.height, "节点高度");
                if (typeof op.id === "string") {
                    if (nodeIds.has(op.id) || addedIds.has(op.id)) issues.push({ index, severity: "error", message: `新增节点 id「${op.id}」重复` });
                    addedIds.add(op.id);
                    liveNodeIds.add(op.id);
                }
                break;
            case "update_node": {
                requireNode(index, op.id, "更新目标");
                const targetNode = nodes.find((node) => node.id === op.id);
                if (op.patch && typeof op.patch === "object" && !Array.isArray(op.patch)) {
                    const patch = op.patch as Record<string, unknown>;
                    if ("id" in patch || "type" in patch) issues.push({ index, severity: "error", message: "不能通过 update_node 修改节点 id 或类型" });
                    validateFiniteNumber(issues, index, patch.x, "节点 x 坐标");
                    validateFiniteNumber(issues, index, patch.y, "节点 y 坐标");
                    validatePosition(issues, index, patch.position, "节点 position");
                    validatePositiveNumber(issues, index, patch.width, "节点宽度");
                    validatePositiveNumber(issues, index, patch.height, "节点高度");
                }
                const metadata = op.metadata && typeof op.metadata === "object" && !Array.isArray(op.metadata) ? op.metadata as Record<string, unknown> : null;
                const patchMetadata = op.patch && typeof op.patch === "object" && !Array.isArray(op.patch) && (op.patch as Record<string, unknown>).metadata && typeof (op.patch as Record<string, unknown>).metadata === "object" && !Array.isArray((op.patch as Record<string, unknown>).metadata) ? (op.patch as Record<string, unknown>).metadata as Record<string, unknown> : null;
                if (isMediaNodeType(targetNode?.type) && ((metadata && "status" in metadata) || (patchMetadata && "status" in patchMetadata))) issues.push({ index, severity: "error", message: "不能直接修改媒体节点 status；生成状态必须由任务结果回写" });
                break;
            }
            case "run_generation":
                requireNode(index, op.nodeId, "生成目标");
                if (typeof op.mode === "string") {
                    const node = nodes.find((item) => item.id === op.nodeId);
                    if (node && op.mode !== node.type && !(op.mode === "text" && node.type === "script")) issues.push({ index, severity: "error", message: `生成模式「${op.mode}」与节点类型「${node.type}」不匹配` });
                }
                break;
            case "delete_node": {
                const ids = Array.isArray(op.ids) ? op.ids : (typeof op.id === "string" ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []);
                if (!ids.length) issues.push({ index, severity: "error", message: "删除节点必须提供 id、ids 或 nodeType" });
                const unique = new Set(ids);
                if (unique.size !== ids.length) issues.push({ index, severity: "error", message: "删除节点 id 不能重复" });
                ids.forEach((id) => requireNode(index, id, "删除目标"));
                ids.forEach((id) => liveNodeIds.delete(id));
                for (const [connectionId, connection] of liveConnections) if (ids.includes(connection.fromNodeId) || ids.includes(connection.toNodeId)) removeConnection(connectionId);
                break;
            }
            case "connect_nodes": {
                requireNode(index, op.fromNodeId, "连接起点");
                requireNode(index, op.toNodeId, "连接终点");
                if (op.fromNodeId === op.toNodeId) issues.push({ index, severity: "error", message: "不能连接节点自身" });
                if (typeof op.id === "string" && liveConnections.has(op.id)) issues.push({ index, severity: "error", message: `连线 id「${op.id}」重复` });
                const key = connectionKey(op as CanvasConnection);
                if (connectionKeys.has(key)) issues.push({ index, severity: "error", message: "相同端点和 handle 的连线已存在" });
                connectionKeys.add(key);
                liveConnections.set(typeof op.id === "string" ? op.id : `__anonymous_${index}`, { key, fromNodeId: String(op.fromNodeId), toNodeId: String(op.toNodeId) });
                break;
            }
            case "select_nodes":
                if (Array.isArray(op.ids)) op.ids.forEach((id) => requireNode(index, id, "选区节点"));
                break;
            case "delete_connections":
                if (op.all && (op.id || (Array.isArray(op.ids) && op.ids.length))) issues.push({ index, severity: "error", message: "delete_connections 不能同时使用 all 和 id/ids" });
                if (!op.all && !op.id && !(Array.isArray(op.ids) && op.ids.length)) issues.push({ index, severity: "error", message: "删除连线必须提供 id、ids 或 all=true" });
                const connectionTargets = Array.isArray(op.ids) ? op.ids : (typeof op.id === "string" ? [op.id] : []);
                if (new Set(connectionTargets).size !== connectionTargets.length) issues.push({ index, severity: "error", message: "删除连线 id 不能重复" });
                connectionTargets.filter((id) => !liveConnections.has(id)).forEach((id) => issues.push({ index, severity: "error", message: `连线「${id}」不存在，请先读取 canvas_get_context` }));
                if (op.all) [...liveConnections.keys()].forEach(removeConnection);
                else connectionTargets.forEach(removeConnection);
                break;
            case "set_viewport":
                if (!op.viewport || typeof op.viewport !== "object") issues.push({ index, severity: "error", message: "视口参数无效" });
                else {
                    const viewport = op.viewport as Record<string, unknown>;
                    validateFiniteNumber(issues, index, viewport.x, "视口 x");
                    validateFiniteNumber(issues, index, viewport.y, "视口 y");
                    validateFiniteNumber(issues, index, viewport.k, "视口缩放");
                    if (typeof viewport.k === "number" && (viewport.k < 0.05 || viewport.k > 8)) issues.push({ index, severity: "error", message: "视口缩放 k 必须在 0.05 到 8 之间" });
                }
                break;
            default:
                issues.push({ index, severity: "error", message: `不支持的操作类型「${String(op.type)}」` });
        }
    });
    const errors = issues.filter((item) => item.severity === "error");
    return { ok: errors.length === 0, issues, operationCount: ops.length, currentStateHash: hashState(state) };
}

function validateFiniteNumber(issues: Array<{ index: number; severity: "error" | "warning"; message: string }>, index: number, value: unknown, label: string) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) issues.push({ index, severity: "error", message: `${label}必须是有限数字` });
}

function validatePositiveNumber(issues: Array<{ index: number; severity: "error" | "warning"; message: string }>, index: number, value: unknown, label: string) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) issues.push({ index, severity: "error", message: `${label}必须是正数` });
}

function validatePosition(issues: Array<{ index: number; severity: "error" | "warning"; message: string }>, index: number, value: unknown, label: string) {
    if (value === undefined) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        issues.push({ index, severity: "error", message: `${label}必须是包含 x/y 的对象` });
        return;
    }
    const position = value as Record<string, unknown>;
    validateFiniteNumber(issues, index, position.x, `${label}.x`);
    validateFiniteNumber(issues, index, position.y, `${label}.y`);
}

function connectionKey(connection: Pick<CanvasConnection, "fromNodeId" | "toNodeId" | "fromHandleId" | "toHandleId">) {
    return [connection.fromNodeId, connection.toNodeId, connection.fromHandleId || "", connection.toHandleId || ""].join("\0");
}

function isMediaNodeType(type: CanvasNode["type"] | undefined) {
    return type === "image" || type === "video" || type === "audio";
}

export function hashState(state: CanvasSnapshot) {
    return crypto.createHash("sha256").update(stableStringify({
        projectId: state.projectId,
        domainProjectId: state.domainProjectId,
        title: state.title,
        nodes: state.nodes || [],
        connections: state.connections || [],
        selectedNodeIds: state.selectedNodeIds || [],
        viewport: state.viewport,
    })).digest("hex").slice(0, 16);
}

function compactContextNode(node: CanvasNode) {
    const metadata = node.metadata || {};
    const resource = resourceSummary(node);
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
        generation: metadata.generationMode || metadata.workflowKind || metadata.taskId ? {
            mode: metadata.generationMode,
            model: metadata.model,
            workflowKind: metadata.workflowKind,
            workflowTitle: metadata.workflowTitle,
            taskId: metadata.taskId,
            status: metadata.taskStatus || metadata.status,
            progress: numberValue(metadata.taskProgress ?? metadata.progress),
            stage: metadata.taskStage,
            provider: metadata.taskProvider,
            errorCode: metadata.taskErrorCode || metadata.generationErrorCode,
        } : undefined,
        error: metadata.status === "error" ? preview(metadata.errorDetails || metadata.generationErrorCode, 360) : undefined,
        asset: metadata.assetId || metadata.characterAssetId ? {
            assetId: metadata.assetId || metadata.characterAssetId,
            versionId: metadata.characterVersionId,
            category: metadata.assetCategory,
            tags: metadata.assetTags,
            characterName: metadata.characterName,
        } : undefined,
        resource: resource ? { resourceId: resource.resourceId, storageKey: resource.storageKey, mimeType: resource.mimeType, bytes: resource.bytes, width: resource.width, height: resource.height, durationMs: resource.durationMs, ready: resource.isReady } : undefined,
    };
}

function resourceSummary(node: CanvasNode): CanvasResourceSummary | null {
    const metadata = node.metadata || {};
    const storageKey = stringValue(metadata.storageKey);
    const resourceId = storageKey?.startsWith("resource:") ? storageKey.slice("resource:".length) : undefined;
    const hasResourceSignal = Boolean(storageKey || metadata.resourceId || metadata.assetId || metadata.primaryImageId || metadata.mimeType || ["image", "video", "audio"].includes(node.type));
    if (!hasResourceSignal) return null;
    const status = stringValue(metadata.status) || "idle";
    return {
        nodeId: node.id,
        nodeTitle: node.title || "未命名节点",
        nodeType: node.type,
        status,
        resourceId: resourceId || stringValue(metadata.resourceId),
        storageKey,
        assetId: stringValue(metadata.assetId || metadata.characterAssetId),
        assetCategory: stringValue(metadata.assetCategory),
        mimeType: stringValue(metadata.mimeType),
        bytes: numberValue(metadata.bytes),
        width: numberValue(metadata.naturalWidth),
        height: numberValue(metadata.naturalHeight),
        durationMs: numberValue(metadata.durationMs),
        isReady: status === "success" && Boolean(storageKey || metadata.resourceId || metadata.primaryImageId),
    };
}

function connectionSummary(connection: CanvasConnection, nodeById: Map<string, CanvasNode>) {
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

function preview(value: unknown, limit: number) {
    if (typeof value !== "string") return undefined;
    const text = value.trim();
    if (!text) return undefined;
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
    return JSON.stringify(value);
}
