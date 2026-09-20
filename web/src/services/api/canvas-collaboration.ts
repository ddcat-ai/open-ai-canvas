import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { http } from "@/services/api/request";

export type CanvasCollaborationMember = {
    id: string;
    canvasId: string;
    userId: string;
    username: string;
    displayName: string;
    role: "owner" | "editor" | "viewer";
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

export type CanvasCollaborationUser = {
    id: string;
    username: string;
    displayName: string;
};

export type CanvasCollaborationOperation = {
    opId: string;
    baseRevision?: number;
    kind: "update_node" | "update_canvas" | "delete_node" | "create_nodes" | "update_connections" | "restore_delete" | "restore_snapshot";
    nodeId?: string;
    incarnation?: number;
    fieldGroup?: string;
    before?: Record<string, unknown>;
    patch?: Record<string, unknown>;
    node?: Record<string, unknown>;
    nodes?: Array<Record<string, unknown>>;
    connections?: Array<Record<string, unknown>>;
    rootBefore?: Record<string, unknown>;
    rootPatch?: Record<string, unknown>;
    expectedConnectionIds?: string[];
    expectedConnections?: Array<Record<string, unknown>>;
    deletionId?: string;
    restoreConnectionIds?: string[];
    snapshotId?: string;
};

export type CanvasCollaborationOperationResult = {
    status: "applied" | "already_applied";
    operationId: string;
    revision: number;
    canvasId: string;
    deletionId?: string;
    document?: CanvasProject;
};

export type CanvasCollaborationOperationDelta = {
    opId: string;
    kind: CanvasCollaborationOperation["kind"] | string;
    nodeId?: string;
    incarnation?: number;
    patch?: Record<string, unknown>;
    rootPatch?: Record<string, unknown>;
    nodes?: Array<Record<string, unknown>>;
    connections?: Array<Record<string, unknown>>;
    revision: number;
    requiresSync?: boolean;
    updatedAt?: string;
};

export type CanvasCollaborationEvents = {
    events: Array<{
        id: string;
        canvasId: string;
        actorId: string;
        opId: string;
        kind: string;
        targetNodeId?: string;
        targetIncarnation?: number;
        baseRevision: number;
        revision: number;
        resultStatus: string;
        createdAt: string;
        operation?: CanvasCollaborationOperationDelta;
    }>;
    currentRevision: number;
};

export type CanvasPresenceActivityKind = "viewing" | "typing" | "dragging" | "resizing" | "connecting" | "generating";

export type CanvasPresence = {
    sessionId: string;
    userId: string;
    displayName: string;
    activity: { kind: CanvasPresenceActivityKind; nodeId?: string };
    cursor?: { x: number; y: number };
    viewport?: { x: number; y: number; k: number };
    lastSeenAt: string;
};

export type CanvasPresenceUpdate = {
    sessionId: string;
    activity: { kind: CanvasPresenceActivityKind; nodeId?: string };
    cursor?: { x: number; y: number };
    viewport?: { x: number; y: number; k: number };
};

export type CanvasBranchSummary = {
    id: string;
    sourceCanvasId: string;
    branchCanvasId: string;
    parentBranchId?: string;
    sourceTitle?: string;
    ownerId: string;
    name: string;
    status: "active" | "merged" | "archived" | string;
    baseRevision: number;
    headRevision: number;
    lastMergedSourceRevision?: number;
    lastMergedTargetRevision?: number;
    createdAt: string;
    updatedAt: string;
};

export type CanvasBranchContext = {
    branch: CanvasBranchSummary;
    sourceCanvas: CanvasBranchSummary;
};

export type CanvasBranchConflict = {
    path: string;
    label: string;
    base?: unknown;
    source?: unknown;
    target?: unknown;
};

export type CanvasBranchMergePreview = {
    branch: CanvasBranchSummary;
    targetCanvasId: string;
    baseRevision: number;
    sourceRevision: number;
    targetRevision: number;
    baseProject: CanvasProject;
    sourceProject: CanvasProject;
    targetProject: CanvasProject;
    autoMergedProject: CanvasProject;
    conflicts: CanvasBranchConflict[];
};

export type CanvasBranchMergeResult = {
    status: string;
    branch: CanvasBranchSummary;
    targetCanvasId: string;
    targetRevision: number;
    conflicts?: CanvasBranchConflict[];
    project?: CanvasProject;
};

export function listCanvasCollaborationMembers(canvasId: string) {
    return http.get<{ members: CanvasCollaborationMember[] }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/members`);
}

export function searchCanvasCollaborationUsers(canvasId: string, query: string, options?: { signal?: AbortSignal }) {
    return http.get<{ users: CanvasCollaborationUser[] }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/users`, { params: { query }, ...options });
}

export function addCanvasCollaborator(canvasId: string, input: { userId: string; role: "editor" | "viewer" }) {
    return http.post<{ member: CanvasCollaborationMember }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/members`, input);
}

export function removeCanvasCollaborator(canvasId: string, userId: string) {
    return http.delete<{ userId: string }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/members/${encodeURIComponent(userId)}`);
}

export function submitCanvasCollaborationOperation(canvasId: string, operation: CanvasCollaborationOperation) {
    return http.post<CanvasCollaborationOperationResult>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/operations`, operation);
}

export function listCanvasCollaborationEvents(canvasId: string, afterRevision: number, limit = 100) {
    return http.get<CanvasCollaborationEvents>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/events`, { params: { after: afterRevision, limit } });
}

export function listCanvasPresence(canvasId: string, options?: { signal?: AbortSignal }) {
    return http.get<{ presence: CanvasPresence[] }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/presence`, options);
}

export function updateCanvasPresence(canvasId: string, update: CanvasPresenceUpdate, options?: { signal?: AbortSignal }) {
    return http.put<{ presence: CanvasPresence }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/presence`, update, options);
}

export function removeCanvasPresence(canvasId: string, sessionId: string, options?: { signal?: AbortSignal }) {
    return http.delete<{ sessionId: string }>(`/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/presence/${encodeURIComponent(sessionId)}`, options);
}

export function listCanvasBranches(canvasId: string) {
    return http.get<{ branches: CanvasBranchSummary[] }>(`/canvas-projects/${encodeURIComponent(canvasId)}/branches`);
}

export function getCanvasBranchContext(canvasId: string) {
    return http.get<{ context: CanvasBranchContext | null }>(`/canvas-projects/${encodeURIComponent(canvasId)}/branch-context`);
}

export function createCanvasBranch(canvasId: string, input: { name: string; baseRevision?: number }) {
    return http.post<{ branch: CanvasBranchSummary; project: CanvasProject }>(`/canvas-projects/${encodeURIComponent(canvasId)}/branches`, input);
}

export function getCanvasBranch(branchId: string) {
    return http.get<{ branch: CanvasBranchSummary; project: CanvasProject }>(`/canvas-branches/${encodeURIComponent(branchId)}`);
}

export function previewCanvasBranchMerge(branchId: string, input: { targetCanvasId?: string; expectedTargetRevision?: number; sourceRevision?: number }) {
    return http.post<CanvasBranchMergePreview>(`/canvas-branches/${encodeURIComponent(branchId)}/merge-preview`, input);
}

export function mergeCanvasBranch(branchId: string, input: { targetCanvasId?: string; expectedTargetRevision: number; sourceRevision: number; mergedProject?: CanvasProject }) {
    return http.post<CanvasBranchMergeResult>(`/canvas-branches/${encodeURIComponent(branchId)}/merge`, input);
}

export function archiveCanvasBranch(branchId: string) {
    return http.post<{ branchId: string; status: string }>(`/canvas-branches/${encodeURIComponent(branchId)}/archive`);
}
