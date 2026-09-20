import { nanoid } from "nanoid";
import { canonicalize } from "json-canonicalize";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasConflictField = {
    id: string;
    scope: "node" | "canvas" | "connections";
    nodeId?: string;
    connectionId?: string;
    nodeTitle?: string;
    key: string;
    label: string;
    valueType: "text" | "json" | "structure";
    baseValue: unknown;
    localValue: unknown;
    remoteValue: unknown;
};

export type CanvasConflictSnapshot = {
    id: string;
    projectId: string;
    detectedAt: string;
    base: CanvasProject;
    local: CanvasProject;
    remote: CanvasProject;
    fields: CanvasConflictField[];
};

const conflictKey = (projectId: string) => `infinite-canvas:conflict:${projectId}`;

export async function readCanvasConflict(projectId: string, scope = getActiveUserScope()): Promise<CanvasConflictSnapshot | null> {
    const raw = await localForageStorageForScope(scope).getItem(conflictKey(projectId));
    return raw ? (JSON.parse(raw) as CanvasConflictSnapshot) : null;
}

export async function saveCanvasConflict(snapshot: Omit<CanvasConflictSnapshot, "id" | "detectedAt">, scope = getActiveUserScope()) {
    const value: CanvasConflictSnapshot = {
        ...snapshot,
        id: nanoid(),
        detectedAt: new Date().toISOString(),
    };
    await localForageStorageForScope(scope).setItem(conflictKey(snapshot.projectId), JSON.stringify(value));
    return value;
}

export async function clearCanvasConflict(projectId: string, scope = getActiveUserScope()) {
    await localForageStorageForScope(scope).removeItem(conflictKey(projectId));
}

export function buildCanvasConflictFields(base: CanvasProject, local: CanvasProject, remote: CanvasProject): CanvasConflictField[] {
    const fields: CanvasConflictField[] = [];
    const baseNodes = new Map((base.nodes || []).map((node) => [node.id, node]));
    const localNodes = new Map((local.nodes || []).map((node) => [node.id, node]));
    const remoteNodes = new Map((remote.nodes || []).map((node) => [node.id, node]));
    const nodeIds = new Set([...baseNodes.keys(), ...localNodes.keys(), ...remoteNodes.keys()]);

    for (const nodeId of nodeIds) {
        const before = baseNodes.get(nodeId);
        const mine = localNodes.get(nodeId);
        const latest = remoteNodes.get(nodeId);
        // A node which is created by both sides with the same id is rare, but
        // it is still a real conflict (imports and retries can reuse ids). Do
        // not silently discard either side of that branch.
        if (!before) {
            if (mine && latest && !sameValue(mine, latest)) {
                fields.push(field("node", nodeId, mine.title || latest.title || "新增节点", "structure", "新增节点内容", "structure", null, mine, latest));
            }
            continue;
        }
        if (!mine || !latest) {
            const localChanged = !sameValue(before, mine);
            const remoteChanged = !sameValue(before, latest);
            if (localChanged && remoteChanged && !sameValue(mine, latest)) {
                fields.push(field("node", nodeId, before.title || "未命名节点", "structure", "节点结构", "structure", before, mine || null, latest || null));
            }
            continue;
        }
        const title = mine.title || latest.title || before.title || "未命名节点";
        const keys = new Set([...Object.keys(before), ...Object.keys(mine), ...Object.keys(latest)]);
        for (const key of keys) {
            if (key === "id" || key === "createdAt" || key === "updatedAt" || key === "metadata") continue;
            const beforeValue = (before as unknown as Record<string, unknown>)[key];
            const localValue = (mine as unknown as Record<string, unknown>)[key];
            const remoteValue = (latest as unknown as Record<string, unknown>)[key];
            if (sameValue(beforeValue, localValue) || sameValue(beforeValue, remoteValue) || sameValue(localValue, remoteValue)) continue;
            fields.push(field("node", nodeId, title, key, nodeFieldLabel(key), "json", beforeValue, localValue, remoteValue));
        }
        const beforePrompt = nodePrompt(before);
        const localPrompt = nodePrompt(mine);
        const remotePrompt = nodePrompt(latest);
        if (!sameValue(beforePrompt, localPrompt) && !sameValue(beforePrompt, remotePrompt) && !sameValue(localPrompt, remotePrompt)) {
            fields.push(field("node", nodeId, title, "prompt", "提示词", "text", beforePrompt, localPrompt, remotePrompt));
        }
        const beforeMetadata = withoutPromptMetadata(before.metadata);
        const localMetadata = withoutPromptMetadata(mine.metadata);
        const remoteMetadata = withoutPromptMetadata(latest.metadata);
        if (!sameValue(beforeMetadata, localMetadata) && !sameValue(beforeMetadata, remoteMetadata) && !sameValue(localMetadata, remoteMetadata)) {
            fields.push(field("node", nodeId, title, "metadata", "节点配置", "json", beforeMetadata, localMetadata, remoteMetadata));
        }
    }

    const rootKeys: Array<keyof CanvasProject> = ["title", "projectId", "chatSessions", "activeChatId", "starterMode", "appearance", "backgroundMode", "showImageInfo", "directorScenes", "timeline"];
    for (const key of rootKeys) {
        const beforeValue = base[key];
        const localValue = local[key];
        const remoteValue = remote[key];
        if (sameValue(beforeValue, localValue) || sameValue(beforeValue, remoteValue) || sameValue(localValue, remoteValue)) continue;
        fields.push(field("canvas", undefined, undefined, key, canvasFieldLabel(key), key === "title" ? "text" : "json", beforeValue, localValue, remoteValue));
    }
    const baseConnections = new Map((base.connections || []).map((connection) => [connection.id, connection]));
    const localConnections = new Map((local.connections || []).map((connection) => [connection.id, connection]));
    const remoteConnections = new Map((remote.connections || []).map((connection) => [connection.id, connection]));
    const connectionIds = new Set([...baseConnections.keys(), ...localConnections.keys(), ...remoteConnections.keys()]);
    for (const connectionId of connectionIds) {
        const before = baseConnections.get(connectionId);
        const mine = localConnections.get(connectionId);
        const latest = remoteConnections.get(connectionId);
        if (before && (!mine || !latest)) {
            const localChanged = !sameValue(before, mine);
            const remoteChanged = !sameValue(before, latest);
            if (localChanged && remoteChanged && !sameValue(mine, latest)) {
                fields.push(connectionField(connectionId, before, mine, latest));
            }
            continue;
        }
        if (!before && mine && latest && !sameValue(mine, latest)) {
            fields.push(connectionField(connectionId, null, mine, latest));
        }
        if (before && mine && latest && !sameValue(before, mine) && !sameValue(before, latest) && !sameValue(mine, latest)) {
            fields.push(connectionField(connectionId, before, mine, latest));
        }
    }
    return fields;
}

export function cloneCanvasProject(project: CanvasProject): CanvasProject {
    return structuredClone(project);
}

/**
 * Reapply changes which only the local side made. True same-field conflicts
 * remain on the remote value and are resolved by the picker in the modal.
 */
export function autoMergeIndependentCanvasChanges(base: CanvasProject, local: CanvasProject, remote: CanvasProject): CanvasProject {
    const next = cloneCanvasProject(remote);
    const rootKeys: Array<keyof CanvasProject> = ["title", "projectId", "chatSessions", "activeChatId", "starterMode", "appearance", "backgroundMode", "showImageInfo", "directorScenes", "timeline"];
    for (const key of rootKeys) {
        if (sameValue(base[key], remote[key]) && !sameValue(base[key], local[key])) {
            (next as unknown as Record<string, unknown>)[key] = structuredClone(local[key]);
        }
    }

    const baseNodes = new Map((base.nodes || []).map((node) => [node.id, node]));
    const localNodes = new Map((local.nodes || []).map((node) => [node.id, node]));
    const remoteNodes = new Map((remote.nodes || []).map((node) => [node.id, node]));
    const nextNodes = new Map((next.nodes || []).map((node) => [node.id, node]));
    const allNodeIds = new Set([...baseNodes.keys(), ...localNodes.keys(), ...remoteNodes.keys()]);
    for (const nodeId of allNodeIds) {
        const localNode = localNodes.get(nodeId);
        const before = baseNodes.get(nodeId);
        const latest = remoteNodes.get(nodeId);
        if (!before) {
            if (!latest && localNode) nextNodes.set(nodeId, structuredClone(localNode));
            else if (latest && (!localNode || sameValue(localNode, latest))) nextNodes.set(nodeId, structuredClone(latest));
            continue;
        }
        if (!localNode && !latest) {
            nextNodes.delete(nodeId);
            continue;
        }
        if (!localNode) {
            // Local deletion is safe to apply automatically only when the
            // remote side did not touch this node after the common base.
            if (sameValue(before, latest)) nextNodes.delete(nodeId);
            continue;
        }
        if (!latest) {
            // Symmetric case: keep the deletion when local did not edit the
            // node; a true delete/edit conflict stays absent until the user
            // chooses a side in the resolver.
            if (sameValue(before, localNode)) nextNodes.delete(nodeId);
            continue;
        }
        const mergedNode = nextNodes.get(nodeId) || structuredClone(latest);
        for (const key of new Set([...Object.keys(before), ...Object.keys(localNode)])) {
            if (key === "id" || key === "createdAt" || key === "updatedAt" || key === "metadata") continue;
            const beforeValue = (before as unknown as Record<string, unknown>)[key];
            const localValue = (localNode as unknown as Record<string, unknown>)[key];
            const remoteValue = (latest as unknown as Record<string, unknown>)[key];
            if (sameValue(beforeValue, remoteValue) && !sameValue(beforeValue, localValue)) {
                (mergedNode as unknown as Record<string, unknown>)[key] = structuredClone(localValue);
            }
        }
        const beforePrompt = nodePrompt(before);
        const localPrompt = nodePrompt(localNode);
        const remotePrompt = nodePrompt(latest);
        if (sameValue(beforePrompt, remotePrompt) && !sameValue(beforePrompt, localPrompt)) {
            mergedNode.metadata = { ...mergedNode.metadata, prompt: localPrompt, composerContent: localPrompt };
        }
        const beforeMetadata = withoutPromptMetadata(before.metadata);
        const localMetadata = withoutPromptMetadata(localNode.metadata);
        const remoteMetadata = withoutPromptMetadata(latest.metadata);
        if (sameValue(beforeMetadata, remoteMetadata) && !sameValue(beforeMetadata, localMetadata)) {
            const promptMetadata = mergedNode.metadata || {};
            mergedNode.metadata = { ...((structuredClone(localMetadata) as Record<string, unknown>) || {}), prompt: promptMetadata.prompt, composerContent: promptMetadata.composerContent };
        }
        nextNodes.set(nodeId, mergedNode);
    }
    next.nodes = [...nextNodes.values()];
    next.connections = mergeConnectionsById(base.connections || [], local.connections || [], remote.connections || []);
    return normalizeCanvasConflictResult(next);
}

export function applyCanvasConflictField(project: CanvasProject, conflict: CanvasConflictField, value: unknown): CanvasProject {
    const next = cloneCanvasProject(project);
    if (conflict.scope === "connections") {
        const connectionID = conflict.connectionId;
        if (!connectionID || conflict.key === "connections") {
            next.connections = structuredClone((value || []) as CanvasProject["connections"]);
            return normalizeCanvasConflictResult(next);
        }
        const retained = next.connections.filter((connection) => connection.id !== connectionID);
        if (value) retained.push(structuredClone(value) as CanvasProject["connections"][number]);
        next.connections = retained;
        return normalizeCanvasConflictResult(next);
    }
    if (conflict.scope === "canvas") {
        (next as unknown as Record<string, unknown>)[conflict.key] = structuredClone(value);
        return normalizeCanvasConflictResult(next);
    }
    const nodeIndex = next.nodes.findIndex((node) => node.id === conflict.nodeId);
    if (conflict.key === "structure") {
        const index = nodeIndex;
        if (value == null) {
            if (index >= 0) next.nodes.splice(index, 1);
            next.connections = next.connections.filter((connection) => connection.fromNodeId !== conflict.nodeId && connection.toNodeId !== conflict.nodeId);
        } else if (index >= 0) {
            next.nodes[index] = structuredClone(value) as CanvasProject["nodes"][number];
        } else {
            next.nodes.push(structuredClone(value) as CanvasProject["nodes"][number]);
        }
        return normalizeCanvasConflictResult(next);
    }
    if (nodeIndex < 0) return next;
    const node = next.nodes[nodeIndex];
    if (conflict.key === "prompt") {
        const prompt = String(value ?? "");
        const metadata = { ...node.metadata, prompt, composerContent: prompt };
        delete (metadata as Record<string, unknown>).richText;
        next.nodes[nodeIndex] = { ...node, metadata };
    } else if (conflict.key === "metadata") {
        const currentMetadata = (node.metadata || {}) as Record<string, unknown>;
        const selectedMetadata = (structuredClone(value) || {}) as Record<string, unknown>;
        // Prompt text is resolved independently above; keep the selected prompt
        // while replacing the rest of the configuration exactly, including
        // deliberate deletions made by either side.
        for (const key of ["prompt", "composerContent"]) {
            if (currentMetadata[key] !== undefined) selectedMetadata[key] = currentMetadata[key];
        }
        next.nodes[nodeIndex] = { ...node, metadata: selectedMetadata };
    } else {
        (next.nodes[nodeIndex] as unknown as Record<string, unknown>)[conflict.key] = structuredClone(value);
    }
    return normalizeCanvasConflictResult(next);
}

function field(
    scope: CanvasConflictField["scope"],
    nodeId: string | undefined,
    nodeTitle: string | undefined,
    key: string,
    label: string,
    valueType: CanvasConflictField["valueType"],
    baseValue: unknown,
    localValue: unknown,
    remoteValue: unknown,
): CanvasConflictField {
    return { id: JSON.stringify([scope, nodeId ?? null, key]), scope, nodeId, nodeTitle, key, label, valueType, baseValue, localValue, remoteValue };
}

function connectionField(connectionId: string, baseValue: unknown, localValue: unknown, remoteValue: unknown): CanvasConflictField {
    return {
        id: `connections:${connectionId}`,
        scope: "connections",
        connectionId,
        key: "connection",
        label: `连线 ${connectionId.slice(0, 8)}`,
        valueType: "structure",
        baseValue,
        localValue,
        remoteValue,
    };
}

function nodePrompt(node: CanvasProject["nodes"][number]) {
    return node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
}

function withoutPromptMetadata(metadata: CanvasProject["nodes"][number]["metadata"]) {
    if (!metadata) return metadata;
    const next = { ...metadata } as Record<string, unknown>;
    delete next.prompt;
    delete next.composerContent;
    delete next.richText;
    return next;
}

function sameValue(left: unknown, right: unknown) {
    if (Object.is(left, right)) return true;
    if (left === undefined || right === undefined) return false;
    try {
        return canonicalize(left) === canonicalize(right);
    } catch {
        return false;
    }
}

function mergeConnectionsById(base: CanvasProject["connections"], local: CanvasProject["connections"], remote: CanvasProject["connections"]): CanvasProject["connections"] {
    const baseById = new Map(base.map((connection) => [connection.id, connection]));
    const localById = new Map(local.map((connection) => [connection.id, connection]));
    const remoteById = new Map(remote.map((connection) => [connection.id, connection]));
    const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
    const merged: CanvasProject["connections"] = [];
    for (const id of ids) {
        const before = baseById.get(id);
        const mine = localById.get(id);
        const latest = remoteById.get(id);
        let selected = latest;
        if (!before) {
            if (!latest) selected = mine;
            else if (mine && sameValue(mine, latest)) selected = latest;
        } else if (sameValue(before, latest) && !sameValue(before, mine)) {
            selected = mine;
        } else if (!mine && sameValue(before, latest)) {
            selected = undefined;
        } else if (!latest && sameValue(before, mine)) {
            selected = undefined;
        } else if (sameValue(mine, latest)) {
            selected = mine;
        }
        if (selected) merged.push(structuredClone(selected));
    }
    return merged;
}

export function normalizeCanvasConflictResult(project: CanvasProject): CanvasProject {
    const nodeIds = new Set((project.nodes || []).map((node) => node.id));
    const seen = new Set<string>();
    return {
        ...project,
        connections: (project.connections || []).filter((connection) => {
            if (seen.has(connection.id)) return false;
            if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) return false;
            seen.add(connection.id);
            return true;
        }),
    };
}

function nodeFieldLabel(key: string) {
    return ({ title: "节点名称", position: "节点位置", width: "节点宽度", height: "节点高度", type: "节点类型" } as Record<string, string>)[key] || key;
}

function canvasFieldLabel(key: string) {
    return ({ title: "画布名称", backgroundMode: "背景模式", appearance: "画布外观", timeline: "时间线" } as Record<string, string>)[key] || key;
}
