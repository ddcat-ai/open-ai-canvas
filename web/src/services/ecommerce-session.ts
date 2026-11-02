import { createClientUUID } from "@/lib/client-id";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope, scopedStorageKey } from "@/lib/user-scope";
import { createEcommerceProject, saveEcommerceProject, type EcommerceDraft, type EcommercePlan, type EcommerceProject } from "@/services/api/ecommerce";

export type EcommerceWorkspaceCheckpoint = {
    sessionId: string;
    draft: EcommerceDraft;
    plan: EcommercePlan | null;
    project: EcommerceProject | null;
    creationMode: "ai" | "direct";
    autoGenerate: boolean;
    submittedDraft?: EcommerceDraft | null;
};

const WORKSPACE_KEY = "ecommerce-workspace";
const ACTIVE_PROJECT_KEY = "ecommerce-active-project";
const workspaces = new Map<string, EcommerceWorkspaceCheckpoint | null>();
const workspaceVersions = new Map<string, number>();
const workspaceWrites = new Map<string, Promise<void>>();
const workspaceListeners = new Map<string, Set<() => void>>();
const smallValues = new Map<string, string | null>();
const unpersistedSmallValues = new Set<string>();

function copy<T>(value: T): T {
    return structuredClone(value);
}

export function peekEcommerceWorkspace(scope: string): EcommerceWorkspaceCheckpoint | null {
    return copy(workspaces.get(scope) || null);
}

export function subscribeEcommerceWorkspace(scope: string, listener: () => void): () => void {
    const listeners = workspaceListeners.get(scope) || new Set<() => void>();
    listeners.add(listener);
    workspaceListeners.set(scope, listeners);
    return () => {
        listeners.delete(listener);
        if (!listeners.size) workspaceListeners.delete(scope);
    };
}

export async function readEcommerceWorkspace(scope: string): Promise<EcommerceWorkspaceCheckpoint | null> {
    if (workspaces.has(scope)) return peekEcommerceWorkspace(scope);
    const version = workspaceVersions.get(scope) || 0;
    const serialized = await localForageStorageForScope(scope).getItem(WORKSPACE_KEY);
    if ((workspaceVersions.get(scope) || 0) !== version) return peekEcommerceWorkspace(scope);
    let value: EcommerceWorkspaceCheckpoint | null = null;
    if (serialized) {
        try {
            const candidate = JSON.parse(serialized) as EcommerceWorkspaceCheckpoint;
            if (
                candidate &&
                typeof candidate.sessionId === "string" &&
                candidate.sessionId &&
                Array.isArray(candidate.draft?.references) &&
                Array.isArray(candidate.draft?.skus) &&
                (candidate.plan === null || Array.isArray(candidate.plan?.images)) &&
                (candidate.project === null || typeof candidate.project?.id === "string") &&
                (candidate.creationMode === "ai" || candidate.creationMode === "direct") &&
                typeof candidate.autoGenerate === "boolean" &&
                (candidate.submittedDraft == null || (Array.isArray(candidate.submittedDraft.references) && Array.isArray(candidate.submittedDraft.skus) && typeof candidate.submittedDraft.instruction === "string"))
            )
                value = candidate;
        } catch {
            /* A corrupt local checkpoint must not replace the server project. */
        }
    }
    workspaces.set(scope, value);
    return copy(value);
}

function queueWorkspaceWrite(scope: string, operation: () => Promise<unknown> | unknown): Promise<void> {
    const previous = workspaceWrites.get(scope) || Promise.resolve();
    const pending = previous
        .catch(() => undefined)
        .then(operation)
        .then(() => undefined);
    workspaceWrites.set(scope, pending);
    void pending
        .finally(() => {
            if (workspaceWrites.get(scope) === pending) workspaceWrites.delete(scope);
        })
        .catch(() => undefined);
    return pending;
}

export function writeEcommerceWorkspace(scope: string, checkpoint: EcommerceWorkspaceCheckpoint): Promise<void> {
    const previous = workspaces.get(scope);
    const sameOwner = previous && (previous.project && checkpoint.project ? previous.project.id === checkpoint.project.id : previous.sessionId === checkpoint.sessionId);
    const snapshot = copy(checkpoint);
    if (snapshot.submittedDraft === undefined && sameOwner && previous.submittedDraft !== undefined) snapshot.submittedDraft = copy(previous.submittedDraft);
    workspaces.set(scope, snapshot);
    workspaceVersions.set(scope, (workspaceVersions.get(scope) || 0) + 1);
    const pending = queueWorkspaceWrite(scope, () => localForageStorageForScope(scope).setItem(WORKSPACE_KEY, JSON.stringify(snapshot)));
    workspaceListeners.get(scope)?.forEach((listener) => listener());
    return pending;
}

export function clearEcommerceWorkspace(scope: string): Promise<void> {
    workspaces.set(scope, null);
    workspaceVersions.set(scope, (workspaceVersions.get(scope) || 0) + 1);
    const pending = queueWorkspaceWrite(scope, () => localForageStorageForScope(scope).removeItem(WORKSPACE_KEY));
    workspaceListeners.get(scope)?.forEach((listener) => listener());
    return pending;
}

function readSmallValue(scope: string, name: string): string | null {
    const key = scopedStorageKey(name, scope);
    if (unpersistedSmallValues.has(key)) return smallValues.get(key) || null;
    try {
        if (typeof window !== "undefined") return window.localStorage.getItem(key);
    } catch {
        /* Keep same-tab recovery available when browser storage is disabled. */
    }
    return smallValues.get(key) || null;
}

function writeSmallValue(scope: string, name: string, value: string | null): boolean {
    const key = scopedStorageKey(name, scope);
    smallValues.set(key, value);
    try {
        if (typeof window === "undefined") {
            unpersistedSmallValues.add(key);
            return false;
        }
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
        unpersistedSmallValues.delete(key);
        return true;
    } catch {
        unpersistedSmallValues.add(key);
        return false;
    }
}

export function getEcommerceActiveProject(scope: string): string | null {
    return readSmallValue(scope, ACTIVE_PROJECT_KEY);
}

export function setEcommerceActiveProject(scope: string, projectId: string | null): boolean {
    return writeSmallValue(scope, ACTIVE_PROJECT_KEY, projectId);
}

export function getEcommercePlanningReceipt(scope: string, projectId: string): string | null {
    return readSmallValue(scope, `ecommerce-planning-task:${projectId}`);
}

export function getEcommerceDirectionsReceipt(scope: string, projectId: string): string | null {
    return readSmallValue(scope, `ecommerce-directions-task:${projectId}`);
}

export function setEcommerceDirectionsReceipt(scope: string, projectId: string, taskId: string): boolean {
    return writeSmallValue(scope, `ecommerce-directions-task:${projectId}`, taskId);
}

export function setEcommercePlanningReceipt(scope: string, projectId: string, taskId: string): boolean {
    return writeSmallValue(scope, `ecommerce-planning-task:${projectId}`, taskId);
}

export function clearEcommercePlanningReceipt(scope: string, projectId: string): boolean {
    return writeSmallValue(scope, `ecommerce-planning-task:${projectId}`, null);
}

type SessionState = { project: EcommerceProject | null; tail: Promise<void>; submitting: boolean };
export type EcommerceSessionDependencies = {
    createProject: typeof createEcommerceProject;
    saveProject: typeof saveEcommerceProject;
    activeScope: () => string;
};
const defaultDependencies: EcommerceSessionDependencies = {
    createProject: createEcommerceProject,
    saveProject: saveEcommerceProject,
    activeScope: getActiveUserScope,
};
const sessions = new Map<string, SessionState>();
const projectSessions = new Map<string, SessionState>();

export function createEcommerceSession(scope: string, initialProject?: EcommerceProject | null, sessionId: string = createClientUUID(), dependencies: EcommerceSessionDependencies = defaultDependencies) {
    if (!scope || scope === "guest") throw new Error("请先登录后恢复电商项目");
    const sessionKey = scopedStorageKey(`ecommerce-session:${sessionId}`, scope);
    const projectKey = (id: string) => scopedStorageKey(`ecommerce-project:${id}`, scope);
    const state = (initialProject ? projectSessions.get(projectKey(initialProject.id)) : undefined) || sessions.get(sessionKey) || { project: null, tail: Promise.resolve(), submitting: false };
    sessions.set(sessionKey, state);
    const adopt = (project: EcommerceProject) => {
        if (state.project && state.project.id !== project.id) throw new Error("电商项目已切换，请使用对应项目会话");
        if (!state.project || project.revision >= state.project.revision) state.project = copy(project);
        projectSessions.set(projectKey(project.id), state);
    };
    if (initialProject) adopt(initialProject);
    const assertScope = () => {
        if (dependencies.activeScope() !== scope) throw new Error("登录账号已切换，已停止保存原账号电商项目");
    };
    return {
        id: sessionId,
        scope,
        get project(): EcommerceProject | null {
            return copy(state.project);
        },
        get submitting(): boolean {
            return state.submitting;
        },
        beginSubmission(): boolean {
            assertScope();
            if (state.submitting) return false;
            state.submitting = true;
            workspaceListeners.get(scope)?.forEach((listener) => listener());
            return true;
        },
        endSubmission(): void {
            if (!state.submitting) return;
            state.submitting = false;
            workspaceListeners.get(scope)?.forEach((listener) => listener());
        },
        adopt,
        save(draft: EcommerceDraft, plan: EcommercePlan | null): Promise<EcommerceProject> {
            const draftSnapshot = copy(draft);
            const planSnapshot = copy(plan);
            const operation = state.tail
                .catch(() => undefined)
                .then(async () => {
                    assertScope();
                    if (!state.project) {
                        const created = await dependencies.createProject();
                        adopt(created);
                        assertScope();
                    }
                    assertScope();
                    const saved = await dependencies.saveProject(state.project!, draftSnapshot, planSnapshot);
                    adopt(saved);
                    assertScope();
                    return copy(saved);
                });
            state.tail = operation.then(
                () => undefined,
                () => undefined,
            );
            return operation;
        },
    };
}

export type EcommerceSession = ReturnType<typeof createEcommerceSession>;
