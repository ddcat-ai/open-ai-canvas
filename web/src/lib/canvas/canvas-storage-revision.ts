import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasStorageTombstones = {
    projects: Record<string, number>;
    nodes: Record<string, Record<string, number>>;
    connections: Record<string, Record<string, number>>;
    sessions: Record<string, Record<string, number>>;
    messages: Record<string, Record<string, Record<string, number>>>;
};

export type CanvasStorageDocument = {
    state: { projects: CanvasProject[] };
    version: number;
    storageRevision: number;
    tombstones: CanvasStorageTombstones;
};

export type CanvasStorageConflict = {
    kind: "project" | "node" | "connection" | "session" | "message";
    id: string;
    projectId?: string;
    sessionId?: string;
    reason?: "concurrent-update";
};

const emptyTombstones = (): CanvasStorageTombstones => ({
    projects: {},
    nodes: {},
    connections: {},
    sessions: {},
    messages: {},
});

function recordOfNumbers(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}

function nestedRecords(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, recordOfNumbers(nested)]));
}

function messageRecords(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([projectId, sessions]) => [projectId, nestedRecords(sessions)]));
}

function normalizeTombstones(value: unknown): CanvasStorageTombstones {
    const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
        projects: recordOfNumbers(source.projects),
        nodes: nestedRecords(source.nodes),
        connections: nestedRecords(source.connections),
        sessions: nestedRecords(source.sessions),
        messages: messageRecords(source.messages),
    };
}

export function parseCanvasStorageDocument(value: string | null, fallback: CanvasProject[] = []): CanvasStorageDocument {
    if (!value) {
        return {
            state: { projects: fallback },
            version: 0,
            storageRevision: 0,
            tombstones: emptyTombstones(),
        };
    }
    const parsed = JSON.parse(value) as {
        state?: { projects?: unknown };
        version?: unknown;
        storageRevision?: unknown;
        tombstones?: unknown;
    };
    if (!Array.isArray(parsed.state?.projects)) throw new Error("画布持久状态无效");
    return {
        state: { projects: parsed.state.projects as CanvasProject[] },
        version: typeof parsed.version === "number" ? parsed.version : 0,
        storageRevision: typeof parsed.storageRevision === "number" && Number.isFinite(parsed.storageRevision) ? parsed.storageRevision : 0,
        tombstones: normalizeTombstones(parsed.tombstones),
    };
}

export function serializeCanvasStorageDocument(document: CanvasStorageDocument) {
    return JSON.stringify(document);
}

function deepEqual(left: unknown, right: unknown) {
    if (Object.is(left, right)) return true;
    return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(base: unknown, local: unknown, durable: unknown, key?: string, onConflict?: () => void): unknown {
    if (deepEqual(local, base)) return durable;
    if (deepEqual(durable, base)) return local;
    if (deepEqual(local, durable)) return local;
    if (key === "updatedAt") return durable;
    if (key === "generationEffectKeys" && Array.isArray(local) && Array.isArray(durable)) {
        return [...new Set([...durable, ...local])];
    }
    if (isRecord(base) && isRecord(local) && isRecord(durable)) return mergeRecord(base, local, durable, new Set(), onConflict);
    if (!isRecord(base) && isRecord(local) && isRecord(durable)) return mergeRecord({}, local, durable, new Set(), onConflict);
    onConflict?.();
    return durable;
}

function mergeRecord(base: Record<string, unknown>, local: Record<string, unknown>, durable: Record<string, unknown>, excluded = new Set<string>(), onConflict?: () => void) {
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(durable)])) {
        if (excluded.has(key)) continue;
        const baseHas = Object.prototype.hasOwnProperty.call(base, key);
        const localHas = Object.prototype.hasOwnProperty.call(local, key);
        const durableHas = Object.prototype.hasOwnProperty.call(durable, key);
        if (!localHas && baseHas) {
            if (durableHas && !deepEqual(durable[key], base[key])) {
                onConflict?.();
                merged[key] = durable[key];
            }
            continue;
        }
        if (!localHas) {
            if (durableHas) merged[key] = durable[key];
            continue;
        }
        if (!baseHas) {
            if (!durableHas) merged[key] = local[key];
            else merged[key] = mergeValue(undefined, local[key], durable[key], key, onConflict);
            continue;
        }
        if (!durableHas) {
            if (!deepEqual(local[key], base[key])) {
                onConflict?.();
                merged[key] = local[key];
            }
            continue;
        }
        merged[key] = mergeValue(base[key], local[key], durable[key], key, onConflict);
    }
    return merged;
}

function concurrentConflictRecorder(conflicts: CanvasStorageConflict[], conflict: Omit<CanvasStorageConflict, "reason">) {
    let recorded = false;
    return () => {
        if (recorded) return;
        recorded = true;
        conflicts.push({ ...conflict, reason: "concurrent-update" });
    };
}

function nestedTombstones(parent: Record<string, Record<string, number>>, id: string) {
    return (parent[id] ||= {});
}

function nestedMessageTombstones(parent: CanvasStorageTombstones["messages"], projectId: string, sessionId: string) {
    const sessions = (parent[projectId] ||= {});
    return (sessions[sessionId] ||= {});
}

function mergeEntities<T extends { id: string }>(input: {
    base: T[];
    local: T[];
    durable: T[];
    tombstones: Record<string, number>;
    baseRevision: number;
    nextRevision: number;
    merge: (base: T | undefined, local: T, durable: T) => T;
    conflict: (id: string) => CanvasStorageConflict;
    conflicts: CanvasStorageConflict[];
}) {
    const baseById = new Map(input.base.map((item) => [item.id, item]));
    const localById = new Map(input.local.map((item) => [item.id, item]));
    const durableById = new Map(input.durable.map((item) => [item.id, item]));
    const result = [...input.durable];
    const resultPositions = new Map(result.map((item, index) => [item.id, index]));

    const remove = (id: string) => {
        const index = resultPositions.get(id);
        if (index === undefined) return;
        result.splice(index, 1);
        resultPositions.clear();
        result.forEach((item, position) => resultPositions.set(item.id, position));
    };
    const set = (item: T) => {
        const index = resultPositions.get(item.id);
        if (index === undefined) {
            resultPositions.set(item.id, result.length);
            result.push(item);
        } else {
            result[index] = item;
        }
    };

    for (const id of new Set([...baseById.keys(), ...localById.keys()])) {
        const base = baseById.get(id);
        const local = localById.get(id);
        const durable = durableById.get(id);

        if (base && !local) {
            remove(id);
            input.tombstones[id] = input.nextRevision;
            continue;
        }
        if (!local || (base && deepEqual(base, local))) continue;

        if (!durable) {
            if (base || (input.tombstones[id] ?? 0) > input.baseRevision) {
                input.conflicts.push(input.conflict(id));
                continue;
            }
            delete input.tombstones[id];
            set(local);
            continue;
        }

        delete input.tombstones[id];
        set(input.merge(base, local, durable));
    }

    return result;
}

function mergeMessages(input: {
    projectId: string;
    sessionId: string;
    base: CanvasAssistantSession["messages"];
    local: CanvasAssistantSession["messages"];
    durable: CanvasAssistantSession["messages"];
    tombstones: CanvasStorageTombstones;
    baseRevision: number;
    nextRevision: number;
    conflicts: CanvasStorageConflict[];
}) {
    return mergeEntities({
        ...input,
        tombstones: nestedMessageTombstones(input.tombstones.messages, input.projectId, input.sessionId),
        merge: (base, local, durable) =>
            mergeRecord(
                (base || {}) as Record<string, unknown>,
                local as unknown as Record<string, unknown>,
                durable as unknown as Record<string, unknown>,
                new Set(),
                concurrentConflictRecorder(input.conflicts, { kind: "message", id: local.id, projectId: input.projectId, sessionId: input.sessionId }),
            ) as CanvasAssistantSession["messages"][number],
        conflict: (id) => ({ kind: "message", id, projectId: input.projectId, sessionId: input.sessionId }),
    });
}

function mergeSessions(input: {
    projectId: string;
    base: CanvasAssistantSession[];
    local: CanvasAssistantSession[];
    durable: CanvasAssistantSession[];
    tombstones: CanvasStorageTombstones;
    baseRevision: number;
    nextRevision: number;
    conflicts: CanvasStorageConflict[];
}) {
    return mergeEntities({
        ...input,
        tombstones: nestedTombstones(input.tombstones.sessions, input.projectId),
        merge: (base, local, durable) => {
            const merged = mergeRecord(
                (base || {}) as unknown as Record<string, unknown>,
                local as unknown as Record<string, unknown>,
                durable as unknown as Record<string, unknown>,
                new Set(["messages"]),
                concurrentConflictRecorder(input.conflicts, { kind: "session", id: local.id, projectId: input.projectId }),
            ) as unknown as CanvasAssistantSession;
            merged.messages = mergeMessages({
                ...input,
                sessionId: local.id,
                base: base?.messages || [],
                local: local.messages,
                durable: durable.messages,
            });
            return merged;
        },
        conflict: (id) => ({ kind: "session", id, projectId: input.projectId }),
    });
}

function mergeProject(base: CanvasProject | undefined, local: CanvasProject, durable: CanvasProject, document: CanvasStorageDocument, baseRevision: number, nextRevision: number, conflicts: CanvasStorageConflict[]) {
    const common = {
        projectId: local.id,
        tombstones: document.tombstones,
        baseRevision,
        nextRevision,
        conflicts,
    };
    const merged = mergeRecord(
        (base || {}) as unknown as Record<string, unknown>,
        local as unknown as Record<string, unknown>,
        durable as unknown as Record<string, unknown>,
        new Set(["nodes", "connections", "chatSessions"]),
        concurrentConflictRecorder(conflicts, { kind: "project", id: local.id }),
    ) as unknown as CanvasProject;
    merged.nodes = mergeEntities<CanvasNodeData>({
        ...common,
        base: base?.nodes || [],
        local: local.nodes,
        durable: durable.nodes,
        tombstones: nestedTombstones(document.tombstones.nodes, local.id),
        merge: (baseNode, localNode, durableNode) => {
            let conflictRecorded = false;
            return mergeRecord((baseNode || {}) as unknown as Record<string, unknown>, localNode as unknown as Record<string, unknown>, durableNode as unknown as Record<string, unknown>, new Set(), () => {
                if (conflictRecorded) return;
                conflictRecorded = true;
                conflicts.push({ kind: "node", id: localNode.id, projectId: local.id, reason: "concurrent-update" });
            }) as unknown as CanvasNodeData;
        },
        conflict: (id) => ({ kind: "node", id, projectId: local.id }),
    });
    merged.connections = mergeEntities<CanvasConnection>({
        ...common,
        base: base?.connections || [],
        local: local.connections,
        durable: durable.connections,
        tombstones: nestedTombstones(document.tombstones.connections, local.id),
        merge: (baseConnection, localConnection, durableConnection) =>
            mergeRecord(
                (baseConnection || {}) as unknown as Record<string, unknown>,
                localConnection as unknown as Record<string, unknown>,
                durableConnection as unknown as Record<string, unknown>,
                new Set(),
                concurrentConflictRecorder(conflicts, { kind: "connection", id: localConnection.id, projectId: local.id }),
            ) as unknown as CanvasConnection,
        conflict: (id) => ({ kind: "connection", id, projectId: local.id }),
    });
    merged.chatSessions = mergeSessions({
        ...common,
        base: base?.chatSessions || [],
        local: local.chatSessions,
        durable: durable.chatSessions,
    });
    return merged;
}

export function rebaseCanvasProjects(input: { document: CanvasStorageDocument; baseProjects: CanvasProject[]; localProjects: CanvasProject[]; baseRevision: number }) {
    const document: CanvasStorageDocument = {
        ...input.document,
        state: { projects: input.document.state.projects },
        storageRevision: input.document.storageRevision,
        tombstones: normalizeTombstones(input.document.tombstones),
    };
    const nextRevision = document.storageRevision + 1;
    const conflicts: CanvasStorageConflict[] = [];
    document.state.projects = mergeEntities<CanvasProject>({
        base: input.baseProjects,
        local: input.localProjects,
        durable: document.state.projects,
        tombstones: document.tombstones.projects,
        baseRevision: input.baseRevision,
        nextRevision,
        merge: (base, local, durable) => mergeProject(base, local, durable, document, input.baseRevision, nextRevision, conflicts),
        conflict: (id) => ({ kind: "project", id }),
        conflicts,
    });
    document.storageRevision = nextRevision;
    return { document, conflicts };
}
