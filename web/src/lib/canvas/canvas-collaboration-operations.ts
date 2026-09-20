import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasCollaborationOperationDelta } from "@/services/api/canvas-collaboration";

export type CanvasCollaborationOperationApplyResult = {
    project: CanvasProject;
    applied: boolean;
    requiresResync?: boolean;
};

function clone<T>(value: T): T {
    return structuredClone(value);
}

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
    for (const [key, value] of Object.entries(patch)) {
        // The server uses explicit JSON null, not JSON Merge Patch deletion.
        if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
        target[key] = clone(value);
    }
}

function hasValidConnections(project: CanvasProject) {
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    if (nodeIds.size !== project.nodes.length || nodeIds.has("")) return false;
    const connectionIds = new Set<string>();
    return project.connections.every((connection) => {
        if (!connection.id || connectionIds.has(connection.id)) return false;
        connectionIds.add(connection.id);
        return connection.fromNodeId !== connection.toNodeId && nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId);
    });
}

/**
 * Applies one committed server operation to a confirmed project snapshot.
 * The function never mutates its input. A revision gap or an operation whose
 * payload is intentionally private asks the caller to perform a full pull.
 */
export function applyCanvasCollaborationOperation(snapshot: CanvasProject, operation: CanvasCollaborationOperationDelta): CanvasCollaborationOperationApplyResult {
    const currentRevision = Number.isSafeInteger(snapshot.revision) ? snapshot.revision! : 0;
    if (!Number.isSafeInteger(operation.revision)) return { project: snapshot, applied: false, requiresResync: true };
    if (operation.revision <= currentRevision) {
        return { project: snapshot, applied: false };
    }
    if (operation.revision !== currentRevision + 1 || operation.requiresSync) {
        return { project: snapshot, applied: false, requiresResync: true };
    }

    const next = { ...snapshot };
    const kind = operation.kind;
    if (kind === "update_node") {
        if (!operation.nodeId || !operation.patch) return { project: snapshot, applied: false, requiresResync: true };
        const original = next.nodes.find((item) => item.id === operation.nodeId);
        const node = original && { ...original };
        if (!node) return { project: snapshot, applied: false, requiresResync: true };
        const incarnation = (node.metadata as Record<string, unknown> | undefined)?.collaborationIncarnation ?? 1;
        if (operation.incarnation && operation.incarnation !== incarnation) return { project: snapshot, applied: false, requiresResync: true };
        if ("id" in operation.patch) return { project: snapshot, applied: false, requiresResync: true };
        applyPatch(node as unknown as Record<string, unknown>, operation.patch);
        next.nodes = next.nodes.map((item) => (item === original ? node : item));
    } else if (kind === "update_canvas") {
        if (!operation.rootPatch) return { project: snapshot, applied: false, requiresResync: true };
        const allowed = new Set(["title", "projectId", "aigcPrimaryProjectId", "aigcProjectId", "chatSessions", "activeChatId", "starterMode", "appearance", "backgroundMode", "showImageInfo", "directorScenes", "timeline"]);
        if (Object.keys(operation.rootPatch).some((key) => !allowed.has(key))) return { project: snapshot, applied: false, requiresResync: true };
        applyPatch(next as unknown as Record<string, unknown>, operation.rootPatch);
    } else if (kind === "delete_node") {
        if (!operation.nodeId) return { project: snapshot, applied: false, requiresResync: true };
        next.nodes = next.nodes.filter((node) => node.id !== operation.nodeId);
        next.connections = next.connections.filter((connection) => connection.fromNodeId !== operation.nodeId && connection.toNodeId !== operation.nodeId);
    } else if (kind === "create_nodes") {
        const nodes = (operation.nodes || []) as unknown as CanvasNodeData[];
        const existing = new Set(next.nodes.map((node) => node.id));
        if (!nodes.length || nodes.some((node) => !node.id || existing.has(node.id))) {
            return { project: snapshot, applied: false, requiresResync: true };
        }
        next.nodes = [...next.nodes, ...clone(nodes)];
        next.connections = [...next.connections, ...clone((operation.connections || []) as unknown as CanvasConnection[])];
    } else if (kind === "update_connections") {
        next.connections = clone((operation.connections || []) as unknown as CanvasConnection[]);
    } else {
        return { project: snapshot, applied: false, requiresResync: true };
    }

    next.revision = operation.revision;
    if (operation.updatedAt) next.updatedAt = operation.updatedAt;
    if (!hasValidConnections(next)) return { project: snapshot, applied: false, requiresResync: true };
    return { project: next, applied: true };
}
