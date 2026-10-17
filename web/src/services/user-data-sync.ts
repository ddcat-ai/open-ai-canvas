import { canonicalize } from "json-canonicalize";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { deleteRemoteAssets, deleteRemoteCanvasProject, applyRemoteCanvasOperations, getRemoteAsset, getRemoteAssetsByIds, getRemoteCanvasProject, getRemoteUserDataSnapshot, listRemoteAssetsPage, upsertRemoteAsset } from "@/services/api/user-data";
import type { CanvasOperation, CanvasOperationsRequest } from "@/services/api/user-data";
import { ApiError } from "@/services/api/request";
import { canvasContentHash, sameCanvasContent } from "@/lib/canvas/canvas-content";
import { rebaseCanvasLocalEdits } from "@/lib/canvas/canvas-sync-rebase";
import { fenceRejectedTaskTimestampMutation, repairLegacyTaskIdFence } from "@/lib/canvas/canvas-task-mutation";
import { getActiveUserScope } from "@/lib/user-scope";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { appQueryClient } from "@/lib/query-client";
import { parseAssetRecordList } from "@/lib/asset-record";
import { rebaseAssetSnapshot } from "@/lib/asset-storage-revision";
import { assetForRemoteSync } from "@/lib/asset-remote-sync";
import type { Asset } from "@/stores/use-asset-store";
import { flushAssetStorePersistence, getGenerationAssetDefaults, useAssetStore } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { repairMissingCanvasAssets, rebindInconsistentCanvasAssets } from "@/services/canvas-asset-repair";
import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import { applyAgentCanvasPatch, mergeThreeWayValue, type AgentCanvasPatch } from "@/lib/canvas/agent-canvas-patch";
import { collectLocalMediaKeys, ensureRemoteResourceReferences, restoreRemoteTextNodeContents } from "./user-data-sync-media";
import { submitCanvasMutationBatches, type CanvasMutationBatchState } from "./canvas-mutation-batches";
import { canvasEditLeases } from "./canvas-edit-leases";
import { CanvasSyncPendingError, createSyncSingleFlight, waitForCanvasSync, rememberSyncRecovery } from "@/lib/canvas/sync-recovery";

const syncSingleFlight = createSyncSingleFlight();

export { numberValue } from "./user-data-sync-media";

let activeRemoteUserId = "";
type RemoteUserDataPhase = "inactive" | "hydrating" | "ready" | "failed";

let remoteUserDataPhase: RemoteUserDataPhase = "inactive";
let syncTimer: number | null = null;
let syncPromise: Promise<void> | null = null;
let syncQueued = false;
let autoSyncQueued = false;
let syncRetryAttempt = 0;
let remoteOperationTail: Promise<void> = Promise.resolve();
let subscriptionsInstalled = false;
let acknowledgedAssets = new Map<string, Asset>();
let acknowledgedProjects = new Map<string, CanvasProject>();
type PendingCanvasMutation = CanvasMutationBatchState & { projectId: string; baseline?: CanvasProject; prepared: CanvasProject; localPrepared?: CanvasProject; rebaseSource?: CanvasProject; editVersions?: Record<string, number>; editSession?: string; createdAt: string };
const pendingCanvasMutations = new Map<string, PendingCanvasMutation>();
const pendingCanvasMutationKey = "yingce:canvas-mutation-journal";
const confirmedCanvasBaselineKey = "yingce:canvas-confirmed-baselines";
const unbasedProjects = new Set<string>();
let syncFirstQueuedAt = 0;
let pendingJournalScope = "";
let pendingJournalLoaded = false;
let incrementalSession = false;
let sessionEpoch = 0;
const verifiedProjects = new Set<string>();
const remoteDeletedProjects = new Set<string>();
const verifiedAssets = new Set<string>();
type RemoteProjectLoad = { mode: "normal"; promise: Promise<CanvasProject | undefined> };
const remoteProjectLoadPromises = new Map<string, RemoteProjectLoad>();
const REMOTE_SYNC_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

export function remoteUserDataRetryDelay(attempt: number, retryAfterMs = 0) {
    const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
    const delay = REMOTE_SYNC_RETRY_DELAYS_MS[Math.min(normalizedAttempt, REMOTE_SYNC_RETRY_DELAYS_MS.length - 1)];
    return Math.max(delay, retryAfterMs);
}

async function loadPendingCanvasMutationJournal(scope = getActiveUserScope()) {
    if (pendingJournalLoaded && pendingJournalScope === scope) return;
    pendingJournalScope = scope;
    pendingJournalLoaded = false;
    pendingCanvasMutations.clear();
    const epoch = sessionEpoch;
    const raw = await localForageStorageForScope(scope).getItem(pendingCanvasMutationKey);
    if (epoch !== sessionEpoch || scope !== getActiveUserScope()) return;
    if (!raw) {
        pendingJournalLoaded = true;
        return;
    }
    try {
        const entries = JSON.parse(raw) as PendingCanvasMutation[];
        let repaired = false;
        if (!Array.isArray(entries)) throw new Error("画布待同步记录格式无效，已保留原记录");
        for (const entry of entries) {
            if (!(entry?.projectId && entry.request?.mutationId && Array.isArray(entry.request.operations))) throw new Error("画布待同步请求格式无效，已保留原记录");
            const request = repairPendingCanvasMutationRequest(entry.request, entry.baseline, entry.prepared);
            repaired ||= request !== entry.request;
            pendingCanvasMutations.set(entry.projectId, request === entry.request ? entry : { ...entry, request });
        }
        if (repaired) await persistPendingCanvasMutationJournal();
        pendingJournalLoaded = true;
    } catch (error) {
        pendingJournalLoaded = false;
        throw error;
    }
}

/**
 * 修复旧版生成器写入 journal 的无效请求，这些请求服务端必然拒绝：
 * 1. 新画布请求在 create_canvas.patch 之后又追加了同字段 set_field（beforeValue 缺失或为 null），
 *    服务端先创建字段再校验基线，必然冲突；这些 set_field 与 patch 重复，直接移除。
 * 2. 已有画布的 set_field 因 undefined 被 JSON 丢弃属性，补回 JSON null 还原原始意图。
 * 3. 节点补丁的 undefined 被序列化丢弃，造成空 patch/before；只从 journal 原始快照恢复，不能使用当前云端值替代基线。
 * 服务端校验失败会整笔回滚、不写 receipt，因此沿用原 mutationId 不会触发 canvas_mutation_id_reused。
 */
export function repairPendingCanvasMutationRequest(request: CanvasOperationsRequest, baseline?: CanvasProject, prepared?: CanvasProject): CanvasOperationsRequest {
    let changed = false;
    const create = request.operations.find((operation) => operation.type === "create_canvas");
    const createdFields = new Set(create && create.type === "create_canvas" ? Object.keys(create.patch || {}) : []);
    const kept = request.operations.filter((operation) => {
        if (operation.type === "set_field" && operation.field === "projectId" && (operation.value === null || operation.value === undefined) && operation.beforeValue === "") {
            // 空字符串和缺省 projectId 都表示未关联项目。旧版本把这次语义上的 no-op
            // 记录成 set_field，服务端按字面字段比较时会误报冲突；移除它不会丢弃编辑。
            changed = true;
            return false;
        }
        if (!create || operation.type !== "set_field" || !createdFields.has(operation.field)) return true;
        changed = true;
        return false;
    });
    const operations = kept
        .map((operation) => {
            if (operation.type === "patch_node" && (!Object.keys(operation.patch).length || !Object.keys(operation.before || {}).length)) {
                const beforeNode = baseline?.nodes.find((node) => node.id === operation.id);
                const afterNode = prepared?.nodes.find((node) => node.id === operation.id);
                // 空补丁或空基线必然被服务端拒绝且没有成功回执，沿用原 mutationId 安全重试。
                // 缺少原快照时不猜测旧值；有效请求不重新生成，以免改变已确认请求的摘要。
                if (beforeNode && afterNode) {
                    const diff = diffCanvasObject(beforeNode as unknown as Record<string, unknown>, afterNode as unknown as Record<string, unknown>);
                    changed = true;
                    if (!Object.keys(diff.patch).length) return undefined;
                    return { ...operation, patch: diff.patch, before: diff.previous };
                }
            }
            if (operation.type !== "set_field") return operation;
            const hasBefore = Object.prototype.hasOwnProperty.call(operation, "beforeValue") && operation.beforeValue !== undefined;
            const hasValue = Object.prototype.hasOwnProperty.call(operation, "value") && operation.value !== undefined;
            if (hasBefore && hasValue) return operation;
            changed = true;
            return {
                ...operation,
                value: hasValue ? operation.value : canvasOperationValue(prepared?.[operation.field]),
                beforeValue: hasBefore ? operation.beforeValue : canvasOperationValue(baseline?.[operation.field]),
            };
        })
        .filter((operation): operation is CanvasOperation => operation !== undefined);
    return changed ? { ...request, operations } : request;
}

async function persistPendingCanvasMutationJournal() {
    if (!pendingJournalScope) return;
    const storage = localForageStorageForScope(pendingJournalScope);
    if (!pendingCanvasMutations.size) {
        await storage.removeItem(pendingCanvasMutationKey);
        return;
    }
    await storage.setItem(pendingCanvasMutationKey, JSON.stringify([...pendingCanvasMutations.values()]));
}

function newCanvasMutationId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function loadConfirmedCanvasBaselines() {
    const scope = getActiveUserScope();
    const epoch = sessionEpoch;
    const raw = await localForageStorageForScope(scope).getItem(confirmedCanvasBaselineKey);
    if (!raw || scope !== getActiveUserScope() || epoch !== sessionEpoch) return;
    let projects: CanvasProject[];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        projects = parsed;
    } catch {
        return;
    }
    for (const project of projects) {
        if (!project?.id || !Array.isArray(project.nodes) || !Array.isArray(project.connections) || !project.remoteContentHash) continue;
        const hash = await canvasContentHash(project);
        if (scope !== getActiveUserScope() || epoch !== sessionEpoch) return;
        if (project.remoteContentHash === hash) acknowledgedProjects.set(project.id, project);
    }
}

async function persistConfirmedCanvasBaselines() {
    await localForageStorageForScope(getActiveUserScope()).setItem(confirmedCanvasBaselineKey, JSON.stringify([...acknowledgedProjects.values()]));
}

function rebaseCanvas(baseline: CanvasProject | undefined, remote: CanvasProject, local: CanvasProject) {
    if (sameCanvasContent(local, remote)) return { ...remote, viewport: local.viewport };
    if (!baseline) throw new Error("缺少可信的画布同步基线，已保留本地草稿并暂停提交");
    return rebaseCanvasLocalEdits(baseline, remote, local);
}

export async function initializeRemoteUserDataSession(userId: string) {
    await withRemoteUserDataSyncExclusive(async () => {
        resetRemoteUserDataSync();
        activeRemoteUserId = userId;
        await loadPendingCanvasMutationJournal();
        incrementalSession = true;
        await loadConfirmedCanvasBaselines();
        for (const project of useCanvasStore.getState().projects) {
            if (!acknowledgedProjects.has(project.id) && project.remoteContentHash === (await canvasContentHash(project))) acknowledgedProjects.set(project.id, project);
        }
        for (const pending of pendingCanvasMutations.values()) {
            if (pending.baseline) acknowledgedProjects.set(pending.projectId, pending.baseline);
        }
        acknowledgedAssets = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
        remoteUserDataPhase = "ready";
        if (pendingCanvasMutations.size) scheduleRemoteUserDataSync();
    });
}

function liveCanvasIfUnchanged(id: string, snapshot: CanvasProject | null | undefined) {
    const live = useCanvasStore.getState().openProject(id);
    if (live === snapshot) return live;
    if (!snapshot) return live ? undefined : null;
    return live && sameCanvasContent(live, snapshot) ? live : undefined;
}

export async function loadCanvasProjectForEditing(id: string, options: { onLoad?: (project: CanvasProject) => void } = {}) {
    const mode = "normal";
    const existing = remoteProjectLoadPromises.get(id);
    const existingRequest = existing?.promise;
    if (existingRequest) {
        return existingRequest.then(async (loaded) => {
            if (loaded) options.onLoad?.(loaded);
            return loaded;
        });
    }
    const epoch = sessionEpoch;
    const request = withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新打开画布");
        requireRemoteUserDataBaseline();
        const journal = pendingCanvasMutations.get(id);
        const pendingLocal = useCanvasStore.getState().openProject(id);
        if (journal && pendingLocal) {
            options.onLoad?.(pendingLocal);
            scheduleRemoteUserDataSync();
            return pendingLocal;
        }
        const scope = getActiveUserScope();
        const requireUnchangedLocal = (snapshot: CanvasProject | null | undefined, message: string) => {
            if (epoch !== sessionEpoch || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开画布");
            const live = liveCanvasIfUnchanged(id, snapshot);
            if (live === undefined) throw new Error(message);
            return live;
        };
        let remote: CanvasProject;
        try {
            const knownRemote = verifiedProjects.has(id) ? acknowledgedProjects.get(id) : undefined;
            remote = await restoreRemoteTextNodeContents((await getRemoteCanvasProject(id, knownRemote)).project);
        } catch (error) {
            if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新打开画布");
            const local = useCanvasStore.getState().openProject(id);
            if (error instanceof ApiError && error.status === 404 && local?.revision === 0) {
                options.onLoad?.(local);
                return local;
            }
            throw error;
        }
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新打开画布");
        await loadReferencedAssets(collectAssetIds(remote));
        const hash = await canvasContentHash(remote);
        if (epoch !== sessionEpoch || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开画布");
        const local = useCanvasStore.getState().openProject(id);
        const cachedClean = local?.remoteContentHash && local.remoteContentHash === (await canvasContentHash(local));
        const dirty = local && (!verifiedProjects.has(id) && incrementalSession ? !cachedClean : !sameCanvasContent(acknowledgedProjects.get(id), local));
        let projected = remote;
        if (dirty && !sameCanvasContent(local, remote)) {
            const live = requireUnchangedLocal(local, "画布仍在更新，未确认操作已保留");
            const baseline = acknowledgedProjects.get(id) ?? pendingCanvasMutations.get(id)?.baseline;
            let merged: CanvasProject;
            try {
                if (!baseline) {
                    if (incrementalSession && !verifiedProjects.has(id)) {
                        const storage = localForageStorageForScope(scope);
                        const key = `yingce:canvas-unverified-recovery:${id}`;
                        const raw = await storage.getItem(key);
                        const previous: unknown = raw ? JSON.parse(raw) : [];
                        const copies = Array.isArray(previous) ? previous : [];
                        await storage.setItem(key, JSON.stringify([...copies.slice(-2), { project: live || local, savedAt: new Date().toISOString(), cloudRevision: remote.revision }]));
                    }
                    merged = { ...rebaseCanvasLocalEdits(undefined, remote, local), remoteContentHash: hash };
                } else if (!pendingCanvasMutations.get(id) && incrementalSession && !verifiedProjects.has(id) && !sameCanvasContent(baseline, remote) && baseline.remoteContentHash !== (await canvasContentHash(baseline))) {
                    const storage = localForageStorageForScope(scope);
                    const key = `yingce:canvas-unverified-recovery:${id}`;
                    const raw = await storage.getItem(key);
                    const previous: unknown = raw ? JSON.parse(raw) : [];
                    const copies = Array.isArray(previous) ? previous : [];
                    await storage.setItem(key, JSON.stringify([...copies.slice(-2), { project: live || local, savedAt: new Date().toISOString(), cloudRevision: remote.revision }]));
                    merged = { ...rebaseCanvasLocalEdits(baseline, remote, live || local), remoteContentHash: hash };
                } else {
                    merged = { ...rebaseCanvasLocalEdits(baseline, remote, live || local), remoteContentHash: hash };
                }
            } catch (error) {
                unbasedProjects.add(id);
                throw error;
            }
            const currentLive = requireUnchangedLocal(local, "画布仍在更新，正在同步最新编辑");
            merged = { ...merged, viewport: currentLive?.viewport || merged.viewport };
            unbasedProjects.delete(id);
            options.onLoad?.(merged);
            useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === id ? merged : item)) }));
            acknowledgedProjects.set(id, { ...remote, remoteContentHash: hash });
            verifiedProjects.add(id);
            await flushCanvasStorePersistence();
            await persistConfirmedCanvasBaselines();
            useSyncProgressStore.getState().setProjectProgress(id, { phase: "pending", cloudRevision: remote.revision, pendingChanges: 1, message: "保留本地未确认操作，等待自动重放" });
            scheduleRemoteUserDataSync();
            return merged;
        }
        // Editing/generation may continue during the network request or draft write.
        // Viewport-only updates are not document edits and must not block adopting cloud content.
        const currentLive = requireUnchangedLocal(local, "画布仍在更新，已保留本地内容");
        const project = { ...remote, viewport: currentLive?.viewport || local?.viewport || remote.viewport || { x: 0, y: 0, k: 1 }, remoteContentHash: hash };
        options.onLoad?.(project);
        acknowledgedProjects.set(id, { ...remote, viewport: project.viewport, remoteContentHash: hash });
        verifiedProjects.add(id);
        useCanvasStore.setState((state) => ({ projects: local ? state.projects.map((item) => (item.id === id ? project : item)) : [...state.projects, project] }));
        await flushCanvasStorePersistence();
        await persistConfirmedCanvasBaselines();
        const pending = pendingCanvasMutations.has(id) || !sameCanvasContent(remote, project);
        useSyncProgressStore.getState().setProjectProgress(id, { phase: pending ? "pending" : "done", cloudRevision: project.revision, pendingChanges: pending ? 1 : 0, message: pending ? "云端更新已合并，保留本地未确认操作" : "已确认云端画布基线" });
        if (pending) scheduleRemoteUserDataSync();
        return project;
    });
    const pending = { mode, promise: request } as RemoteProjectLoad;
    remoteProjectLoadPromises.set(id, pending);
    const clearPending = () => {
        if (remoteProjectLoadPromises.get(id) === pending) remoteProjectLoadPromises.delete(id);
    };
    void request.then(clearPending, clearPending);
    return request;
}

// Project remote changes into the live editor while retaining authored edits.
const agentCanvasListeners = new Set<(project: CanvasProject, previous: CanvasProject | undefined, source?: "sync" | "agent") => void>();

export function subscribeAgentCanvasRefresh(listener: (project: CanvasProject, previous: CanvasProject | undefined, source?: "sync" | "agent") => void) {
    agentCanvasListeners.add(listener);
    return () => {
        agentCanvasListeners.delete(listener);
    };
}

export async function refreshCanvasAfterAgent(id: string, source: "sync" | "agent" = "agent") {
    const epoch = sessionEpoch;
    return withRemoteUserDataSyncExclusive(async () => {
        if (!activeRemoteUserId) throw new Error("请先登录再刷新 Agent 画布结果");
        // A lost response may already include our submitted text. Resolve its
        // receipt before merging snapshots, or its insertion could be applied twice.
        if (pendingCanvasMutations.has(id)) {
            scheduleRemoteUserDataSync();
            return useCanvasStore.getState().openProject(id) || undefined;
        }
        const knownRemote = verifiedProjects.has(id) ? acknowledgedProjects.get(id) : undefined;
        const project = await restoreRemoteTextNodeContents((await getRemoteCanvasProject(id, knownRemote)).project);
        if (epoch !== sessionEpoch) throw new Error("账号已切换");
        const current = useCanvasStore.getState().projects.find((candidate) => candidate.id === id);
        const baseline = acknowledgedProjects.get(id);
        const cachedDirty = current && incrementalSession && !verifiedProjects.has(id) && current.remoteContentHash !== (await canvasContentHash(current));
        const baselineClean = baseline && baseline.remoteContentHash === (await canvasContentHash(baseline));
        if (epoch !== sessionEpoch) throw new Error("账号已切换");

        let projected = project;
        if (current && (cachedDirty || !sameCanvasContent(baseline, current)) && !sameCanvasContent(current, project)) {
            // A missing/out-of-order Agent delta is recoverable when local and remote
            // edits touch different fields. Rebase the cloud snapshot onto the live
            // editor before escalating to a user-visible conflict.
            if (!cachedDirty && current.revision === project.revision && baseline?.revision === project.revision && sameCanvasContent(baseline, project)) {
                useSyncProgressStore.getState().setProjectProgress(id, { phase: "pending", message: "本地修改等待保存到云端" });
                scheduleRemoteUserDataSync();
                return current;
            }
            try {
                if (!baseline || (cachedDirty && !baselineClean)) throw new Error("缺少画布合并基线");
                projected = rebaseCanvasLocalEdits(baseline, project, current);
            } catch (error) {
                await preserveAgentConflict(current);
                throw error instanceof Error ? error : new Error("Agent 更新与本地编辑存在不可自动合并的冲突");
            }
        }

        const hash = await canvasContentHash(project);
        projected = { ...projected, viewport: current?.viewport || project.viewport, remoteContentHash: hash };
        if (epoch !== sessionEpoch || useCanvasStore.getState().openProject(id) !== (current || null)) throw new Error("画布仍在更新，请重新同步 Agent 结果");
        try {
            if (!sameCanvasContent(current, projected)) {
                for (const listener of agentCanvasListeners) listener(projected, current, source);
            }
        } catch (error) {
            if (current) await preserveAgentConflict(current);
            throw error;
        }
        acknowledgedProjects.set(id, { ...project, viewport: projected.viewport, remoteContentHash: hash });
        verifiedProjects.add(id);
        useCanvasStore.setState((state) => ({ projects: [...state.projects.filter((candidate) => candidate.id !== id), projected] }));
        await flushCanvasStorePersistence();
        await persistConfirmedCanvasBaselines();
        const pending = !sameCanvasContent(project, projected);
        useSyncProgressStore.getState().setProjectProgress(id, { phase: pending ? "pending" : "done", message: pending ? "Agent 结果已合并，本地修改等待保存" : "已同步 Agent 画布结果" });
        if (pending) scheduleRemoteUserDataSync();
        return projected;
    });
}

export async function applyAgentCanvasPatches(id: string, patches: AgentCanvasPatch[]) {
    const epoch = sessionEpoch;
    return withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch || !activeRemoteUserId) throw new Error("账号已切换或未登录，已停止 Agent 画布同步");
        const baseline = acknowledgedProjects.get(id);
        const current = useCanvasStore.getState().projects.find((project) => project.id === id);
        if (!baseline || !current) throw new Error("缺少画布同步基线，需要重新读取画布");
        let remote = baseline;
        let projected = current;
        // A rejected delta requests a snapshot through createAgentCanvasSync.
        // Only that reconciliation can distinguish stale replay from a conflict.
        if (incrementalSession && !verifiedProjects.has(id) && baseline.remoteContentHash !== (await canvasContentHash(baseline))) throw new Error("本地画布基线尚未核对，等待自动校准");
        if (current.revision !== baseline.revision || !Number.isSafeInteger(baseline.revision)) throw new Error("画布同步基线已变化");
        const orderedPatches: AgentCanvasPatch[] = [];
        const seenRevisions = new Set<number>();
        for (const patch of [...patches].sort((left, right) => (left.revision ?? 0) - (right.revision ?? 0))) {
            if (!Number.isSafeInteger(patch.revision) || !Number.isSafeInteger(patch.baseRevision)) throw new Error("Agent 增量缺少版本，请重新读取画布");
            if (seenRevisions.has(patch.revision!)) continue;
            seenRevisions.add(patch.revision!);
            orderedPatches.push(patch);
        }
        for (const patch of orderedPatches) {
            if (patch.revision! <= remote.revision!) continue;
            if (patch.baseRevision !== remote.revision || patch.revision !== patch.baseRevision! + 1) throw new Error("Agent 画布增量版本不连续，请重新读取画布");
            remote = { ...applyAgentCanvasPatch(remote, patch), revision: patch.revision };
            projected = { ...applyAgentCanvasPatch(projected, patch), revision: patch.revision };
        }
        if (projected === current) return current;
        const hash = await canvasContentHash(remote);
        if (epoch !== sessionEpoch || useCanvasStore.getState().openProject(id) !== current) throw new Error("画布仍在更新，请重新同步 Agent 结果");
        remote = { ...remote, remoteContentHash: hash };
        projected = { ...projected, remoteContentHash: hash };
        if (!sameCanvasContent(projected, current)) {
            for (const listener of agentCanvasListeners) listener(projected, current);
        }
        acknowledgedProjects.set(id, remote);
        verifiedProjects.add(id);
        if (projected === current) return current;
        useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === id ? projected : project)) }));
        await persistConfirmedCanvasBaselines();
        // Zustand persistence already coalesces store writes behind a short timer.
        // Agent output can arrive in bursts; waiting here would serialize every
        // patch batch behind a full-canvas IndexedDB write and compete with paint.
        useSyncProgressStore.getState().setProjectProgress(id, { phase: sameCanvasContent(remote, projected) ? "done" : "pending", message: "已同步 Agent 画布结果" });
        return projected;
    });
}

async function preserveAgentConflict(project: CanvasProject) {
    useSyncProgressStore.getState().setProjectProgress(project.id, { phase: "pending", pendingChanges: 1, message: "Agent 修改等待按原操作自动重放" });
    scheduleRemoteUserDataSync();
}

function pendingMutationCreatesCanvas(mutation: PendingCanvasMutation | undefined) {
    return mutation?.request.operations[0]?.type === "create_canvas";
}

export function mergeRemoteAssetsWithLocalPending(remoteAssets: Asset[], localAssets: Asset[]) {
    const merged = new Map(remoteAssets.map((asset) => [asset.id, asset]));
    for (const local of localAssets) {
        const remote = merged.get(local.id);
        // A local asset absent from the snapshot is an unacknowledged create.
        // A same-ID difference is an unconfirmed edit. Keep both kinds visible;
        // the normal save path will validate/rebase them against the server.
        if (!remote || !sameEntitySnapshot(remote, local)) merged.set(local.id, local);
    }
    return [...merged.values()];
}

async function waitForRemoteProjectLoads(projectIds?: string | readonly string[]) {
    const selected = projectIds === undefined ? undefined : new Set(typeof projectIds === "string" ? [projectIds] : projectIds);
    const pending = [...remoteProjectLoadPromises].filter(([id]) => selected === undefined || selected.has(id)).map(([, item]) => item.promise);
    if (pending.length) await Promise.all(pending);
}

export async function loadAssetLibraryPage(options: Parameters<typeof listRemoteAssetsPage>[0]) {
    const result = await listRemoteAssetsPage(options);
    // 分页列表是展示数据，不是同步快照。不要把每一页都合并进全局
    // asset store，否则滚动/翻页会不断重建并持久化整个素材数组。
    // 真正被画布引用的素材仍由 loadAssetsForUse 按 ID 拉取并写入 store。
    return { ...result, assets: parseAssetRecordList(result.assets) };
}

function acceptRemoteAssets(remoteAssets: Asset[], refresh = false) {
    const assets = parseAssetRecordList(remoteAssets);
    const current = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
    for (const asset of assets) {
        const local = current.get(asset.id);
        const baseline = acknowledgedAssets.get(asset.id);
        const dirty = local && !sameEntitySnapshot(baseline, local);
        if (dirty && !refresh) continue;
        const next =
            dirty && local
                ? parseAssetRecordList(
                      rebaseAssetSnapshot({
                          document: { state: { assets: [asset] }, version: 0, storageRevision: 0, tombstones: { assets: {} } },
                          baseAssets: baseline ? [baseline] : [],
                          localAssets: [local],
                          baseRevision: 0,
                      }).state.assets,
                  )[0]
                : asset;
        acknowledgedAssets.set(asset.id, asset);
        verifiedAssets.add(asset.id);
        current.set(asset.id, next);
    }
    useAssetStore.setState({ assets: [...current.values()] });
}

function collectAssetIds(value: unknown, ids = new Set<string>()): Set<string> {
    if (!value || typeof value !== "object") return ids;
    for (const [key, child] of Object.entries(value)) {
        if (key === "assetId" && typeof child === "string" && child) ids.add(child);
        else if (child && typeof child === "object") collectAssetIds(child, ids);
    }
    return ids;
}

async function loadReferencedAssets(ids: Iterable<string>, refresh = false) {
    const epoch = sessionEpoch;
    const loadedIds = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
    const pending = [...new Set(ids)].filter((id) => refresh || !loadedIds.has(id) || !verifiedAssets.has(id));
    const records: Asset[] = [];
    for (let offset = 0; offset < pending.length; offset += 100) {
        const { assets } = await getRemoteAssetsByIds(pending.slice(offset, offset + 100));
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新读取素材");
        acceptRemoteAssets(assets, refresh);
        records.push(...assets);
    }
    return records;
}

export async function loadAssetsForUse(ids: Iterable<string>, options?: { refresh?: boolean }) {
    const epoch = sessionEpoch;
    const requestedIds = [...new Set(ids)];
    await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新读取素材");
        if (options?.refresh && !activeRemoteUserId) throw new Error("请登录后刷新素材");
        if (activeRemoteUserId) await loadReferencedAssets(requestedIds, options?.refresh);
        const available = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
        if (requestedIds.some((id) => !available.has(id) || (activeRemoteUserId && !verifiedAssets.has(id)))) throw new Error("部分素材不存在或无权访问，请重新选择素材");
    });
}

export async function syncRemoteUserData(userId?: string | null) {
    const epoch = sessionEpoch;
    const scope = getActiveUserScope();
    const ensureSession = () => {
        if (epoch !== sessionEpoch || scope !== getActiveUserScope()) throw new Error("账号已切换，已停止旧会话恢复");
    };
    // 登录/切换账号时，服务端快照建立新的远端基线；本地 IndexedDB 只负责首屏缓存，
    // 不能把服务端已经删除或当前用户无权访问的实体重新补回去。后续增量保存必须基于这份基线做冲突校验。
    await withRemoteUserDataSyncExclusive(async () => {
        ensureSession();
        incrementalSession = false;
        if (activeRemoteUserId !== (userId || "")) acknowledgedProjects.clear();
        activeRemoteUserId = userId || "";
        if (activeRemoteUserId) await loadPendingCanvasMutationJournal();
        await loadConfirmedCanvasBaselines();
        acknowledgedAssets = new Map();
        if (!activeRemoteUserId) {
            remoteUserDataPhase = "inactive";
            return;
        }
        remoteUserDataPhase = "hydrating";
        try {
            // 登录只拉一次聚合快照。摘要列表再逐条请求详情会把 N 条数据放大成 2N+2 个请求，
            // 并且会在登录阶段同时触发大量媒体解析，任何一项失败都会污染登录结果。
            const snapshot = await getRemoteUserDataSnapshot();
            ensureSession();
            const localProjects = useCanvasStore.getState().projects;
            const localAssets = useAssetStore.getState().assets;
            const remoteById = new Map(snapshot.projects.map((project) => [project.id, project]));
            // Convert cached local edits into the same durable operation journal before replacing the cache.
            for (const local of localProjects) {
                const pending = pendingCanvasMutations.get(local.id);
                const remote = remoteById.get(local.id);
                if (!remote) {
                    if (pending && !pendingMutationCreatesCanvas(pending)) {
                        remoteDeletedProjects.add(local.id);
                        useSyncProgressStore.getState().setProjectProgress(local.id, { phase: "error", errorKind: "conflict", pendingChanges: 1, message: "云端画布已删除，无法保存" });
                        continue;
                    }
                    if (!pending && (local.revision ?? 0) > 0) {
                        remoteDeletedProjects.add(local.id);
                        useSyncProgressStore.getState().setProjectProgress(local.id, { phase: "error", errorKind: "conflict", pendingChanges: 1, message: "云端画布已删除，无法保存" });
                        continue;
                    }
                }
                if (remote) remoteDeletedProjects.delete(local.id);
                if (pending) continue;
                const clean = local.remoteContentHash && local.remoteContentHash === (await canvasContentHash(local));
                if (clean || sameCanvasContent(local, remote)) continue;
                const baseline = acknowledgedProjects.get(local.id);
                if (remote && !baseline) {
                    unbasedProjects.add(local.id);
                    useSyncProgressStore.getState().setProjectProgress(local.id, { phase: "pending", errorKind: "conflict", pendingChanges: 1, message: "正在获取云端基线，当前内容可继续编辑" });
                    continue;
                }
                const operations = buildCanvasOperations(baseline, local);
                if (operations.length) {
                    pendingCanvasMutations.set(local.id, {
                        projectId: local.id,
                        request: { mutationId: newCanvasMutationId(), ...(baseline ? { baseRevision: baseline.revision } : {}), operations },
                        baseline,
                        prepared: local,
                        localPrepared: local,
                        createdAt: new Date().toISOString(),
                    });
                }
            }
            await persistPendingCanvasMutationJournal();
            const remoteProjects = await Promise.all(
                snapshot.projects.map(async (project) => {
                    const local = localProjects.find((item) => item.id === project.id);
                    const remoteContentHash = await canvasContentHash(project);
                    const pending = pendingCanvasMutations.has(project.id);
                    if (!unbasedProjects.has(project.id))
                        useSyncProgressStore
                            .getState()
                            .setProjectProgress(project.id, { phase: pending ? "pending" : "done", cloudRevision: project.revision, pendingChanges: pending ? 1 : 0, message: pending ? "保留未确认画布操作，等待重放" : "已保存到云端" });
                    return { ...project, viewport: local?.viewport || project.viewport || { x: 0, y: 0, k: 1 }, remoteContentHash };
                }),
            );
            const orphanProjects = localProjects.filter((project) => remoteDeletedProjects.has(project.id)).map((project) => ({ ...project, remoteContentHash: project.remoteContentHash }));
            // A revision-0 project can be absent from the cloud snapshot because its
            // create mutation has not been acknowledged yet. Keep it visible so the
            // pending journal can replay against the next session.
            const pendingProjects = localProjects
                .filter((project) => {
                    const pending = pendingCanvasMutations.get(project.id);
                    return Boolean(pending && pendingMutationCreatesCanvas(pending) && !remoteById.has(project.id));
                })
                .map((project) => ({ ...project, remoteContentHash: project.remoteContentHash }));
            const projects = [
                ...remoteProjects.map((project) => {
                    const pending = pendingCanvasMutations.get(project.id);
                    const local = localProjects.find((item) => item.id === project.id);
                    return (pending || unbasedProjects.has(project.id)) && local ? local : project;
                }),
                ...orphanProjects,
                ...pendingProjects.filter((project) => !remoteDeletedProjects.has(project.id)),
            ];
            const remoteAssets = parseAssetRecordList(snapshot.assets);
            const assets = mergeRemoteAssetsWithLocalPending(remoteAssets, localAssets);
            ensureSession();
            if (useCanvasStore.getState().projects !== localProjects) throw new CanvasSyncPendingError("当前编辑已保留，后台重新对齐云端");
            useCanvasStore.getState().replaceProjects(projects);
            useAssetStore.getState().replaceAssets(assets);
            await waitForCanvasSync(Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]));
            ensureSession();
            for (const project of remoteProjects) {
                // Unconfirmed drafts keep their original comparison baseline until replay succeeds.
                if (!pendingCanvasMutations.has(project.id) && !unbasedProjects.has(project.id)) acknowledgedProjects.set(project.id, project);
            }
            await waitForCanvasSync(persistConfirmedCanvasBaselines());
            ensureSession();
            acknowledgedAssets = new Map(remoteAssets.map((asset) => [asset.id, asset]));
            remoteUserDataPhase = "ready";
            syncRetryAttempt = 0;
            if (pendingCanvasMutations.size || unbasedProjects.size) scheduleRemoteUserDataSync();
        } catch (error) {
            ensureSession();
            remoteUserDataPhase = "failed";
            scheduleRemoteUserDataHydrationRetry(error);
            throw error;
        }
    });
}

export function installRemoteUserDataAutoSync() {
    if (subscriptionsInstalled) return;
    subscriptionsInstalled = true;
    if (typeof window !== "undefined") window.addEventListener("online", () => {
        if (remoteUserDataPhase === "ready") scheduleRemoteUserDataSync();
        else if (activeRemoteUserId && remoteUserDataPhase === "failed") void syncRemoteUserData(activeRemoteUserId).catch(() => undefined);
    });
    useCanvasStore.subscribe((state, previous) => {
        if (state.projects === previous.projects) return;
        const before = new Map(previous.projects.map((project) => [project.id, project]));
        const changed = state.projects.filter((project) => !sameCanvasContent(before.get(project.id), project));
        // Viewport writes are local persistence only. They must never enqueue a
        // cloud sync, even while the local persistence queue is being flushed.
        if (!changed.length) return;
        if (remoteUserDataPhase === "ready") {
            for (const project of changed) {
                if (sameCanvasContent(acknowledgedProjects.get(project.id), project)) continue;
                useSyncProgressStore.getState().setProjectProgress(project.id, { phase: "pending", message: "有修改等待保存" });
            }
        }
        scheduleRemoteUserDataSync();
    });
    useAssetStore.subscribe((state, previous) => {
        if (state.assets !== previous.assets) scheduleRemoteUserDataSync();
    });
}

export function resetRemoteUserDataSync() {
    sessionEpoch += 1;
    // Old operations retain their epoch guards, but must never hold the next
    // account behind a stalled IndexedDB/network promise.
    remoteOperationTail = Promise.resolve();
    syncPromise = null;
    canvasEditLeases.reset();
    incrementalSession = false;
    verifiedProjects.clear();
    remoteDeletedProjects.clear();
    verifiedAssets.clear();
    remoteProjectLoadPromises.clear();
    activeRemoteUserId = "";
    remoteUserDataPhase = "inactive";
    acknowledgedAssets.clear();
    acknowledgedProjects.clear();
    unbasedProjects.clear();
    syncFirstQueuedAt = 0;
    pendingCanvasMutations.clear();
    pendingJournalScope = "";
    pendingJournalLoaded = false;
    if (syncTimer) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
    }
    syncRetryAttempt = 0;
    syncQueued = false;
    autoSyncQueued = false;
    useSyncProgressStore.getState().clearAll();
}

export function hasRemoteUserDataSyncSession() {
    return Boolean(activeRemoteUserId) && remoteUserDataPhase === "ready";
}

/**
 * 串行执行用户数据同步、账号切换和登出相关的远端操作。
 *
 * 前一个操作失败只影响它自己，不能让后续操作永远停在 rejected tail；当前操作的
 * 结果仍原样返回，由调用方决定如何提示或重试，避免同步层把写入失败伪装成成功。
 */
export function withRemoteUserDataSyncExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = remoteOperationTail
        .then(
            () => undefined,
            () => undefined,
        )
        .then(operation);
    remoteOperationTail = pending.then(
        () => undefined,
        () => undefined,
    );
    return pending;
}

export function scheduleRemoteUserDataSync() {
    if (!activeRemoteUserId || remoteUserDataPhase !== "ready") return;
    if (syncPromise) {
        autoSyncQueued = true;
        return;
    }
    autoSyncQueued = false;
    if (syncTimer) window.clearTimeout(syncTimer);
    if (!syncFirstQueuedAt) syncFirstQueuedAt = Date.now();
    syncTimer = window.setTimeout(
        () => {
            syncTimer = null;
            syncFirstQueuedAt = 0;
            void saveRemoteUserDataNow().catch((error) => console.warn("云端自动同步失败", error));
        },
        Math.min(1200, Math.max(0, 5000 - (Date.now() - syncFirstQueuedAt))),
    );
}

function isRetryableRemoteSyncError(error: unknown) {
    if (error instanceof ApiError) return error.retryable || error.status === undefined || error.reason === "canvas_concurrent_write" || canReconcileCanvasRejection(error);
    if (error instanceof DOMException && error.name === "AbortError") return false;
    if (typeof error === "object" && error !== null && "permanent" in error) {
        return (error as { permanent?: unknown }).permanent !== true;
    }
    // Local storage and reconciliation can recover after space is freed or the
    // next cloud observation. Retry with bounded backoff, never a hot loop.
    return true;
}

function scheduleRemoteUserDataRetry(error: unknown) {
    if (!isRetryableRemoteSyncError(error) || !activeRemoteUserId || remoteUserDataPhase !== "ready") return false;
    const delayMs = error instanceof ApiError && error.reason === "canvas_edit_lease_conflict" ? 1200 : remoteUserDataRetryDelay(syncRetryAttempt, error instanceof ApiError ? error.retryAfterMs || 0 : 0);
    syncRetryAttempt = Math.min(syncRetryAttempt + 1, REMOTE_SYNC_RETRY_DELAYS_MS.length - 1);
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
        syncTimer = null;
        void saveRemoteUserDataNow().catch((retryError) => console.warn("云端自动重试失败", retryError));
    }, delayMs);
    return true;
}

function scheduleRemoteUserDataHydrationRetry(error: unknown) {
    if (!isRetryableRemoteSyncError(error) || !activeRemoteUserId || remoteUserDataPhase !== "failed") return false;
    const delayMs = remoteUserDataRetryDelay(syncRetryAttempt, error instanceof ApiError ? error.retryAfterMs || 0 : 0);
    syncRetryAttempt = Math.min(syncRetryAttempt + 1, REMOTE_SYNC_RETRY_DELAYS_MS.length - 1);
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
        syncTimer = null;
        void syncRemoteUserData(activeRemoteUserId).catch((retryError) => console.warn("云端数据基线自动恢复失败", retryError));
    }, delayMs);
    return true;
}

export function formatLocalSavedRemotePending(localAction: string, error: unknown): string {
    if (error instanceof ApiError && error.status === 401) return `${localAction}，请重新登录以继续云端同步。`;
    if (error instanceof ApiError && error.status === 403) return `${localAction}，当前没有云端写入权限。`;
    return `${localAction}，正在自动同步。`;
}

/** 本地写已成功、云端同步失败：排队同一幂等重试，并返回可直接展示的 warning。不得回滚本地写，也不得说成已保存到云端。 */
export function localSavedRemotePendingMessage(localAction: string, error: unknown): string {
    scheduleRemoteUserDataSync();
    return formatLocalSavedRemotePending(localAction, error);
}

export async function createCanvasProjectWithRemoteSync(title: string, projectId?: string, initialContent?: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">>) {
    const id = useCanvasStore.getState().createProject(title, projectId);
    if (initialContent) useCanvasStore.getState().updateProject(id, initialContent);
    remoteDeletedProjects.delete(id);
    if (!activeRemoteUserId) return { id };
    try {
        await saveRemoteUserDataNow(id);
        return { id };
    } catch (syncError) {
        scheduleRemoteUserDataSync();
        return { id, syncError };
    }
}

export async function deleteAssetWithRemoteSync(id: string) {
    return deleteAssetsWithRemoteSync([id]);
}

export async function deleteAssetsWithRemoteSync(ids: string[]) {
    const epoch = sessionEpoch;
    if (!ids.length || ids.length > 1000) throw new Error("每次请选择 1–1000 个素材删除");
    const assetIds = [...new Set(ids.map((id) => id.trim()))];
    if (assetIds.some((id) => !id)) throw new Error("素材 ID 不能为空");
    await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新选择要删除的素材");
        if (activeRemoteUserId) {
            requireRemoteUserDataBaseline();
            await deleteRemoteAssets(assetIds);
            if (epoch !== sessionEpoch) throw new Error("账号已切换，请刷新原账号素材库确认删除结果");
            for (const id of assetIds) acknowledgedAssets.delete(id);
        }
        await useAssetStore.getState().removeAssets(assetIds);
        await flushAssetStorePersistence();
    });
    if (epoch !== sessionEpoch) throw new Error("账号已切换，请刷新原账号素材库确认删除结果");
    // 列表查询也会进入同步队列，必须在退出删除队列后触发，不能在队列内等待刷新。
    // 刷新慢或失败不应阻塞确认弹窗关闭，也不能把已完成的删除报告为失败。
    void Promise.all([appQueryClient.invalidateQueries({ queryKey: ["asset-library"] }, { throwOnError: true }), appQueryClient.invalidateQueries({ queryKey: ["asset-picker"] }, { throwOnError: true })]).catch((error) => {
        console.warn("素材删除后列表刷新失败", error);
    });
}

export async function deleteCanvasProjectsWithRemoteSync(ids: string[]) {
    const epoch = sessionEpoch;
    const projectIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!projectIds.length) return;
    // 删除只依赖画布 ID，跳过编辑加载，避免关联素材的合同校验阻塞删除。
    await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新选择要删除的画布");
        if (activeRemoteUserId) requireRemoteUserDataBaseline();
        const currentProjects = useCanvasStore.getState().projects;
        const projectById = new Map(currentProjects.map((project) => [project.id, project]));
        const deletedProjectIds: string[] = [];
        const deletedProjectObjects: CanvasProject[] = [];
        let deletionError: unknown;
        for (const id of projectIds) {
            try {
                if (activeRemoteUserId) {
                    await deleteRemoteCanvasProject(id);
                    acknowledgedProjects.delete(id);
                    remoteDeletedProjects.delete(id);
                }
                useCanvasStore.getState().deleteProjects([id]);
                // 批量删除允许部分成功；每个已成功远端删除的实体都立即落实到本地 durable cache。
                await flushCanvasStorePersistence();
                deletedProjectIds.push(id);
                const project = projectById.get(id);
                if (project) deletedProjectObjects.push(project);
            } catch (error) {
                deletionError = error;
                break;
            }
        }
        if (deletedProjectObjects.length > 0) useCanvasHistoryStore.getState().recordDeletedProjects(deletedProjectObjects);

        if (incrementalSession) {
            void appQueryClient.invalidateQueries({ queryKey: ["canvas-library"] });
            if (deletionError) throw deletionError;
            return;
        }

        // 将属于被删除画布的所有媒体节点安全归档至素材库回收站 (status = "archived")
        const currentAssets = useAssetStore.getState().assets;
        const remainingProjects = useCanvasStore.getState().projects;
        const activeAssetIds = new Set<string>();
        for (const proj of remainingProjects) {
            for (const node of proj.nodes) {
                if (node.metadata?.assetId) activeAssetIds.add(node.metadata.assetId);
            }
            for (const clip of proj.timeline?.clips || []) {
                if (clip.directMedia?.assetId) activeAssetIds.add(clip.directMedia.assetId);
            }
        }
        let assetChanged = false;
        // 1. 已存在的关联素材标记为 archived
        const assetsToArchive = currentAssets.filter((asset) => {
            const canvasId = asset.metadata?.canvasId as string | undefined;
            return canvasId && deletedProjectIds.includes(canvasId) && !activeAssetIds.has(asset.id) && asset.status !== "archived";
        });
        for (const asset of assetsToArchive) {
            useAssetStore.getState().updateAsset(asset.id, { status: "archived" });
            assetChanged = true;
        }

        // 2. 对于画布中尚未入库的媒体节点，直接归档为回收站素材。
        // 素材字段统一交给 canvasNodeToAsset 组装，避免删除路径另起一套尺寸、MIME 和资源定位规则。
        for (const project of deletedProjectObjects) {
            for (const node of project.nodes || []) {
                const isMedia = node.type === "image" || node.type === "video" || node.type === "audio";
                if (!isMedia) continue;

                const existingAsset = node.metadata?.assetId ? currentAssets.find((a) => a.id === node.metadata?.assetId) : undefined;
                if (existingAsset) {
                    const owningCanvasId = existingAsset.metadata?.canvasId as string | undefined;
                    if (owningCanvasId === project.id && !activeAssetIds.has(existingAsset.id) && existingAsset.status !== "archived") {
                        useAssetStore.getState().updateAsset(existingAsset.id, { status: "archived" });
                        assetChanged = true;
                    }
                    continue;
                }

                const archivedAsset = canvasNodeToAsset(node, { canvasId: project.id, source: "canvas-manual" });
                if (!archivedAsset) continue;

                const title = node.title || `${project.title} - ${node.type === "image" ? "图片" : node.type === "video" ? "视频" : "音频"}`;
                const prompt = typeof node.metadata?.prompt === "string" ? node.metadata.prompt : "";
                useAssetStore.getState().addAsset({
                    ...archivedAsset,
                    title,
                    tags: node.type === "audio" ? ["画布音频"] : prompt ? [prompt.slice(0, 16)] : [node.type === "video" ? "画布视频" : "画布生成"],
                    category: "other",
                    status: "archived",
                    source: `已删除画布：${project.title}`,
                    metadata: {
                        ...archivedAsset.metadata,
                        canvasId: project.id,
                        sourceNodeId: node.id,
                    },
                });
                assetChanged = true;
            }
        }

        if (assetChanged) {
            await flushAssetStorePersistence();
            if (activeRemoteUserId) {
                try {
                    await drainRemoteUserDataChanges();
                } catch (syncErr) {
                    scheduleRemoteUserDataSync();
                    console.warn("回收站素材云端同步警告:", syncErr);
                }
            }
        }
        if (deletionError) throw deletionError;
    });
}

export async function saveRemoteUserDataNow(input?: string | readonly string[]) {
    const key = `${sessionEpoch}:${getActiveUserScope()}:${input === undefined ? "all" : JSON.stringify(typeof input === "string" ? [input] : [...input].sort())}`;
    await waitForCanvasSync(syncSingleFlight(key, () => performRemoteUserDataSave(input)));
}

export async function prepareCanvasForCloudAction(id: string) {
    try {
        await saveRemoteUserDataNow(id);
    } catch (error) {
        // Callers retain their input without adding sync errors to task UI.
        throw new CanvasSyncPendingError(error instanceof Error ? error.message : undefined);
    }
}

async function performRemoteUserDataSave(input?: string | readonly string[]) {
    const projectId = input;
    const epoch = sessionEpoch;
    if (!activeRemoteUserId) throw new Error("云端同步会话尚未建立，当前内容已保留在本地");
    requireRemoteUserDataBaseline();
    await waitForRemoteProjectLoads(projectId);
    // Share serialization, not outcomes: a foreground save must run its own
    // selected canvas even when a background save of another canvas failed.
    const operation = withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止旧会话保存");
        await drainRemoteUserDataChanges({ projectId });
    });
    syncPromise = operation;
    let syncFailed = false;
    let syncError: unknown;
    try {
        await operation;
        if (epoch === sessionEpoch) syncRetryAttempt = 0;
    } catch (error) {
        syncFailed = true;
        syncError = error;
    } finally {
        if (syncPromise === operation) {
            syncPromise = null;
            if (epoch === sessionEpoch && (autoSyncQueued || syncQueued)) scheduleRemoteUserDataSync();
        }
    }
    if (syncFailed) {
        if (epoch === sessionEpoch) scheduleRemoteUserDataRetry(syncError);
        throw syncError;
    }
}

function canvasOperationValueEqual(left: unknown, right: unknown) {
    return canonicalize(left) === canonicalize(right);
}

function diffCanvasObject(before: Record<string, unknown>, after: Record<string, unknown>, prefix = "") {
    const patch: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
        const path = prefix ? `${prefix}.${key}` : key;
        const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
        const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
        const oldValue = before[key];
        const newValue = after[key];
        if (oldValue === undefined && newValue === undefined) continue;
        if (hasBefore && hasAfter && oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object" && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
            const nested = diffCanvasObject(oldValue as Record<string, unknown>, newValue as Record<string, unknown>, path);
            Object.assign(patch, nested.patch);
            Object.assign(previous, nested.previous);
            continue;
        }
        // undefined 在对象 JSON 中会被丢弃，导致 before 或 patch 为空。
        // 服务端用 null 表示不存在/删除；缺省字段与 undefined 之间不需要发送修改。
        if (canvasOperationValueEqual(canvasOperationValue(oldValue), canvasOperationValue(newValue))) continue;
        previous[path] = canvasOperationValue(oldValue);
        patch[path] = canvasOperationValue(newValue);
    }
    return { patch, previous };
}

function canvasOperationValue(value: unknown) {
    return value === undefined ? null : value;
}

const CANVAS_OPERATION_FIELDS = ["title", "projectId", "chatSessions", "activeChatId", "starterMode", "appearance", "backgroundMode", "showImageInfo", "previsScenes", "timeline"] as const;

export function buildCanvasOperations(base: CanvasProject | undefined, next: CanvasProject): CanvasOperation[] {
    const operations: CanvasOperation[] = [];
    if (!base) {
        operations.push({
            type: "create_canvas",
            id: next.id,
            patch: {
                title: next.title,
                projectId: next.projectId,
                chatSessions: next.chatSessions,
                activeChatId: next.activeChatId,
                starterMode: next.starterMode,
                appearance: next.appearance,
                backgroundMode: next.backgroundMode,
                showImageInfo: next.showImageInfo,
                previsScenes: next.previsScenes,
                timeline: next.timeline,
            },
        });
    }
    const baseNodes = new Map((base?.nodes || []).map((node) => [node.id, node]));
    const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
    for (const node of next.nodes) {
        const previous = baseNodes.get(node.id);
        if (!previous) {
            operations.push({ type: "create_node", node });
            continue;
        }
        const diff = diffCanvasObject(previous as unknown as Record<string, unknown>, node as unknown as Record<string, unknown>);
        if (Object.keys(diff.patch).length) {
            const taskTime = diff.patch["metadata.taskUpdatedAt"];
            const taskId = previous.metadata?.taskId;
            if (typeof taskTime === "string" && taskTime.trim() && typeof taskId === "string" && taskId.trim() && taskId === node.metadata?.taskId && !Object.hasOwn(diff.previous, "metadata.taskId")) {
                diff.previous["metadata.taskId"] = taskId;
            }
            operations.push({ type: "patch_node", id: node.id, patch: diff.patch, before: diff.previous });
        }
    }
    for (const node of base?.nodes || []) {
        if (!nextNodes.has(node.id)) operations.push({ type: "remove_node", id: node.id, expected: node });
    }
    const baseConnections = new Map((base?.connections || []).map((connection) => [connection.id, connection]));
    const nextConnections = new Map(next.connections.map((connection) => [connection.id, connection]));
    for (const connection of next.connections) {
        const previous = baseConnections.get(connection.id);
        if (previous && !canvasOperationValueEqual(previous, connection)) {
            operations.push({ type: "update_connection", id: connection.id, connection, expected: previous });
        } else if (!previous) {
            operations.push({ type: "create_connection", connection });
        }
    }
    for (const connection of base?.connections || []) {
        if (!nextConnections.has(connection.id)) operations.push({ type: "remove_connection", id: connection.id, expected: connection });
    }
    // 新画布的字段已由 create_canvas.patch 写入；再追加 set_field(beforeValue=null)
    // 会在服务端看到刚创建的字段而判定冲突，所以只有已有基线时才生成字段操作。
    if (!base) return operations;
    for (const field of CANVAS_OPERATION_FIELDS) {
        // 服务端用 "" 表示未关联项目，本地可能是 undefined；两者语义相同，不能生成写操作。
        if (field === "projectId" && !base.projectId && !next.projectId) continue;
        if (!canvasOperationValueEqual(base[field], next[field])) operations.push({ type: "set_field", field, value: canvasOperationValue(next[field]), beforeValue: canvasOperationValue(base[field]) });
    }
    return operations;
}

class CanvasMutationRejectedError extends Error {
    constructor(readonly rejection: ApiError, readonly entry: PendingCanvasMutation) {
        super(rejection.message);
    }
}

async function submitPendingCanvasMutation(entry: PendingCanvasMutation) {
    try {
        return await submitCanvasMutation(entry);
    } catch (error) {
        if (canReconcileCanvasRejection(error)) throw new CanvasMutationRejectedError(error as ApiError, pendingCanvasMutations.get(entry.projectId) ?? entry);
        throw error;
    }
}

async function submitCanvasMutation(entry: PendingCanvasMutation) {
    const epoch = sessionEpoch;
    const scope = getActiveUserScope();
    const assertSession = () => {
        if (epoch !== sessionEpoch || scope !== getActiveUserScope()) throw new Error("账号已切换，已停止旧会话保存");
    };
    return submitCanvasMutationBatches(entry, {
        persist: persistPendingCanvasMutationJournal,
        assertSession,
        newId: newCanvasMutationId,
        send: async (request) => {
            try {
                return await applyRemoteCanvasOperations(entry.projectId, request);
            } catch (error) {
                assertSession();
                // Only an explicit rejection permits a new request ID/body.
                if (!(error instanceof ApiError) || error.status !== 409 || error.reason !== "canvas_field_conflict") throw error;
                const repaired = repairLegacyTaskIdFence(request, entry.baseline, entry.prepared);
                const fenced = fenceRejectedTaskTimestampMutation(repaired ?? request, entry.baseline, entry.prepared) ?? repaired;
                if (!fenced) throw error;
                entry.request = { ...fenced, mutationId: newCanvasMutationId() };
                try {
                    await persistPendingCanvasMutationJournal();
                } catch (storageError) {
                    if (epoch === sessionEpoch && pendingCanvasMutations.get(entry.projectId) === entry) entry.request = request;
                    throw storageError;
                }
                assertSession();
                return applyRemoteCanvasOperations(entry.projectId, entry.request);
            }
        },
    });
}

async function drainRemoteUserDataChanges(options: { projectId?: string | readonly string[] } = {}) {
    const uploaded = new Map<string, string>();
    let reconciliationPassAvailable = true;
    // A continuously edited canvas must yield the shared writer to other work.
    for (let pass = 0; pass < 2; pass++) {
        syncQueued = false;
        const reconciled = await saveRemoteUserDataBatch(uploaded, options);
        if (!syncQueued) return;
        // Rebuilding a rejected journal is preparation, not a completed save.
        // Allow it one extra pass so edits during that preparation can finish,
        // while repeated rejection/continuous input still yields the writer.
        if (reconciled && reconciliationPassAvailable) {
            reconciliationPassAvailable = false;
            pass--;
        }
    }
    autoSyncQueued = true;
    throw new CanvasSyncPendingError("新修改已保留，后台继续保存");
}

// Only a definitive rejection may discard a journal; unknown network outcomes
// must keep their mutation ID for receipt replay.
function canReconcileCanvasRejection(error: unknown) {
    return error instanceof ApiError && [400, 409].includes(error.status || 0) && ["canvas_field_conflict", "canvas_object_missing", "canvas_edit_lease_conflict", "canvas_media_assets_pending"].includes(error.reason || "");
}

async function preserveSyncRecovery(identity: string, value: object) {
    const scope = getActiveUserScope();
    const key = `yingce:canvas-recovery:${identity}:${newCanvasMutationId()}`;
    rememberSyncRecovery(scope, key, value);
    const write = Promise.resolve().then(() => localForageStorageForScope(scope).setItem(key, JSON.stringify({ ...value, savedAt: new Date().toISOString() })));
    try { await waitForCanvasSync(write, 2_000); } catch {
        // The copy remains exportable in memory when IndexedDB is full/unavailable.
    }
}

async function reconcileCanvasLocalEdits(id: string, rejected?: PendingCanvasMutation) {
    const epoch = sessionEpoch;
    const scope = getActiveUserScope();
    const ensureSession = () => {
        if (epoch !== sessionEpoch || scope !== getActiveUserScope()) throw new Error("账号已切换，已停止画布恢复");
    };
    useSyncProgressStore.getState().setProjectProgress(id, { phase: "saving", errorKind: undefined, message: "正在对齐云端画布" });
    const remote = await restoreRemoteTextNodeContents((await getRemoteCanvasProject(id)).project);
    ensureSession();
    await loadReferencedAssets(collectAssetIds(remote));
    const hash = await canvasContentHash(remote);
    ensureSession();
    const local = useCanvasStore.getState().openProject(id);
    if (!local) throw new Error("画布已关闭");
    const baseline = rejected?.baseline ?? acknowledgedProjects.get(id);
    let project = { ...rebaseCanvasLocalEdits(baseline, remote, local), remoteContentHash: hash };
    const acknowledged = { ...remote, remoteContentHash: hash };
    // A known rollback permits a replacement, but never an empty journal gap:
    // persist its new baseline and payload before projecting the merged cache.
    // Reload can then distinguish remote fields from actual local edits.
    if (rejected) {
        const editVersions = canvasEditLeases.versions(id);
        const prepared = await ensureRemoteResourceReferences(project, new Map());
        ensureSession();
        const replacement: PendingCanvasMutation = {
            projectId: id,
            request: { mutationId: newCanvasMutationId(), baseRevision: remote.revision, operations: buildCanvasOperations(acknowledged, prepared) },
            baseline: acknowledged,
            prepared,
            localPrepared: project,
            rebaseSource: local,
            editVersions,
            editSession: canvasEditLeases.session(),
            createdAt: new Date().toISOString(),
        };
        pendingCanvasMutations.set(id, replacement);
        try {
            await persistPendingCanvasMutationJournal();
        } catch (error) {
            if (epoch === sessionEpoch) pendingCanvasMutations.set(id, rejected);
            throw error;
        }
        ensureSession();
        const latest = useCanvasStore.getState().openProject(id);
        if (!latest) throw new Error("画布已关闭");
        if (latest !== local) project = { ...rebaseCanvasLocalEdits(local, project, latest), remoteContentHash: hash };
    }
    for (const listener of agentCanvasListeners) listener(project, local, "sync");
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === id ? project : item) }));
    await flushCanvasStorePersistence();
    ensureSession();
    acknowledgedProjects.set(id, acknowledged);
    await persistConfirmedCanvasBaselines();
    ensureSession();
    verifiedProjects.add(id);
    unbasedProjects.delete(id);
    const latest = useCanvasStore.getState().openProject(id);
    const pending = pendingCanvasMutations.has(id) || Boolean(latest && !sameCanvasContent(remote, latest));
    useSyncProgressStore.getState().setProjectProgress(id, { phase: pending ? "pending" : "done", pendingChanges: pending ? 1 : 0, errorKind: undefined, cloudRevision: remote.revision, message: pending ? "正在保存画布修改" : "已保存到云端" });
    if (pending) syncQueued = true;
    return project;
}

async function syncRemoteAssetBatch(dirtyAssets: Asset[], uploaded: Map<string, string>) {
    const epoch = sessionEpoch;
    const requireCurrentSession = () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止旧会话保存");
    };
    const adoptedAssetIds = new Set<string>();
    const mergedAssets = new Map<string, Asset>();
    const assetSyncEpoch = sessionEpoch;
    for (const source of dirtyAssets) {
        const baseline = acknowledgedAssets.get(source.id);
        if (!baseline) {
            // 空缓存重建后也可能已有用户编辑；用实际生成默认值三方合并，不能整笔覆盖。
            let remote: Asset;
            try {
                remote = (await getRemoteAsset(source.id)).asset;
            } catch (error) {
                if (assetSyncEpoch !== sessionEpoch) throw new Error("账号已切换，已停止保存素材");
                if (error instanceof ApiError && error.status === 404) continue;
                throw error;
            }
            if (assetSyncEpoch !== sessionEpoch) throw new Error("账号已切换，已停止保存素材");
            const current = useAssetStore.getState().assets.find((asset) => asset.id === source.id);
            if (!sameEntitySnapshot(current, source)) throw new Error("素材仍在编辑，请重新同步");
            const [asset] = parseAssetRecordList([remote]);
            const defaults = getGenerationAssetDefaults(source.id);
            let merged: Asset;
            let edited: boolean;
            try {
                const contextKeys = ["clientContext", "conversationId", "messageId", "batchIndex"];
                // 创建/更新时间是各端记账信息，不属于用户编辑的字段。
                const content = (value: Asset): Asset => {
                    let result = { ...value, createdAt: asset.createdAt, updatedAt: asset.updatedAt };
                    if (!defaults) return result;
                    // 客户端上下文不是素材编辑；保留 projectIds 等业务元数据参与合并。
                    const metadata = { ...result.metadata };
                    for (const key of contextKeys) delete metadata[key];
                    result = { ...result, metadata };
                    if (result.kind === "image" || result.kind === "video" || result.kind === "audio") {
                        const resourceId = resourceIdFromStorageKey(result.data.storageKey);
                        if (resourceId) {
                            // 同一不可变资源的授权/缓存 URL 不代表编辑；独立封面仍参与比较。
                            const url = resourceFileUrl(resourceId);
                            const displayUrl = result.kind === "image" ? result.data.dataUrl : result.data.url;
                            const coverUrl = result.coverUrl === displayUrl ? (result.kind === "image" ? url : "") : result.coverUrl;
                            result =
                                result.kind === "image"
                                    ? { ...result, coverUrl, data: { ...result.data, dataUrl: url } }
                                    : result.kind === "video"
                                      ? { ...result, coverUrl, data: { ...result.data, url } }
                                      : { ...result, coverUrl, data: { ...result.data, url } };
                        }
                    }
                    return result;
                };
                // 无法证明生成默认值时保持保守；刷新后的旧缓存不能充当编辑基线。
                const remoteContent = content(asset);
                const mergedContent = mergeThreeWayValue(content(source), defaults ? content(defaults) : undefined, remoteContent) as Asset;
                edited = canonicalize(remoteContent) !== canonicalize(mergedContent);
                // 投影只用于判断编辑；未改字段保留远端原值，改动字段取本机真实 payload。
                const applyEdits = (stored: unknown, local: unknown, before: unknown, after: unknown): unknown => {
                    if (canonicalize(before) === canonicalize(after)) return stored;
                    if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
                        const result = { ...(stored as Record<string, unknown>) };
                        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
                            const value = applyEdits(result[key], (local as Record<string, unknown>)?.[key], (before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key]);
                            if (value === undefined) delete result[key];
                            else result[key] = value;
                        }
                        return result;
                    }
                    return local;
                };
                merged = applyEdits(asset, source, remoteContent, mergedContent) as Asset;
                if (defaults) {
                    const metadata = { ...merged.metadata };
                    for (const key of contextKeys) {
                        if (metadata[key] === undefined && source.metadata?.[key] !== undefined) metadata[key] = source.metadata[key];
                    }
                    merged = { ...merged, metadata };
                }
            } catch {
                throw assetRemoteVersionConflict();
            }
            acknowledgedAssets.set(source.id, edited ? asset : merged);
            verifiedAssets.add(source.id);
            if (!edited) adoptedAssetIds.add(source.id);
            else {
                merged = { ...merged, updatedAt: source.updatedAt };
                mergedAssets.set(source.id, merged);
            }
            useAssetStore.setState((state) => ({ assets: state.assets.map((item) => (item.id === source.id ? merged : item)) }));
        }
    }

    if (incrementalSession) {
        for (const source of dirtyAssets) {
            const baseline = acknowledgedAssets.get(source.id);
            if (!baseline || verifiedAssets.has(source.id)) continue;
            const { asset } = await getRemoteAsset(source.id);
            requireCurrentSession();
            if (Date.parse(asset.updatedAt) !== Date.parse(baseline.updatedAt)) throw assetRemoteVersionConflict();
            verifiedAssets.add(source.id);
        }
    }

    // 转换后的 resource: 引用只属于发往服务端的 payload，不能反写整份实时 store。
    // 已确认快照记录的是本次上传所依据的本地实体；上传期间的新编辑会在下一轮继续提交。
    // 素材先于画布提交。这样画布中的 resource: 引用一旦成为远端事实，
    // 对应 Asset 已经存在，刷新或换设备不会出现只占容量、不见素材的窗口。
    for (const dirty of dirtyAssets) {
        if (adoptedAssetIds.has(dirty.id)) continue;
        const source = mergedAssets.get(dirty.id) ?? dirty;
        const remotePayload = await ensureRemoteResourceReferences(assetForRemoteSync(source), uploaded);
        requireCurrentSession();
        await upsertRemoteAsset(remotePayload);
        requireCurrentSession();
        acknowledgedAssets.set(source.id, source);
        verifiedAssets.add(source.id);
    }
}

async function saveRemoteUserDataBatch(uploaded: Map<string, string>, options: { projectId?: string | readonly string[] } = {}) {
    const epoch = sessionEpoch;
    const requireCurrentSession = () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止旧会话保存");
    };
    // 中央兜底：任何调用方只要把持久媒体写进画布，提交前都会先补齐素材记录与 assetId。
    // 页面级入口仍主动入库，以便立即反馈；这里负责阻止遗漏入口形成远端幽灵资源。
    const projectsBeforeRepair = useCanvasStore.getState().projects;
    const selectedProjectIds = options.projectId === undefined ? undefined : new Set(typeof options.projectId === "string" ? [options.projectId] : options.projectId);
    if (selectedProjectIds && [...selectedProjectIds].some((id) => remoteDeletedProjects.has(id))) throw new ApiError("云端画布已删除，无法保存", { status: 404 });
    const syncProjectIds = selectedProjectIds === undefined ? undefined : new Set([...selectedProjectIds].filter((id) => projectsBeforeRepair.some((project) => project.id === id)));
    const changedProjectIds = new Set(
        projectsBeforeRepair
            .filter((project) => !remoteDeletedProjects.has(project.id) && (syncProjectIds === undefined || syncProjectIds.has(project.id)) && (pendingCanvasMutations.has(project.id) || !sameCanvasContent(acknowledgedProjects.get(project.id), project)))
            .map((project) => project.id),
    );
    repairMissingCanvasAssets(changedProjectIds, incrementalSession);
    const currentProjects = useCanvasStore.getState().projects;
    const currentAssets = useAssetStore.getState().assets;
    const dirtyProjects = currentProjects.filter((project) => {
        const dirty = !remoteDeletedProjects.has(project.id) && (pendingCanvasMutations.has(project.id) || !sameCanvasContent(acknowledgedProjects.get(project.id), project));
        const selected = selectedProjectIds === undefined || selectedProjectIds.has(project.id);
        return selected && dirty;
    });
    const canvasAssetIds = selectedProjectIds?.size ? new Set(currentProjects.filter((project) => selectedProjectIds.has(project.id)).flatMap((project) => [...collectAssetIds(project)])) : undefined;
    const dirtyAssets = currentAssets.filter((asset) => {
        const dirty = !sameEntitySnapshot(acknowledgedAssets.get(asset.id), asset);
        const selected = !canvasAssetIds || canvasAssetIds.has(asset.id) || (typeof asset.metadata?.canvasId === "string" && selectedProjectIds!.has(asset.metadata.canvasId));
        return selected && dirty;
    });
    if (!dirtyProjects.length && !dirtyAssets.length) return;

    let reconciled = false;
    const assetSyncEpoch = sessionEpoch;
    const failedAssets = new Map<string, unknown>();
    for (const asset of dirtyAssets) {
        try {
            await syncRemoteAssetBatch([asset], uploaded);
        } catch (error) {
            requireCurrentSession();
            if (error instanceof AssetSyncConflictError) {
                try {
                    const { asset: remote } = await getRemoteAsset(asset.id);
                    requireCurrentSession();
                    const current = useAssetStore.getState().assets.find((item) => item.id === asset.id);
                    if (current) await preserveSyncRecovery(`asset:${asset.id}`, { asset: current });
                    requireCurrentSession();
                    if (useAssetStore.getState().assets.find((item) => item.id === asset.id) !== current) {
                        failedAssets.set(asset.id, new CanvasSyncPendingError());
                        continue;
                    }
                    acknowledgedAssets.set(asset.id, remote);
                    verifiedAssets.add(asset.id);
                    useAssetStore.setState((state) => ({ assets: state.assets.map((item) => item.id === asset.id ? remote : item) }));
                    continue;
                } catch (recoveryError) { error = recoveryError; }
            }
            failedAssets.set(asset.id, error);
        }
    }
    const errors: unknown[] = dirtyProjects.length ? [] : [...failedAssets.values()];
    for (const source of dirtyProjects) {
        const keysToUpload = collectLocalMediaKeys(source);
        const total = keysToUpload.length;
        useSyncProgressStore.getState().setProjectProgress(source.id, {
            projectId: source.id,
            total,
            completed: 0,
            phase: total > 0 ? "uploading" : "saving",
            errorKind: undefined,
            pendingChanges: 1,
            message: total > 0 ? "正在同步媒体至云端" : "正在保存画布",
        });
        const onMediaUploaded = () => {
            if (total > 0) {
                useSyncProgressStore.getState().incrementProjectCompleted(source.id);
            }
        };
        try {
            requireCurrentSession();
            const dependencyError = [...collectAssetIds(source)].map((id) => failedAssets.get(id)).find((error) => error !== undefined);
            if (dependencyError) throw dependencyError;
            if (unbasedProjects.has(source.id)) {
                await reconcileCanvasLocalEdits(source.id);
                reconciled = true;
                continue;
            }
            let current = useCanvasStore.getState().openProject(source.id);
            if (!current) throw new Error("画布已关闭，停止提交操作");
            const staged = pendingCanvasMutations.get(source.id);
            if (staged?.rebaseSource && staged.localPrepared?.remoteContentHash && current.remoteContentHash !== staged.localPrepared.remoteContentHash) {
                // The replacement journal commits before the projected cache.
                // A reload in that gap still has the pre-merge draft. Reapply
                // its staged projection once, preserving later local input.
                const projected = rebaseCanvasLocalEdits(staged.rebaseSource, staged.localPrepared, current);
                for (const listener of agentCanvasListeners) listener(projected, current, "sync");
                useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === source.id ? projected : item) }));
                await flushCanvasStorePersistence();
                requireCurrentSession();
                current = useCanvasStore.getState().openProject(source.id);
                if (!current) throw new Error("画布已关闭，停止提交操作");
            }
            const base = acknowledgedProjects.get(source.id);
            const editVersions = canvasEditLeases.versions(source.id);
            const prepared = await ensureRemoteResourceReferences(current, uploaded, onMediaUploaded);
            requireCurrentSession();
            const pendingJournal = pendingCanvasMutations.get(source.id);
            let acknowledgedEditVersions = editVersions;
            // Compare live edits with the local snapshot used to prepare the request.
            // Its CDN/blob URLs can differ from the normalized resource payload.
            let preparedForMutation = current;
            let savedRevision: number | undefined;
            let remoteSnapshot: CanvasProject | undefined;
            if (pendingJournal) {
                acknowledgedEditVersions = pendingJournal.editSession === canvasEditLeases.session() ? pendingJournal.editVersions || {} : {};
                preparedForMutation = pendingJournal.localPrepared ?? (sameCanvasContent(prepared, pendingJournal.prepared) ? current : pendingJournal.prepared);
                const repairedRequest = repairPendingCanvasMutationRequest(pendingJournal.request, pendingJournal.baseline, pendingJournal.prepared);
                if (repairedRequest !== pendingJournal.request) {
                    pendingJournal.request = repairedRequest;
                    await persistPendingCanvasMutationJournal();
                }
                useSyncProgressStore.getState().setProjectProgress(source.id, { phase: "saving", message: "正在重放未确认的画布操作" });
                // 旧队列可能只记录了 undefined 与缺省值之间的无效变化，没有需要发送的修改。
                if (pendingJournal.request.operations.length) {
                    const ids = new Set([...pendingJournal.request.operations, ...(pendingJournal.remainingOperations || [])].flatMap((operation) => (operation.type === "create_node" ? [operation.node.id] : "id" in operation ? [operation.id] : [])));
                    const ownedVersions = canvasEditLeases.versions(source.id);
                    if (pendingJournal.editSession !== canvasEditLeases.session()) {
                        acknowledgedEditVersions = Object.fromEntries((pendingJournal.request.editProofs || []).filter((proof) => ids.has(proof.nodeId) && !(proof.nodeId in ownedVersions)).map((proof) => [proof.nodeId, 1]));
                    }
                    const proofs = await canvasEditLeases.proofs(source.id, ids, pendingJournal.request.editProofs);
                    if (proofs.length) {
                        const replaced = new Set(proofs.map((proof) => proof.nodeId));
                        pendingJournal.request.editProofs = [...(pendingJournal.request.editProofs || []).filter((proof) => !replaced.has(proof.nodeId)), ...proofs];
                        await persistPendingCanvasMutationJournal();
                    }
                    requireCurrentSession();
                    const response = await submitPendingCanvasMutation(pendingJournal);
                    requireCurrentSession();
                    savedRevision = Number(response.project.revision);
                } else {
                    savedRevision = Number(current.revision);
                }
            } else {
                const operations = buildCanvasOperations(base, prepared);
                if (!operations.length) {
                    // No cloud write is needed, but local persistence and progress
                    // still need the same completion path as a submitted mutation.
                    remoteSnapshot = { ...prepared, revision: current.revision };
                } else {
                    const request: CanvasOperationsRequest = {
                        mutationId: newCanvasMutationId(),
                        ...(base ? { baseRevision: base.revision } : {}),
                        operations,
                    };
                    if (base) {
                        const ids = new Set(operations.flatMap((operation) => (operation.type === "create_node" ? [operation.node.id] : "id" in operation ? [operation.id] : [])));
                        request.editProofs = await canvasEditLeases.proofs(source.id, ids);
                    }
                    requireCurrentSession();
                    const entry: PendingCanvasMutation = { projectId: source.id, request, baseline: base, prepared, localPrepared: current, editVersions, editSession: canvasEditLeases.session(), createdAt: new Date().toISOString() };
                    pendingCanvasMutations.set(source.id, entry);
                    await persistPendingCanvasMutationJournal();
                    requireCurrentSession();
                    useSyncProgressStore.getState().setProjectProgress(source.id, { phase: "saving", message: base ? "正在提交画布操作" : "正在创建画布" });
                    const response = await submitPendingCanvasMutation(entry);
                    if (assetSyncEpoch !== sessionEpoch) throw new Error("账号已切换，已停止旧会话保存");
                    savedRevision = Number(response.project.revision);
                }
            }
            if (!remoteSnapshot && !Number.isSafeInteger(savedRevision)) throw new Error("服务端未返回有效画布版本");
            const remote = remoteSnapshot ?? (await restoreRemoteTextNodeContents((await getRemoteCanvasProject(source.id)).project));
            const remoteHash = await canvasContentHash(remote);
            requireCurrentSession();
            const latest = useCanvasStore.getState().openProject(source.id);
            if (!latest) throw new Error("画布已关闭，停止提交操作");
            const acknowledged = { ...remote, viewport: latest.viewport || remote.viewport, remoteContentHash: remoteHash };
            let projected = acknowledged;
            if (sameCanvasContent(latest, preparedForMutation)) {
                projected = acknowledged;
            } else {
                projected = { ...rebaseCanvas(preparedForMutation, acknowledged, latest), remoteContentHash: remoteHash };
            }
            if (!sameCanvasContent(latest, projected)) {
                for (const listener of agentCanvasListeners) listener(projected, latest, "sync");
            }
            useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project === latest ? projected : project)) }));
            await flushCanvasStorePersistence();
            requireCurrentSession();
            acknowledgedProjects.set(source.id, acknowledged);
            verifiedProjects.add(source.id);
            await persistConfirmedCanvasBaselines();
            requireCurrentSession();
            pendingCanvasMutations.delete(source.id);
            await persistPendingCanvasMutationJournal();
            requireCurrentSession();
            canvasEditLeases.acknowledged(source.id, acknowledgedEditVersions);
            // Release even when newer local input exists. Another device must
            // get a write turn while both users keep typing continuously.
            await canvasEditLeases.yield(source.id);
            requireCurrentSession();
            const currentAfterSave = useCanvasStore.getState().openProject(source.id);
            const pending = Boolean(currentAfterSave && !sameCanvasContent(acknowledged, currentAfterSave));
            useSyncProgressStore.getState().setProjectProgress(source.id, {
                phase: pending ? "pending" : "done",
                cloudRevision: Number(remote.revision),
                pendingChanges: pending ? 1 : 0,
                errorKind: undefined,
                message: pending ? "有新修改等待保存" : "已保存到云端",
            });
            if (pending) syncQueued = true;
        } catch (error) {
            if (epoch !== sessionEpoch) throw error;
            if (error instanceof CanvasMutationRejectedError) {
                try {
                    const rejected = error.entry;
                    if (error.rejection.reason === "canvas_edit_lease_conflict") {
                        canvasEditLeases.invalidate(source.id, new Set(rejected.request.editProofs?.map((proof) => proof.nodeId)));
                    }
                    if (error.rejection.reason === "canvas_media_assets_pending") {
                        const assets = await loadReferencedAssets(collectAssetIds(source), true);
                        requireCurrentSession();
                        rebindInconsistentCanvasAssets(assets, new Set([source.id]));
                    }
                    await reconcileCanvasLocalEdits(source.id, rejected);
                    reconciled = true;
                    continue;
                } catch (recoveryError) {
                    error = recoveryError;
                }
            }
            const resourcesMissing = error instanceof ApiError && error.reason === "canvas_history_resources_missing";
            if (assetSyncEpoch !== sessionEpoch) throw error;
            const waitingForWriter = error instanceof ApiError && error.reason === "canvas_edit_lease_conflict";
            const errorKind = waitingForWriter ? undefined : resourcesMissing ? "resources" : error instanceof ApiError && error.status === 409 ? "conflict" : error instanceof ApiError && error.retryable ? "network" : "local";
            useSyncProgressStore.getState().setProjectProgress(source.id, {
                phase: "pending",
                errorKind,
                pendingChanges: 1,
                message: waitingForWriter ? "正在同步画布" : error instanceof Error ? `画布同步失败：${error.message}` : "画布同步失败",
            });
            errors.push(error);
        }
    }
    if (failedAssets.size) scheduleRemoteUserDataRetry(failedAssets.values().next().value);
    if (errors.length) throw errors[0];
    if (dirtyProjects.length) void appQueryClient.invalidateQueries({ queryKey: ["canvas-library"] });
    return reconciled;
}

class AssetSyncConflictError extends Error {}

function assetRemoteVersionConflict() {
    return new AssetSyncConflictError("素材远端基线已变化，未确认修改会在下一轮同步中重新校验");
}

function requireRemoteUserDataBaseline() {
    if (remoteUserDataPhase !== "ready") throw new Error("云端数据基线尚未建立，已停止写入");
}

function sameEntitySnapshot<T>(acknowledged: T | undefined, current: T) {
    return acknowledged !== undefined && (acknowledged === current || JSON.stringify(acknowledged) === JSON.stringify(current));
}
