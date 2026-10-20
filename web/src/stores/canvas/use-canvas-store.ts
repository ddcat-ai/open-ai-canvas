import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { sameCanvasContent } from "@/lib/canvas/canvas-content";
import { canvasAppearanceForPreset, DEFAULT_CANVAS_BACKGROUND_MODE, NEW_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, readCanvasAppearanceDefault, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { parseCanvasStorageDocument, rebaseCanvasProjects, serializeCanvasStorageDocument, type CanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { DEFAULT_CANVAS_COLOR_THEME, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasStarterMode } from "@/lib/canvas/canvas-starter";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { PrevisScene } from "@/types/previs";
import type { TimelineProject } from "@/types/timeline";
import { useSyncProgressStore, type SyncProjectProgress } from "@/stores/use-sync-progress-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

export type CanvasProject = {
    id: string;
    revision?: number;
    remoteContentHash?: string;
    projectId?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    starterMode?: CanvasStarterMode;
    appearance?: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    previsScenes: PrevisScene[];
    timeline?: TimelineProject;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string, projectId?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "projectId" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "starterMode" | "appearance" | "backgroundMode" | "showImageInfo" | "viewport" | "previsScenes" | "timeline">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
export const CANVAS_STORE_KEY = "yingce:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
type QueuedCanvasPersist = {
    name: string;
    scope: string;
    baseProjects: CanvasProject[];
    baseRevision: number;
    state: PersistedCanvasState;
    token: number;
    journal?: CanvasPersistenceJournal;
};

type ObservedCanvasPersist = {
    projects: CanvasProject[];
    revision: number;
    savedAt?: string;
};

type CanvasPersistenceJournal = {
    version: 1;
    name: string;
    scope: string;
    writerId: string;
    token: number;
    savedAt: string;
    baseRevision: number;
    baseProjects: CanvasProject[];
    projects: CanvasProject[];
};

const CANVAS_PERSISTENCE_JOURNAL_KEY = "yingce:canvas_store_journal";
const CANVAS_JOURNAL_MAX_BYTES = 450_000;
const canvasJournalWriterId = `tab-${nanoid(10)}`;

function canvasPersistenceJournalKey(scope: string, writerId = canvasJournalWriterId) {
    return `${CANVAS_PERSISTENCE_JOURNAL_KEY}:user:${encodeURIComponent(scope)}:${writerId}`;
}

function createCanvasPersistenceJournal(scope: string, name: string, previous: CanvasProject[], next: CanvasProject[], token: number, baseRevision: number): CanvasPersistenceJournal {
    const before = new Map(previous.map((project) => [project.id, project]));
    const after = new Map(next.map((project) => [project.id, project]));
    const changed = new Set([...before.keys(), ...after.keys()].filter((id) => before.get(id) !== after.get(id)));
    return {
        version: 1, name, scope, writerId: canvasJournalWriterId, token,
        savedAt: new Date().toISOString(), baseRevision,
        baseProjects: previous.filter((project) => changed.has(project.id)),
        projects: next.filter((project) => changed.has(project.id)),
    };
}

function readCanvasPersistenceJournals(scope: string): CanvasPersistenceJournal[] {
    try {
        if (typeof window === "undefined") return [];
        const storage = window.localStorage;
        if (!storage) return [];
        const prefix = canvasPersistenceJournalKey(scope, "");
        const keys = new Set([canvasPersistenceJournalKey(scope)]);
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(prefix)) keys.add(key);
        }
        return [...keys].flatMap((key) => {
            const raw = storage.getItem(key);
            if (!raw) return [];
            try {
                const journal = JSON.parse(raw) as CanvasPersistenceJournal;
                return journal.version === 1 && journal.scope === scope && journal.name && typeof journal.writerId === "string"
                    && key === canvasPersistenceJournalKey(scope, journal.writerId) && Number.isSafeInteger(journal.token)
                    && Array.isArray(journal.projects) && Array.isArray(journal.baseProjects) ? [journal] : [];
            } catch { return []; }
        });
    } catch { return []; }
}

function writeCanvasPersistenceJournal(journal: CanvasPersistenceJournal) {
    try {
        if (typeof window === "undefined" || !window.localStorage) return false;
        const serialized = JSON.stringify(journal);
        // Large media stays in IndexedDB. Oversized recovery records trigger an
        // immediate full save and remain visibly pending until that write succeeds.
        if (new TextEncoder().encode(serialized).byteLength > CANVAS_JOURNAL_MAX_BYTES) return false;
        window.localStorage.setItem(canvasPersistenceJournalKey(journal.scope, journal.writerId), serialized);
        return true;
    } catch { return false; }
}

function clearCanvasPersistenceJournal(scope: string, token: number, writerId = canvasJournalWriterId) {
    try {
        if (typeof window === "undefined") return;
        const key = canvasPersistenceJournalKey(scope, writerId);
        const raw = window.localStorage?.getItem(key);
        // A previous save must never clear edits made while IndexedDB was writing.
        if (raw && (JSON.parse(raw) as CanvasPersistenceJournal).token <= token) window.localStorage.removeItem(key);
    } catch { /* The durable receipt makes a leftover journal safe to replay. */ }
}

function applyCanvasPersistenceJournal(document: CanvasStorageDocument, journal: CanvasPersistenceJournal) {
    if ((document.journalTokens?.[journal.writerId] ?? -1) >= journal.token) return { document, conflicts: [] };
    return rebaseCanvasProjects({ document, baseProjects: journal.baseProjects, localProjects: journal.projects, baseRevision: journal.baseRevision });
}

async function preserveLocalRebaseConflicts(scope: string, projects: CanvasProject[], conflicts: ReturnType<typeof rebaseCanvasProjects>["conflicts"]) {
    if (!conflicts.length || getActiveUserScope() !== scope) return;
    const ids = new Set(conflicts.map((conflict) => conflict.projectId || conflict.id));
    for (const project of projects.filter((item) => ids.has(item.id))) {
        useSyncProgressStore.getState().setProjectProgress(project.id, {
            phase: "pending",
            pendingChanges: 1,
            errorKind: "conflict",
            message: "其他标签页也修改了此画布，未确认操作会按字段重放",
        });
    }
}


function setCanvasLocalPersistenceProgress(projects: CanvasProject[], patch: Partial<SyncProjectProgress>) {
    const progress = useSyncProgressStore.getState();
    for (const project of projects) {
        const current = progress.syncingProjects[project.id];
        progress.setProjectProgress(project.id, { projectId: project.id, ...(current ? {} : { phase: "local" as const }), ...patch });
    }
}

function markCanvasLocalPersistencePending(projects: CanvasProject[], error?: string) {
    setCanvasLocalPersistenceProgress(projects, {
        localPhase: error ? "error" : "pending",
        localError: error,
        errorKind: error ? "local" : undefined,
        pendingWrites: 1,
    });
}

function markCanvasLocalPersistenceSaved(projects: CanvasProject[], savedAt: string) {
    setCanvasLocalPersistenceProgress(projects, { localPhase: "saved", localSavedAt: savedAt, localError: undefined, errorKind: undefined, pendingWrites: 0 });
}

function recordCanvasNodePersistenceCounts(before: CanvasProject[], after: CanvasProject[]) {
    const beforeById = new Map(before.map((project) => [project.id, project]));
    const afterById = new Map(after.map((project) => [project.id, project]));
    for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
        const nodesBefore = beforeById.get(id)?.nodes.length || 0;
        const nodesAfter = afterById.get(id)?.nodes.length || 0;
        if (nodesBefore === nodesAfter) continue;
        recordDiagnosticEvent({
            level: nodesAfter < nodesBefore ? "error" : "info",
            category: "action",
            code: nodesAfter < nodesBefore ? "canvas.persistence.nodes_decreased" : "canvas.persistence.nodes_changed",
            message: nodesAfter < nodesBefore ? "画布持久化后节点数量减少" : "画布持久化后节点数量变化",
            projectId: id,
            nodes_before: nodesBefore,
            nodes_after: nodesAfter,
        });
    }
}



let suppressCanvasStorePersistence = 0;
const canvasMemoryStates = new Map<string, PersistedCanvasState>();
const observedCanvasPersists = new Map<string, ObservedCanvasPersist>();
const queuedCanvasPersists = new Map<string, QueuedCanvasPersist>();
const canvasSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const canvasPersistTokens = new Map<string, number>();
type CanvasGenerationPersistenceAttempt = {
    previousNodes?: CanvasNodeData[];
    nodes?: CanvasNodeData[];
    previousChatSessions?: CanvasAssistantSession[];
    chatSessions?: CanvasAssistantSession[];
};
const pendingCanvasGenerationAttempts = new Map<string, Map<string, CanvasGenerationPersistenceAttempt>>();

type AsyncCanvasStorageLock = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

type CanvasStorageLockOptions = {
    requireCrossRealmLock?: boolean;
};

const CANVAS_STORAGE_LOCK_PREFIX = "yingce:canvas-generation-storage-lock:";
const canvasStorageTails = new Map<string, Promise<void>>();

function runWithBrowserCanvasStorageLock<T>(scope: string, operation: () => Promise<T>, options: CanvasStorageLockOptions) {
    const locks = typeof window !== "undefined" && typeof navigator !== "undefined" ? (navigator.locks as AsyncCanvasStorageLock | undefined) : undefined;
    const lockName = `${CANVAS_STORAGE_LOCK_PREFIX}${scope}`;
    if (locks) return locks.request(lockName, operation);
    if (options.requireCrossRealmLock && typeof window !== "undefined" && typeof document !== "undefined") {
        throw new Error("当前浏览器不支持跨标签存储锁，已停止画布生成持久化");
    }
    return operation();
}

/**
 * 串行化同一用户作用域的画布持久化，并在一次失败后允许队列继续前进。
 *
 * `pending` 必须把当前写入的真实结果返回给调用方；只有前一个 tail 的失败被
 * 转换成已处理的 void，才不会让一次旧失败永久毒化后续保存队列。
 */
export function withCanvasStorePersistenceLock<T>(scope: string, operation: () => Promise<T>, options: CanvasStorageLockOptions = {}): Promise<T> {
    const previous = canvasStorageTails.get(scope) ?? Promise.resolve();
    const pending = previous.then(() => undefined, () => undefined).then(() => runWithBrowserCanvasStorageLock(scope, operation, options));
    const tail = pending.then(
        () => undefined,
        () => undefined,
    );
    canvasStorageTails.set(scope, tail);
    void tail.finally(() => {
        if (canvasStorageTails.get(scope) === tail) canvasStorageTails.delete(scope);
    });
    return pending;
}

function clearCanvasSaveTimer(scope: string) {
    const timer = canvasSaveTimers.get(scope);
    if (!timer) return;
    clearTimeout(timer);
    canvasSaveTimers.delete(scope);
}

export function canvasStoreStorageRevision(scope: string) {
    return observedCanvasPersists.get(scope)?.revision ?? 0;
}

export function recordCanvasStorageDocument(scope: string, document: CanvasStorageDocument) {
    const savedAt = document.savedAt || new Date().toISOString();
    observedCanvasPersists.set(scope, {
        projects: document.state.projects,
        revision: document.storageRevision,
        savedAt,
    });
    if (getActiveUserScope() !== scope) return;
    const queued = queuedCanvasPersists.get(scope);
    if (queued || failedCanvasJournalRecoveries.has(scope)) {
        if (failedCanvasJournalRecoveries.has(scope)) return;
        markCanvasLocalPersistencePending(queued!.state.projects);
    } else {
        markCanvasLocalPersistenceSaved(document.state.projects, savedAt);
    }
}

export async function commitPendingCanvasStorePersistenceLocked(scope: string) {
    const storage = localForageStorageForScope(scope);
    let committed: CanvasStorageDocument | null = null;

    while (true) {
        const queued = queuedCanvasPersists.get(scope);
        if (!queued) return committed;

        const durable = parseCanvasStorageDocument(await storage.getItem(queued.name), queued.baseProjects);
        const rebased = rebaseCanvasProjects({
            document: durable,
            baseProjects: queued.baseProjects,
            localProjects: queued.state.projects,
            baseRevision: queued.baseRevision,
        });
        await preserveLocalRebaseConflicts(scope, queued.state.projects, rebased.conflicts);
        const savedAt = new Date().toISOString();
        const savedDocument = { ...rebased.document, savedAt, journalTokens: { ...durable.journalTokens, [canvasJournalWriterId]: queued.token } };
        await storage.setItem(queued.name, serializeCanvasStorageDocument(savedDocument));
        committed = savedDocument;
        clearCanvasPersistenceJournal(scope, queued.token);
        recordCanvasNodePersistenceCounts(durable.state.projects, savedDocument.state.projects);
        recordCanvasNodePersistenceCounts(queued.state.projects, savedDocument.state.projects);

        const latest = queuedCanvasPersists.get(scope);
        if (!latest || latest.token === queued.token) {
            if (latest?.token === queued.token) queuedCanvasPersists.delete(scope);
            recordCanvasStorageDocument(scope, savedDocument);
            return committed;
        }

        latest.baseProjects = queued.state.projects;
        latest.baseRevision = savedDocument.storageRevision;
        recordCanvasStorageDocument(scope, savedDocument);
    }
}

async function writeQueuedCanvasPersist(scope: string, _token: number) {
    try {
        await withCanvasStorePersistenceLock(scope, () => commitPendingCanvasStorePersistenceLocked(scope));
    } catch (error) {
        const queued = queuedCanvasPersists.get(scope);
        if (queued) markCanvasLocalPersistencePending(queued.state.projects, error instanceof Error ? error.message : "本地画布保存失败");
        throw error;
    }
}

export function pendingCanvasStorePersistence(scope: string) {
    const queued = queuedCanvasPersists.get(scope);
    return queued ? { projects: queued.state.projects, token: queued.token } : null;
}

export function rebasePendingCanvasStorePersistenceAfterGenerationCommitLocked(scope: string, committed: CanvasStorageDocument) {
    const queued = queuedCanvasPersists.get(scope);
    if (!queued) return;
    const latestMemory = canvasMemoryStates.get(scope)?.projects ?? queued.state.projects;
    // Dedicated commit 已确认 generation stamp；用同 scope 最新内存重新投影队列，避免同节点普通编辑被旧 durable 快照替换。
    queued.baseProjects = committed.state.projects;
    queued.baseRevision = committed.storageRevision;
    queued.state = ordinaryCanvasPersistenceState(scope, { projects: latestMemory }, committed.state.projects);
}

export function withCanvasStorePersistenceSuppressed<T>(operation: () => T) {
    suppressCanvasStorePersistence += 1;
    try {
        return operation();
    } finally {
        suppressCanvasStorePersistence -= 1;
    }
}

export function registerCanvasGenerationPersistenceAttempt(scope: string, projectId: string, effectKey: string, attempt: CanvasGenerationPersistenceAttempt) {
    const projectKey = `${scope}\0${projectId}`;
    const attempts = pendingCanvasGenerationAttempts.get(projectKey) ?? new Map<string, CanvasGenerationPersistenceAttempt>();
    attempts.set(effectKey, attempt);
    pendingCanvasGenerationAttempts.set(projectKey, attempts);
    const queued = queuedCanvasPersists.get(scope);
    if (queued) {
        const latestMemory = canvasMemoryStates.get(scope)?.projects ?? queued.state.projects;
        const durableProjects = observedCanvasPersists.get(scope)?.projects ?? queued.baseProjects;
        queued.state = ordinaryCanvasPersistenceState(scope, { projects: latestMemory }, durableProjects);
    }
    return () => {
        if (attempts.get(effectKey) !== attempt) return;
        attempts.delete(effectKey);
        if (!attempts.size) pendingCanvasGenerationAttempts.delete(projectKey);
    };
}

function hasUnconfirmedGenerationKey(localKeys?: string[], durableKeys?: string[]) {
    return Boolean(localKeys?.some((key) => !durableKeys?.includes(key)));
}

function samePersistenceValue(left: unknown, right: unknown) {
    return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function rollbackGenerationValue(previous: unknown, attempted: unknown, live: unknown, durable: unknown): unknown {
    if (samePersistenceValue(previous, attempted)) return live;
    if (samePersistenceValue(live, attempted)) return durable;
    if (!previous || !attempted || !live || !durable || Array.isArray(previous) || Array.isArray(attempted) || Array.isArray(live) || Array.isArray(durable) || typeof previous !== "object" || typeof attempted !== "object" || typeof live !== "object" || typeof durable !== "object") return live;

    const previousRecord = previous as Record<string, unknown>;
    const attemptedRecord = attempted as Record<string, unknown>;
    const liveRecord = live as Record<string, unknown>;
    const durableRecord = durable as Record<string, unknown>;
    const result: Record<string, unknown> = { ...durableRecord };
    for (const key of new Set([...Object.keys(previousRecord), ...Object.keys(attemptedRecord), ...Object.keys(liveRecord)])) {
        const previousHasKey = Object.hasOwn(previousRecord, key);
        const attemptedHasKey = Object.hasOwn(attemptedRecord, key);
        const liveHasKey = Object.hasOwn(liveRecord, key);
        if (!previousHasKey && !attemptedHasKey) {
            if (liveHasKey) result[key] = liveRecord[key];
            continue;
        }
        if (!previousHasKey && attemptedHasKey) {
            if (!liveHasKey || samePersistenceValue(liveRecord[key], attemptedRecord[key])) delete result[key];
            else result[key] = liveRecord[key];
            continue;
        }
        if (previousHasKey && !attemptedHasKey) {
            if (liveHasKey) result[key] = liveRecord[key];
            continue;
        }
        if (!liveHasKey) {
            delete result[key];
            continue;
        }
        const value = rollbackGenerationValue(previousRecord[key], attemptedRecord[key], liveRecord[key], durableRecord[key]);
        if (value === undefined) delete result[key];
        else result[key] = value;
    }
    return result;
}

function pendingGenerationAttempt(scope: string, projectId: string, effectKeys?: string[]) {
    const attempts = pendingCanvasGenerationAttempts.get(`${scope}\0${projectId}`);
    if (!attempts) return undefined;
    for (const effectKey of effectKeys || []) {
        const attempt = attempts.get(effectKey);
        if (attempt) return attempt;
    }
    return undefined;
}

function ordinaryCanvasProjectSnapshot(scope: string, project: CanvasProject, durableProject: CanvasProject | undefined) {
    if (!hasGenerationEffectKeys(project) && !hasGenerationEffectKeys(durableProject)) return project;
    const durableNodes = new Map((durableProject?.nodes || []).map((node) => [node.id, node]));
    const durableSessions = new Map((durableProject?.chatSessions || []).map((session) => [session.id, session]));
    let changed = false;
    let hasUnconfirmedGeneration = false;
    const nodes: CanvasNodeData[] = [];
    for (const node of project.nodes) {
        const durableNode = durableNodes.get(node.id);
        const durableKeys = durableNode?.metadata?.generationEffectKeys;
        const localKeys = node.metadata?.generationEffectKeys;
        if (durableProject && hasUnconfirmedGenerationKey(localKeys, durableKeys)) {
            hasUnconfirmedGeneration = true;
            changed = true;
            if (durableNode) {
                const attempt = pendingGenerationAttempt(scope, project.id, localKeys);
                const previousNode = attempt?.previousNodes?.find((candidate) => candidate.id === node.id);
                const attemptedNode = attempt?.nodes?.find((candidate) => candidate.id === node.id);
                // durableNode comes from the observed storage snapshot. Never mutate that snapshot while
                // rebuilding a failed generation, otherwise a later retry observes a partially rolled-back base.
                const rolledBack = previousNode && attemptedNode
                    ? (rollbackGenerationValue(previousNode, attemptedNode, node, durableNode) as CanvasNodeData)
                    : { ...durableNode, metadata: durableNode.metadata ? { ...durableNode.metadata } : undefined };
                const metadata = { ...(rolledBack.metadata || {}) };
                if (durableKeys?.length) metadata.generationEffectKeys = [...durableKeys];
                else delete metadata.generationEffectKeys;
                nodes.push({ ...rolledBack, metadata });
            } else {
                // There is no durable ancestor for a locally-created result.
                // Preserve it in the recovery snapshot; the effect key makes a
                // later replay idempotent and the user must not lose the node.
                nodes.push(node);
            }
            continue;
        }
        if (sameGenerationEffectKeys(localKeys, durableKeys)) {
            nodes.push(node);
            continue;
        }
        changed = true;
        const metadata = { ...(node.metadata || {}) };
        if (durableKeys?.length) metadata.generationEffectKeys = [...durableKeys];
        else delete metadata.generationEffectKeys;
        nodes.push({ ...node, metadata });
    }
    const chatSessions: CanvasAssistantSession[] = [];
    for (const session of project.chatSessions) {
        const durableSession = durableSessions.get(session.id);
        const durableKeys = durableSession?.generationEffectKeys;
        if (durableProject && hasUnconfirmedGenerationKey(session.generationEffectKeys, durableKeys)) {
            hasUnconfirmedGeneration = true;
            changed = true;
            if (durableSession) {
                const attempt = pendingGenerationAttempt(scope, project.id, session.generationEffectKeys);
                const previousSession = attempt?.previousChatSessions?.find((candidate) => candidate.id === session.id);
                const attemptedSession = attempt?.chatSessions?.find((candidate) => candidate.id === session.id);
                const rolledBack = previousSession && attemptedSession
                    ? (rollbackGenerationValue(previousSession, attemptedSession, session, durableSession) as CanvasAssistantSession)
                    : { ...durableSession, generationEffectKeys: durableSession.generationEffectKeys ? [...durableSession.generationEffectKeys] : undefined };
                if (durableKeys?.length) rolledBack.generationEffectKeys = [...durableKeys];
                else delete rolledBack.generationEffectKeys;
                chatSessions.push(rolledBack);
            }
            continue;
        }
        if (sameGenerationEffectKeys(session.generationEffectKeys, durableKeys)) {
            chatSessions.push(session);
            continue;
        }
        changed = true;
        const nextSession = { ...session };
        if (durableKeys?.length) nextSession.generationEffectKeys = [...durableKeys];
        else delete nextSession.generationEffectKeys;
        chatSessions.push(nextSession);
    }
    if (durableProject && hasUnconfirmedGeneration) {
        const localConnectionIds = new Set(project.connections.map((connection) => connection.id));
        return {
            ...project,
            nodes,
            // Connection/active-chat records carry no effect stamp provenance. Keep
            // local connections and append durable-only ones instead of replacing
            // the whole list and dropping edits made during generation.
            connections: [...project.connections, ...durableProject.connections.filter((connection) => !localConnectionIds.has(connection.id))],
            chatSessions,
            activeChatId: durableProject.activeChatId,
        };
    }
    return changed ? { ...project, nodes, chatSessions } : project;
}

function hasGenerationEffectKeys(value: CanvasProject | undefined) {
    if (!value) return false;
    return value.nodes.some((node) => Boolean(node.metadata?.generationEffectKeys?.length))
        || value.chatSessions.some((session) => Boolean(session.generationEffectKeys?.length));
}

function sameGenerationEffectKeys(left?: readonly string[], right?: readonly string[]) {
    if (left === right) return true;
    if (!left?.length && !right?.length) return true;
    if (!left || !right || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function ordinaryCanvasPersistenceState(scope: string, state: PersistedCanvasState, durableProjects: CanvasProject[]) {
    const durableById = new Map(durableProjects.map((project) => [project.id, project]));
    return {
        projects: state.projects.map((project) => ordinaryCanvasProjectSnapshot(scope, project, durableById.get(project.id))),
    };
}

export function reconcileCanvasGenerationFailure(scope: string, durableProjects: CanvasProject[]) {
    if (getActiveUserScope() !== scope) return;
    const projects = ordinaryCanvasPersistenceState(scope, { projects: useCanvasStore.getState().projects }, durableProjects).projects;
    withCanvasStorePersistenceSuppressed(() => {
        useCanvasStore.setState({ projects });
    });
}

const failedCanvasJournalRecoveries = new Map<string, string>();

async function recoverCanvasPersistenceJournalLocked(scope: string, name: string, initial: CanvasStorageDocument) {
    const journals = readCanvasPersistenceJournals(scope).filter((journal) => journal.name === name)
        .sort((left, right) => left.savedAt.localeCompare(right.savedAt) || left.writerId.localeCompare(right.writerId) || left.token - right.token);
    if (!journals.length) return initial;
    const storage = localForageStorageForScope(scope);
    let durable = parseCanvasStorageDocument(await storage.getItem(name), initial.state.projects);
    for (const journal of journals) {
        const rebased = applyCanvasPersistenceJournal(durable, journal);
        await preserveLocalRebaseConflicts(scope, journal.projects, rebased.conflicts);
        const saved = { ...rebased.document, savedAt: new Date().toISOString(), journalTokens: { ...rebased.document.journalTokens, [journal.writerId]: Math.max(journal.token, durable.journalTokens?.[journal.writerId] ?? 0) } };
        await storage.setItem(name, serializeCanvasStorageDocument(saved));
        clearCanvasPersistenceJournal(scope, journal.token, journal.writerId);
        recordCanvasNodePersistenceCounts(durable.state.projects, saved.state.projects);
        durable = saved;
    }
    failedCanvasJournalRecoveries.delete(scope);
    return durable;
}

async function recoverCanvasPersistenceJournal(scope: string, name: string, initial: CanvasStorageDocument) {
    try {
        return await withCanvasStorePersistenceLock(scope, () => recoverCanvasPersistenceJournalLocked(scope, name, initial));
    } catch (error) {
        failedCanvasJournalRecoveries.set(scope, name);
        const projects = new Map(initial.state.projects.map((project) => [project.id, project]));
        // Keep unsaved branches visible when recovery itself cannot be persisted.
        // Journals stay intact; a later flush retries their original three-way merge.
        for (const journal of readCanvasPersistenceJournals(scope).filter((item) => item.name === name)) {
            if ((initial.journalTokens?.[journal.writerId] ?? -1) >= journal.token) continue;
            for (const project of journal.projects) projects.set(project.id, project);
        }
        const recoveredProjects = [...projects.values()];
        if (getActiveUserScope() === scope) markCanvasLocalPersistencePending(recoveredProjects, error instanceof Error ? error.message : "本地恢复记录写入失败");
        return { ...initial, state: { projects: recoveredProjects } };
    }
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const scope = getActiveUserScope();
        const storage = localForageStorageForScope(scope);
        const value = await storage.getItem(name);
        let document = parseCanvasStorageDocument(value);
        document = await recoverCanvasPersistenceJournal(scope, name, document);
        if (!value && !document.state.projects.length) {
            canvasMemoryStates.set(scope, { projects: [] });
            observedCanvasPersists.set(scope, { projects: [], revision: document.storageRevision });
            return null;
        }
        const state = document.state as PersistedCanvasState;
        canvasMemoryStates.set(scope, state);
        recordCanvasStorageDocument(scope, document);
        return document as unknown as StorageValue<CanvasStore>;
    },
    setItem: (name, value) => {
        const scope = getActiveUserScope();
        const nextState = value.state as PersistedCanvasState;
        const previousState = canvasMemoryStates.get(scope);
        if (previousState?.projects === nextState.projects) return;
        canvasMemoryStates.set(scope, nextState);
        if (suppressCanvasStorePersistence) return;

        const queued = queuedCanvasPersists.get(scope);
        const observed = observedCanvasPersists.get(scope);
        const token = (canvasPersistTokens.get(scope) || 0) + 1;
        canvasPersistTokens.set(scope, token);
        const baseProjects = queued?.baseProjects ?? observed?.projects ?? previousState?.projects ?? [];
        const baseRevision = queued?.baseRevision ?? observed?.revision ?? 0;
        const queuedState = ordinaryCanvasPersistenceState(scope, nextState, observed?.projects ?? baseProjects);
        const journalBaseProjects = queued?.baseProjects ?? observed?.projects ?? previousState?.projects ?? [];
        const journal = createCanvasPersistenceJournal(scope, name, journalBaseProjects, queuedState.projects, token, baseRevision);
        const journalWritten = journal ? writeCanvasPersistenceJournal(journal) : false;
        queuedCanvasPersists.set(scope, {
            name,
            scope,
            baseProjects,
            baseRevision,
            state: queuedState,
            token,
            journal: journalWritten ? journal || undefined : undefined,
        });
        markCanvasLocalPersistencePending(nextState.projects, journal && !journalWritten ? "本地快速恢复记录写入失败，正在等待完整画布保存" : undefined);
        clearCanvasSaveTimer(scope);
        const timer = setTimeout(() => {
            if (canvasSaveTimers.get(scope) === timer) canvasSaveTimers.delete(scope);
            void writeQueuedCanvasPersist(scope, token).catch((error) => {
                // 自动保存无法把异常返回给原始状态更新调用方，但失败队列和 journal 会保留给下一次写入或显式 flush 重试。
                console.warn("画布本地持久化失败，已保留待写队列", { scope, error });
            });
        }, journalWritten ? 400 : 0);
        canvasSaveTimers.set(scope, timer);
    },
    removeItem: (name) => {
        const scope = getActiveUserScope();
        for (const journal of readCanvasPersistenceJournals(scope)) clearCanvasPersistenceJournal(scope, journal.token, journal.writerId);
        return localForageStorageForScope(scope).removeItem(name);
    },
};

export async function flushCanvasStorePersistence() {
    while (canvasStorageTails.size || queuedCanvasPersists.size || canvasSaveTimers.size) {
        for (const scope of [...canvasSaveTimers.keys()]) clearCanvasSaveTimer(scope);
        const writes = [...queuedCanvasPersists.values()].map(({ scope, token }) => writeQueuedCanvasPersist(scope, token));
        if (writes.length) await Promise.all(writes);
        else if (canvasStorageTails.size) await Promise.all([...canvasStorageTails.values()]);
    }
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布", projectId) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const appearanceDefault = readCanvasAppearanceDefault();
                const project: CanvasProject = {
                    id,
                    revision: 0,
                    projectId,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    appearance: appearanceDefault?.appearance ?? canvasAppearanceForPreset(useThemeStore.getState().theme),
                    backgroundMode: appearanceDefault?.backgroundMode || NEW_CANVAS_BACKGROUND_MODE,
                    showImageInfo: false,
                    viewport: initialViewport,
                    previsScenes: [],
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    revision: 0,
                    projectId: source.projectId,
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    starterMode: source.starterMode,
                    appearance: source.appearance ? normalizeCanvasAppearance(source.appearance, "dark") : undefined,
                    backgroundMode: source.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE,
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    previsScenes: source.previsScenes || [],
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => set((state) => {
                const current = state.projects.find((project) => project.id === id);
                const nextTitle = title.trim() || current?.title;
                if (!current || current.title === nextTitle) return state;
                return { projects: state.projects.map((project) => project === current ? { ...project, title: nextTitle!, updatedAt: new Date().toISOString() } : project) };
            }),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) => set((state) => {
                const current = state.projects.find((project) => project.id === id);
                if (!current) return state;
                const next = { ...current, ...patch };
                if (Object.keys(patch).every((key) => key === "viewport")) {
                    if (samePersistenceValue(current.viewport, next.viewport)) return state;
                    return { projects: state.projects.map((project) => project === current ? next : project) };
                }
                const contentChanged = !sameCanvasContent(current, next);
                if (!contentChanged && samePersistenceValue(current.viewport, next.viewport)) return state;
                if (contentChanged) next.updatedAt = new Date().toISOString();
                return { projects: state.projects.map((project) => project === current ? next : project) };
            }),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
