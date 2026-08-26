import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { parseCanvasStorageDocument, rebaseCanvasProjects, serializeCanvasStorageDocument, type CanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { DirectorScene } from "@/types/director";
import type { TimelineProject } from "@/types/timeline";

export type CanvasProject = {
    id: string;
    projectId?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    directorScenes: DirectorScene[];
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
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "projectId" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "directorScenes" | "timeline">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
export const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
type QueuedCanvasPersist = {
    name: string;
    scope: string;
    baseProjects: CanvasProject[];
    baseRevision: number;
    state: PersistedCanvasState;
    token: number;
};

type ObservedCanvasPersist = {
    projects: CanvasProject[];
    revision: number;
};

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

const CANVAS_STORAGE_LOCK_PREFIX = "infinite-canvas:canvas-generation-storage-lock:";
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

export function withCanvasStorePersistenceLock<T>(scope: string, operation: () => Promise<T>, options: CanvasStorageLockOptions = {}): Promise<T> {
    const previous = canvasStorageTails.get(scope) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => runWithBrowserCanvasStorageLock(scope, operation, options));
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
    observedCanvasPersists.set(scope, {
        projects: document.state.projects,
        revision: document.storageRevision,
    });
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
        }).document;
        await storage.setItem(queued.name, serializeCanvasStorageDocument(rebased));
        committed = rebased;
        recordCanvasStorageDocument(scope, rebased);

        const latest = queuedCanvasPersists.get(scope);
        if (!latest || latest.token === queued.token) {
            if (latest?.token === queued.token) queuedCanvasPersists.delete(scope);
            return committed;
        }

        latest.baseProjects = queued.state.projects;
        latest.baseRevision = rebased.storageRevision;
    }
}

async function writeQueuedCanvasPersist(scope: string, _token: number) {
    await withCanvasStorePersistenceLock(scope, () => commitPendingCanvasStorePersistenceLocked(scope));
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
            }
            continue;
        }
        if (JSON.stringify(localKeys) === JSON.stringify(durableKeys)) {
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
        if (JSON.stringify(session.generationEffectKeys) === JSON.stringify(durableKeys)) {
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
        return {
            ...project,
            nodes,
            // Connection/active-chat records carry no effect stamp provenance, so keep them fail-closed while any generation entity is unconfirmed.
            connections: durableProject.connections,
            chatSessions,
            activeChatId: durableProject.activeChatId,
        };
    }
    return changed ? { ...project, nodes, chatSessions } : project;
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

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const scope = getActiveUserScope();
        const value = await localForageStorageForScope(scope).getItem(name);
        if (!value) {
            canvasMemoryStates.set(scope, { projects: [] });
            observedCanvasPersists.set(scope, { projects: [], revision: 0 });
            return null;
        }
        const document = parseCanvasStorageDocument(value);
        const state = document.state as PersistedCanvasState;
        canvasMemoryStates.set(scope, state);
        recordCanvasStorageDocument(scope, document);
        return document as unknown as StorageValue<CanvasStore>;
    },
    setItem: (name, value) => {
        const scope = getActiveUserScope();
        const nextState = value.state as PersistedCanvasState;
        if (canvasMemoryStates.get(scope)?.projects === nextState.projects) return;
        canvasMemoryStates.set(scope, nextState);
        if (suppressCanvasStorePersistence) return;

        const queued = queuedCanvasPersists.get(scope);
        const observed = observedCanvasPersists.get(scope);
        const token = (canvasPersistTokens.get(scope) || 0) + 1;
        canvasPersistTokens.set(scope, token);
        const baseProjects = queued?.baseProjects ?? observed?.projects ?? [];
        queuedCanvasPersists.set(scope, {
            name,
            scope,
            baseProjects,
            baseRevision: queued?.baseRevision ?? observed?.revision ?? 0,
            // generationEffectKeys 由专用 generation durable commit 管理；普通队列只能携带已确认 stamp。
            state: ordinaryCanvasPersistenceState(scope, nextState, observed?.projects ?? baseProjects),
            token,
        });
        clearCanvasSaveTimer(scope);
        const timer = setTimeout(() => {
            if (canvasSaveTimers.get(scope) === timer) canvasSaveTimers.delete(scope);
            void writeQueuedCanvasPersist(scope, token).catch(() => undefined);
        }, 400);
        canvasSaveTimers.set(scope, timer);
    },
    removeItem: (name) => {
        const scope = getActiveUserScope();
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
                const project: CanvasProject = {
                    id,
                    projectId,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    directorScenes: [],
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    projectId: source.projectId,
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    directorScenes: source.directorScenes || [],
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
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
