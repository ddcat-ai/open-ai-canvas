import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { deleteRemoteAsset, deleteRemoteCanvasProject, getRemoteAsset, getRemoteAssetsByIds, getRemoteCanvasProject, getRemoteUserDataSnapshot, listRemoteAssetsPage, restoreRemoteCanvasHistory, upsertRemoteAsset, upsertRemoteCanvasProject } from "@/services/api/user-data";
import { ApiError } from "@/services/api/request";
import { canvasContentHash, sameCanvasContent } from "@/lib/canvas/canvas-content";
import { getActiveUserScope } from "@/lib/user-scope";
import { preserveCanvasSyncDraft, readCanvasSyncDrafts } from "@/services/canvas-sync-drafts";
import { appQueryClient } from "@/lib/query-client";
import { buildCanvasConflictFields, clearCanvasConflict, saveCanvasConflict, type CanvasConflictSnapshot } from "@/services/canvas-conflicts";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { parseAssetRecordList } from "@/lib/asset-record";
import { assetForRemoteSync } from "@/lib/asset-remote-sync";
import type { Asset } from "@/stores/use-asset-store";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { repairMissingCanvasAssets, collectCanvasMediaAssetIds, rebindInconsistentCanvasAssets, type CanvasAssetRebindResult } from "@/services/canvas-asset-repair";
import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import { applyAgentCanvasPatch, type AgentCanvasPatch } from "@/lib/canvas/agent-canvas-patch";
import { cloneCanvasDrawing, removeCanvasDrawing } from "@/lib/canvas/canvas-drawing-storage";
import { submitCanvasCollaborationOperation, type CanvasCollaborationOperation } from "@/services/api/canvas-collaboration";
import { listCanvasCollaborationEvents, mergeCanvasBranch, type CanvasCollaborationOperationDelta } from "@/services/api/canvas-collaboration";
import { applyCanvasCollaborationOperation } from "@/lib/canvas/canvas-collaboration-operations";
import { collaborationValueEqual, rebaseCanvasCollaborationProject } from "@/lib/canvas/canvas-collaboration-rebase";
import { readCanvasCollaborationQueue, writeCanvasCollaborationQueue, withCanvasCollaborationQueueLock } from "@/services/canvas-collaboration-queue";

let activeRemoteUserId = "";
type RemoteUserDataPhase = "inactive" | "hydrating" | "ready" | "failed";

let remoteUserDataPhase: RemoteUserDataPhase = "inactive";
let syncTimer: number | null = null;
let syncPromise: Promise<void> | null = null;
let syncQueued = false;
let remoteOperationTail: Promise<void> = Promise.resolve();
let subscriptionsInstalled = false;
let acknowledgedAssets = new Map<string, Asset>();
let acknowledgedProjects = new Map<string, CanvasProject>();
let incrementalSession = false;
let sessionEpoch = 0;
const verifiedProjects = new Set<string>();
const verifiedAssets = new Set<string>();
const remoteProjectLoadPromises = new Map<string, Promise<CanvasProject | undefined>>();
const queuedCollaborationProjects = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
let syncScheduledAt = 0;
const REMOTE_SYNC_DEBOUNCE_MS = 150;

export async function initializeRemoteUserDataSession(userId: string) {
    await withRemoteUserDataSyncExclusive(async () => {
        resetRemoteUserDataSync();
        activeRemoteUserId = userId;
        incrementalSession = true;
        acknowledgedProjects = new Map(useCanvasStore.getState().projects.map((project) => [project.id, project]));
        acknowledgedAssets = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
        const scope = getActiveUserScope();
        for (const project of useCanvasStore.getState().projects) {
            const queue = await readCanvasCollaborationQueue(scope, project.id);
            if (queue) {
                queuedCollaborationProjects.add(project.id);
                acknowledgedProjects.set(project.id, queue.base);
                verifiedProjects.add(project.id);
                useSyncProgressStore.getState().setProjectProgress(project.id, { phase: queue.blocked ? "conflict" : "pending", message: queue.blocked ? "有修改需要确认，草稿已保留" : "正在恢复未完成的同步" });
            }
        }
        remoteUserDataPhase = "ready";
        if (queuedCollaborationProjects.size) scheduleRemoteUserDataSync();
    });
}

function liveCanvasIfUnchanged(id: string, snapshot: CanvasProject | null | undefined) {
    const live = useCanvasStore.getState().openProject(id);
    if (live === snapshot) return live;
    if (!snapshot) return live ? undefined : null;
    return live && sameCanvasContent(live, snapshot) ? live : undefined;
}

export async function loadCanvasProjectForEditing(id: string, options: { latest?: boolean; historyRestore?: { snapshotId: string; revision: number }; onLoad?: (project: CanvasProject) => void } = {}) {
    const epoch = sessionEpoch;
    const request = withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新打开画布");
        requireRemoteUserDataBaseline();
        const scope = getActiveUserScope();
        const requireUnchangedLocal = (snapshot: CanvasProject | null | undefined, message: string) => {
            if (epoch !== sessionEpoch || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开画布");
            const live = liveCanvasIfUnchanged(id, snapshot);
            if (live === undefined) throw new Error(message);
            return live;
        };
        if (options.latest || options.historyRestore) await discardCanvasCollaborationQueue(id);
        else if (queuedCollaborationProjects.has(id)) {
            const pendingLocal = useCanvasStore.getState().openProject(id);
            if (pendingLocal) { options.onLoad?.(pendingLocal); return pendingLocal; }
        }
        if (options.historyRestore) {
            const local = useCanvasStore.getState().openProject(id);
            if (local) {
                const draftCount = await preserveCanvasSyncDraft(local, scope);
                useSyncProgressStore.getState().setProjectProgress(id, { draftCount });
            }
            requireUnchangedLocal(local, "本地内容仍在更新，请稍后再恢复历史版本");
            const { snapshotId, revision } = options.historyRestore;
            try {
                const saved = await restoreRemoteCanvasHistory(id, snapshotId, revision);
                if (epoch !== sessionEpoch || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开画布查看恢复结果");
                if (saved.project.revision !== revision + 1) throw new Error("恢复结果的版本无效，请重新核对云端内容");
            } catch (error) {
                if (epoch === sessionEpoch && getActiveUserScope() === scope && error instanceof ApiError && (error.status === 409 || error.status === 428)) {
                    useSyncProgressStore.getState().setProjectProgress(id, { phase: "conflict", message: error.message });
                }
                throw error;
            }
        }
        let remote: CanvasProject;
        try {
            remote = (await getRemoteCanvasProject(id)).project;
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
        const cachedClean = local?.remoteContentHash && local.remoteContentHash === await canvasContentHash(local);
        const dirty = local && (!verifiedProjects.has(id) && incrementalSession ? !cachedClean : !sameCanvasContent(acknowledgedProjects.get(id), local));
        if (dirty && !sameCanvasContent(local, remote)) {
            const draftCount = await preserveCanvasSyncDraft(local, scope);
            const liveAfterDraft = requireUnchangedLocal(local, "画布仍在更新，已保留本地内容，请稍后再加载最新版本");
            useSyncProgressStore.getState().setProjectProgress(id, { draftCount });
            if (!options.latest && !options.historyRestore && local.revision !== undefined) {
                if (local.revision !== remote.revision) {
                    await persistCanvasConflictSnapshot(id, acknowledgedProjects.get(id), local, remote, scope);
                    useSyncProgressStore.getState().setProjectProgress(id, { phase: "conflict", message: "云端画布已有更新，本地修改已保留为草稿" });
                } else {
                    // A cached draft is not an acknowledged cloud save. Once its
                    // ancestor is verified, retain it as pending against that content.
                    acknowledgedProjects.set(id, { ...remote, remoteContentHash: hash });
                    verifiedProjects.add(id);
                    useSyncProgressStore.getState().setProjectProgress(id, { phase: "pending", message: "本地草稿等待保存到云端" });
                    scheduleRemoteUserDataSync();
                }
                options.onLoad?.(liveAfterDraft || local);
                return liveAfterDraft || local;
            }
        }
        // Editing/generation may continue during the network request or draft write.
        // Viewport-only updates are not document edits and must not block adopting cloud content.
        const live = requireUnchangedLocal(local, "画布仍在更新，已保留本地内容，请稍后再加载最新版本");
        const project = { ...remote, viewport: live?.viewport || local?.viewport || remote.viewport || { x: 0, y: 0, k: 1 }, remoteContentHash: hash };
        // Align live editor refs synchronously before publishing the new revision.
        // A generation callback must never see old rendered nodes paired with a new revision.
        options.onLoad?.(project);
        acknowledgedProjects.set(id, project);
        verifiedProjects.add(id);
        useCanvasStore.setState((state) => ({ projects: local ? state.projects.map((item) => item.id === id ? project : item) : [...state.projects, project] }));
        await flushCanvasStorePersistence();
        useSyncProgressStore.getState().setProjectProgress(id, { phase: "done", message: "已加载云端最新版本" });
        return project;
    });
    remoteProjectLoadPromises.set(id, request);
    const clearPending = () => { if (remoteProjectLoadPromises.get(id) === request) remoteProjectLoadPromises.delete(id); };
    void request.then(clearPending, clearPending);
    return request;
}

// Never replace edits made while the Agent was running. Leave the acknowledged
// baseline untouched on conflict, so automatic sync cannot silently overwrite it.
const agentCanvasListeners = new Set<(project: CanvasProject, previous: CanvasProject | undefined) => void>();

export function subscribeAgentCanvasRefresh(listener: (project: CanvasProject, previous: CanvasProject | undefined) => void) {
    agentCanvasListeners.add(listener);
    return () => { agentCanvasListeners.delete(listener); };
}

export async function refreshCanvasAfterAgent(id: string) {
    const epoch = sessionEpoch;
    return withRemoteUserDataSyncExclusive(async () => {
        if (!activeRemoteUserId) throw new Error("请先登录再刷新 Agent 画布结果");
        const { project } = await getRemoteCanvasProject(id);
        if (epoch !== sessionEpoch) throw new Error("账号已切换");
        const current = useCanvasStore.getState().projects.find((candidate) => candidate.id === id);
        const baseline = acknowledgedProjects.get(id);
        const cachedDirty = current && incrementalSession && !verifiedProjects.has(id) && current.remoteContentHash !== await canvasContentHash(current);
        if (epoch !== sessionEpoch) throw new Error("账号已切换");
        if (current && (cachedDirty || !sameCanvasContent(baseline, current)) && !sameCanvasContent(current, project)) {
            // Replayed events can request a snapshot while local edits await saving.
            // An unchanged, verified ancestor is not a concurrent cloud edit.
            if (!cachedDirty && current.revision === project.revision && baseline?.revision === project.revision && sameCanvasContent(baseline, project)) {
                useSyncProgressStore.getState().setProjectProgress(id, { phase: "pending", message: "本地修改等待保存到云端" });
                scheduleRemoteUserDataSync();
                return current;
            }
            await preserveAgentConflict(current);
            throw new Error("Agent 已更新服务端画布，但本地存在未同步编辑。已保留本地草稿，请加载云端最新版本。");
        }
        const projected = { ...project, viewport: current?.viewport || project.viewport, remoteContentHash: await canvasContentHash(project) };
        if (epoch !== sessionEpoch || useCanvasStore.getState().openProject(id) !== (current || null)) throw new Error("画布仍在更新，请重新同步 Agent 结果");
        try {
            if (!sameCanvasContent(current, projected)) {
                for (const listener of agentCanvasListeners) listener(projected, current);
            }
        } catch (error) {
            if (current) await preserveAgentConflict(current);
            throw error;
        }
        acknowledgedProjects.set(id, projected);
        verifiedProjects.add(id);
        useCanvasStore.setState((state) => ({ projects: [...state.projects.filter((candidate) => candidate.id !== id), projected] }));
        await flushCanvasStorePersistence();
        useSyncProgressStore.getState().setProjectProgress(id, { phase: "done", message: "已同步 Agent 画布结果" });
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
        if (incrementalSession && !verifiedProjects.has(id) && baseline.remoteContentHash !== await canvasContentHash(baseline)) throw new Error("本地缓存尚未核对，请加载云端最新版本");
        if (current.revision !== baseline.revision || !Number.isSafeInteger(baseline.revision)) throw new Error("画布同步基线已变化");
        for (const patch of patches) {
            if (!Number.isSafeInteger(patch.revision) || !Number.isSafeInteger(patch.baseRevision)) throw new Error("Agent 增量缺少版本，请重新读取画布");
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
        useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => project.id === id ? projected : project) }));
        await flushCanvasStorePersistence();
        useSyncProgressStore.getState().setProjectProgress(id, { phase: sameCanvasContent(remote, projected) ? "done" : "pending", message: "已同步 Agent 画布结果" });
        return projected;
    });
}

async function preserveAgentConflict(project: CanvasProject) {
    useSyncProgressStore.getState().setProjectProgress(project.id, { phase: "conflict", message: "云端画布已有更新，请保留草稿并加载最新版本" });
    const draftCount = await preserveCanvasSyncDraft(project);
    useSyncProgressStore.getState().setProjectProgress(project.id, { draftCount });
}

async function waitForRemoteProjectLoads() {
    const pending = [...remoteProjectLoadPromises.values()];
    if (pending.length) await Promise.all(pending);
}

export async function loadAssetLibraryPage(options: Parameters<typeof listRemoteAssetsPage>[0]) {
    const epoch = sessionEpoch;
    const result = await listRemoteAssetsPage(options);
    await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新读取素材");
        acceptRemoteAssets(result.assets);
    });
    return { ...result, assets: parseAssetRecordList(result.assets) };
}

function acceptRemoteAssets(remoteAssets: Asset[]) {
    const assets = parseAssetRecordList(remoteAssets);
    const current = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
    for (const asset of assets) {
        const local = current.get(asset.id);
        if (local && !sameEntitySnapshot(acknowledgedAssets.get(asset.id), local)) continue;
        acknowledgedAssets.set(asset.id, asset);
        verifiedAssets.add(asset.id);
        current.set(asset.id, asset);
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

async function loadReferencedAssets(ids: Iterable<string>) {
    const pending = [...new Set(ids)].filter((id) => !verifiedAssets.has(id));
    for (let offset = 0; offset < pending.length; offset += 100) {
        const { assets } = await getRemoteAssetsByIds(pending.slice(offset, offset + 100));
        acceptRemoteAssets(assets);
    }
}

export async function loadAssetsForUse(ids: Iterable<string>) {
    const epoch = sessionEpoch;
    const requestedIds = [...new Set(ids)];
    await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新读取素材");
        if (activeRemoteUserId) await loadReferencedAssets(requestedIds);
        const available = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
        if (requestedIds.some((id) => !available.has(id) || (activeRemoteUserId && !verifiedAssets.has(id)))) throw new Error("部分素材不存在或无权访问，请重新选择素材");
    });
}

const LOCAL_STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;

export async function syncRemoteUserData(userId?: string | null) {
	// 登录/切换账号时，服务端快照建立新的远端基线；本地 IndexedDB 只负责首屏缓存，
	// 不能把服务端已经删除或当前用户无权访问的实体重新补回去。后续增量保存必须基于这份基线做冲突校验。
    await withRemoteUserDataSyncExclusive(async () => {
        incrementalSession = false;
        activeRemoteUserId = userId || "";
        acknowledgedProjects.clear();
        queuedCollaborationProjects.clear();
        acknowledgedAssets.clear();
        if (!activeRemoteUserId) {
            remoteUserDataPhase = "inactive";
            return;
        }
        remoteUserDataPhase = "hydrating";
        try {
            // 登录只拉一次聚合快照。摘要列表再逐条请求详情会把 N 条数据放大成 2N+2 个请求，
            // 并且会在登录阶段同时触发大量媒体解析，任何一项失败都会污染登录结果。
            const snapshot = await getRemoteUserDataSnapshot();
            const localProjects = useCanvasStore.getState().projects;
            const remoteById = new Map(snapshot.projects.map((project) => [project.id, project]));
            // Archive unsynced work before replacing the active cache, including deleted remote canvases.
            for (const local of localProjects) {
                const clean = local.remoteContentHash && local.remoteContentHash === await canvasContentHash(local);
                if (!clean && !sameCanvasContent(local, remoteById.get(local.id))) await preserveCanvasSyncDraft(local);
            }
            const projects = await Promise.all(snapshot.projects.map(async (project) => {
                const local = localProjects.find((item) => item.id === project.id);
                const draftCount = (await readCanvasSyncDrafts(project.id)).length;
                useSyncProgressStore.getState().setProjectProgress(project.id, { phase: "done", draftCount, message: "已保存到云端" });
                const queue = await readCanvasCollaborationQueue(getActiveUserScope(), project.id);
                if (queue) {
                    queuedCollaborationProjects.add(project.id);
                    useSyncProgressStore.getState().setProjectProgress(project.id, { phase: queue.blocked ? "conflict" : "pending", message: queue.blocked ? "有修改需要确认，草稿已保留" : "正在恢复未完成的同步" });
                    return { ...(local || queue.source), collaborationEnabled: true };
                }
                return { ...project, viewport: local?.viewport || project.viewport || { x: 0, y: 0, k: 1 }, remoteContentHash: await canvasContentHash(project) };
            }));
            if (useCanvasStore.getState().projects !== localProjects) throw new Error("本地画布仍在更新，已保留本地内容，请重新同步");
            useCanvasStore.getState().replaceProjects(projects);
            useAssetStore.getState().replaceAssets(parseAssetRecordList(snapshot.assets));
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            acknowledgedProjects = new Map(projects.map((project) => [project.id, project]));
            acknowledgedAssets = new Map(parseAssetRecordList(snapshot.assets).map((asset) => [asset.id, asset]));
            remoteUserDataPhase = "ready";
            if (queuedCollaborationProjects.size) scheduleRemoteUserDataSync();
        } catch (error) {
            remoteUserDataPhase = "failed";
            throw error;
        }
    });
}

export function installRemoteUserDataAutoSync() {
    if (subscriptionsInstalled) return;
    subscriptionsInstalled = true;
    useCanvasStore.subscribe((state, previous) => {
        if (state.projects === previous.projects) return;
        const before = new Map(previous.projects.map((project) => [project.id, project]));
        const changed = state.projects.filter((project) => !sameCanvasContent(before.get(project.id), project));
        if (!changed.length && state.projects.length === previous.projects.length) return;
        if (remoteUserDataPhase === "ready") {
            for (const project of changed) {
                if (sameCanvasContent(acknowledgedProjects.get(project.id), project)) continue;
                if (useSyncProgressStore.getState().syncingProjects[project.id]?.phase === "conflict") continue;
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
    incrementalSession = false;
    verifiedProjects.clear();
    verifiedAssets.clear();
    remoteProjectLoadPromises.clear();
    activeRemoteUserId = "";
    remoteUserDataPhase = "inactive";
    acknowledgedAssets.clear();
    acknowledgedProjects.clear();
    queuedCollaborationProjects.clear();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    retryAttempt = 0;
    syncScheduledAt = 0;
    if (syncTimer) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
    }
    syncQueued = false;
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
    const pending = remoteOperationTail.then(() => undefined, () => undefined).then(operation);
    remoteOperationTail = pending.then(
        () => undefined,
        () => undefined,
    );
    return pending;
}

export function scheduleRemoteUserDataSync() {
    if (!activeRemoteUserId || remoteUserDataPhase !== "ready") return;
    if (syncPromise) {
        syncQueued = true;
        return;
    }
    if (!syncScheduledAt) syncScheduledAt = Date.now();
    if (syncTimer) window.clearTimeout(syncTimer);
    const delay = Math.max(0, Math.min(REMOTE_SYNC_DEBOUNCE_MS, 500 - (Date.now() - syncScheduledAt)));
    syncTimer = window.setTimeout(() => {
        syncTimer = null;
        syncScheduledAt = 0;
        void saveRemoteUserDataNow().catch((error) => console.warn("云端自动同步失败", error));
    }, delay);
}

export function formatLocalSavedRemotePending(localAction: string, error: unknown): string {
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "未知错误";
    if (error instanceof ApiError && (error.status === 409 || error.status === 428)) {
        return `${localAction}，云端同步已暂停：${detail}。请保留草稿并加载最新版本。`;
    }
    return `${localAction}，云端同步失败：${detail}。将自动重试。`;
}

/** 本地写已成功、云端同步失败：排队同一幂等重试，并返回可直接展示的 warning。不得回滚本地写，也不得说成已保存到云端。 */
export function localSavedRemotePendingMessage(localAction: string, error: unknown): string {
    scheduleRemoteUserDataSync();
    return formatLocalSavedRemotePending(localAction, error);
}

export async function createCanvasProjectWithRemoteSync(title: string, projectId?: string, initialContent?: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">>) {
    const id = useCanvasStore.getState().createProject(title, projectId);
    if (initialContent) useCanvasStore.getState().updateProject(id, initialContent);
    if (!activeRemoteUserId) return { id, syncError: new Error("尚未建立云端同步会话") };
    try {
        await saveRemoteUserDataNow(id);
        return { id };
    } catch (syncError) {
        scheduleRemoteUserDataSync();
        return { id, syncError };
    }
}

export async function deleteAssetWithRemoteSync(id: string) {
    const epoch = sessionEpoch;
    const assetId = id.trim();
    if (!assetId) throw new Error("素材 ID 不能为空");
    await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，请重新选择要删除的素材");
        if (activeRemoteUserId) {
            requireRemoteUserDataBaseline();
            await deleteRemoteAsset(assetId);
            acknowledgedAssets.delete(assetId);
        }
        await useAssetStore.getState().removeAsset(assetId);
        await flushAssetStorePersistence();
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

export async function saveRemoteUserDataNow(input?: string | readonly string[] | { force?: boolean }) {
    const projectId = typeof input === "string" || Array.isArray(input) ? input as string | readonly string[] : undefined;
    const options = input && typeof input === "object" && !Array.isArray(input) ? input as { force?: boolean } : {};
    const epoch = sessionEpoch;
    if (!activeRemoteUserId) throw new Error("尚未建立云端同步会话，本地内容尚未保存到云端");
    requireRemoteUserDataBaseline();
    const assertNoConflict = () => {
        const ids = projectId === undefined ? useCanvasStore.getState().projects.map((project) => project.id)
            : typeof projectId === "string" ? [projectId] : projectId;
        if (ids.some((id) => useSyncProgressStore.getState().syncingProjects[id]?.phase === "conflict")) {
            throw new ApiError("有修改需要确认，请先处理冲突；本地内容仍然保留", { status: 409 });
        }
    };
    if (projectId !== undefined) assertNoConflict();
    await waitForRemoteProjectLoads();
    if (syncPromise) {
        syncQueued = true;
        await syncPromise;
        assertNoConflict();
        return;
    }
    syncPromise = withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止旧会话保存");
        await drainRemoteUserDataChanges(options);
    });
    try {
        await syncPromise;
        retryAttempt = 0;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = undefined;
        assertNoConflict();
    } catch (error) {
        if (activeRemoteUserId && !(error instanceof ApiError && [400, 401, 403, 404, 409, 428].includes(error.status || 0))) {
            const scope = getActiveUserScope();
            if (!retryTimer) retryTimer = setTimeout(() => {
                retryTimer = undefined;
                if (getActiveUserScope() === scope && activeRemoteUserId) void saveRemoteUserDataNow().catch(() => undefined);
            }, Math.min(30_000, 1000 * 2 ** Math.min(retryAttempt++, 5)));
        }
        throw error;
    } finally {
        syncPromise = null;
        if (syncQueued) scheduleRemoteUserDataSync();
    }
}

/**
 * 修复媒体与素材的绑定，再按素材先于画布的顺序保存。
 * 素材修复可采用远端素材基线；画布始终携带原始 revision，不能绕过版本校验。
 */
export async function forceOverwriteRemoteCanvasSync(): Promise<CanvasAssetRebindResult> {
    const epoch = sessionEpoch;
    if (!activeRemoteUserId) throw new Error("尚未建立云端同步会话，请登录后重试");
    requireRemoteUserDataBaseline();
    await waitForRemoteProjectLoads();
    const rebind = await withRemoteUserDataSyncExclusive(async () => {
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止修复保存");
        requireRemoteUserDataBaseline();
        const projects = useCanvasStore.getState().projects;
        // 服务端素材记录是 guard 实际校验的事实；本地缓存可能落后，须先取回再判定绑定一致性。
        const claimedIds = [...collectCanvasMediaAssetIds(projects)];
        const remoteAssets: Asset[] = [];
        for (let offset = 0; offset < claimedIds.length; offset += 100) {
            const { assets } = await getRemoteAssetsByIds(claimedIds.slice(offset, offset + 100));
            remoteAssets.push(...assets);
        }
        const remoteById = new Map(remoteAssets.map((asset) => [asset.id, asset]));
        const merged = [...remoteAssets, ...useAssetStore.getState().assets.filter((asset) => !remoteById.has(asset.id))];
        const result = rebindInconsistentCanvasAssets(parseAssetRecordList(merged));
        await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
        return result;
    });
    await saveRemoteUserDataNow({ force: true });
    return rebind;
}

async function drainRemoteUserDataChanges(options: { force?: boolean } = {}) {
    const uploaded = new Map<string, string>();
    do {
        syncQueued = false;
        await saveRemoteUserDataBatch(uploaded, options);
    } while (syncQueued);
}

async function saveRemoteUserDataBatch(uploaded: Map<string, string>, options: { force?: boolean } = {}) {
    const scope = getActiveUserScope();
    const assertScope = () => {
        if (getActiveUserScope() !== scope || !activeRemoteUserId) throw new Error("账号已切换，待同步修改保留在原账号");
    };
    const changedProjectIds = new Set(useCanvasStore.getState().projects.filter((project) => !sameCanvasContent(acknowledgedProjects.get(project.id), project)).map((project) => project.id));
    repairMissingCanvasAssets(changedProjectIds, incrementalSession);
    const currentProjects = useCanvasStore.getState().projects;
    const currentAssets = useAssetStore.getState().assets;
    const dirtyProjects = currentProjects.filter((project) => (!sameCanvasContent(acknowledgedProjects.get(project.id), project) || queuedCollaborationProjects.has(project.id))
        && useSyncProgressStore.getState().syncingProjects[project.id]?.phase !== "conflict");
    const dirtyAssets = currentAssets.filter((asset) => !sameEntitySnapshot(acknowledgedAssets.get(asset.id), asset));
    if (!dirtyProjects.length && !dirtyAssets.length) return;

    if (incrementalSession) {
        for (const source of dirtyAssets) {
            const baseline = acknowledgedAssets.get(source.id);
            if (!baseline || verifiedAssets.has(source.id)) continue;
            const { asset } = await getRemoteAsset(source.id);
            if (Date.parse(asset.updatedAt) !== Date.parse(baseline.updatedAt)) {
                if (!options.force) throw new Error("素材远端版本已变化，已停止覆盖，请重新打开素材库");
                // 强制覆盖是用户显式指令：采纳远端版本为新基线后继续用本地内容覆盖。
                acknowledgedAssets.set(source.id, asset);
            }
            verifiedAssets.add(source.id);
        }
    }

    // 转换后的 resource: 引用只属于发往服务端的 payload，不能反写整份实时 store。
    // 已确认快照记录的是本次上传所依据的本地实体；上传期间的新编辑会在下一轮继续提交。
    // 素材先于画布提交。这样画布中的 resource: 引用一旦成为远端事实，
    // 对应 Asset 已经存在，刷新或换设备不会出现只占容量、不见素材的窗口。
    for (const source of dirtyAssets) {
        const remotePayload = await ensureRemoteResourceReferences(assetForRemoteSync(source), uploaded);
        await upsertRemoteAsset(remotePayload);
        acknowledgedAssets.set(source.id, source);
        verifiedAssets.add(source.id);
    }
    const errors: unknown[] = [];
    for (const source of dirtyProjects) {
        assertScope();
        const keysToUpload = collectLocalMediaKeys(source);
        const total = keysToUpload.length;
        useSyncProgressStore.getState().setProjectProgress(source.id, {
                projectId: source.id,
                total,
                completed: 0,
                phase: total > 0 ? "uploading" : "saving",
                message: total > 0 ? "正在同步媒体至云端" : "正在保存画布",
            });
        const onMediaUploaded = () => {
            if (total > 0) {
                useSyncProgressStore.getState().incrementProjectCompleted(source.id);
            }
        };
        try {
            if (!Number.isSafeInteger(source.revision) || source.revision! < 0) {
                throw new ApiError("缺少画布版本，请保留草稿并加载云端最新版本", { status: 428 });
            }
            const hash = await canvasContentHash(source);
            assertScope();
            const remotePayload = await ensureRemoteResourceReferences(source, uploaded, onMediaUploaded);
            assertScope();
            if (total > 0) {
                useSyncProgressStore.getState().setProjectProgress(source.id, {
                    phase: "saving",
                    message: "正在保存画布结构",
                });
            }
            if (source.collaborationEnabled) {
                await saveCollaborativeCanvasProject(source, remotePayload, uploaded);
                continue;
            }
            const { project: saved } = await upsertRemoteCanvasProject(sanitizeCanvasProjectForRemoteSync(remotePayload));
            if (!Number.isSafeInteger(saved.revision) || saved.revision !== source.revision! + 1) {
                throw new ApiError("服务端未返回有效画布版本，请加载云端最新版本", { status: 409 });
            }
            const current = useCanvasStore.getState().openProject(source.id);
            if (current && current.revision !== source.revision) {
                throw new ApiError("画布基线已变化，请加载云端最新版本", { status: 409 });
            }
            const acknowledged = { ...source, revision: saved.revision, remoteContentHash: hash };
            acknowledgedProjects.set(source.id, acknowledged);
            verifiedProjects.add(source.id);
            if (current) {
                useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => project === current
                    ? { ...project, revision: saved.revision, remoteContentHash: hash } : project) }));
            }
            await flushCanvasStorePersistence();
            const pending = !sameCanvasContent(source, useCanvasStore.getState().openProject(source.id) || undefined);
            useSyncProgressStore.getState().setProjectProgress(source.id, { phase: pending ? "pending" : "done", message: pending ? "有新修改等待保存" : "已保存到云端" });
            if (pending) syncQueued = true;
        } catch (error) {
            assertScope();
            const conflict = error instanceof ApiError && (error.status === 409 || error.status === 428);
            useSyncProgressStore.getState().setProjectProgress(source.id, {
                phase: conflict ? "conflict" : "error",
                message: error instanceof Error ? error.message : "云端同步失败，等待重试",
            });
            if (conflict) {
                try {
                    const current = useCanvasStore.getState().openProject(source.id) || source;
                    const draftCount = await preserveCanvasSyncDraft(current, scope);
                    assertScope();
                    const base = acknowledgedProjects.get(source.id);
                    if (base) {
                        try {
                            const latest = (await getRemoteCanvasProject(source.id)).project;
                            assertScope();
                            await saveCanvasConflict({
                                projectId: source.id,
                                base,
                                local: current,
                                remote: latest,
                                fields: buildCanvasConflictFields(base, current, latest),
                            }, scope);
                        } catch (conflictSnapshotError) {
                            console.warn("保存协作冲突三方快照失败:", conflictSnapshotError);
                        }
                    }
                    assertScope();
                    useSyncProgressStore.getState().setProjectProgress(source.id, { draftCount });
                } catch (draftError) {
                    assertScope();
                    useSyncProgressStore.getState().setProjectProgress(source.id, { message: "本地草稿保存失败，请勿关闭页面；请先下载草稿" });
                    errors.push(draftError);
                }
            }
            errors.push(error);
        }
    }
    if (errors.length) throw errors[0];
    if (dirtyProjects.length) void appQueryClient.invalidateQueries({ queryKey: ["canvas-library"] });
}

async function buildCollaborativeOperations(initial: CanvasProject, remotePayload: CanvasProject) {
    if (!initial || !Number.isSafeInteger(initial.revision)) {
        throw new ApiError("多人协作画布缺少可靠基线，请重新打开画布", { status: 428 });
    }
    let remote = initial;
    const localNodes = remotePayload.nodes || [];
    const baseNodes = new Map((initial.nodes || []).map((node) => [node.id, node]));
    const localNodesById = new Map(localNodes.map((node) => [node.id, node]));
    const operations: CanvasCollaborationOperation[] = [];
    const submit = async (operation: CanvasCollaborationOperation) => {
        operations.push({ ...operation, baseRevision: remote.revision || 0 });
        const applied = applyCanvasCollaborationOperation(remote, { ...operation, revision: (remote.revision || 0) + 1 });
        if (!applied.applied) throw new ApiError("本地节点关系不完整，请检查连线后重试", { status: 409 });
        remote = applied.project;
    };

    // Project-level edits use the same three-way field check as node edits.
    // Viewport, revision, timestamps and collaboration state stay server/local
    // metadata and are deliberately excluded from this operation.
    const rootKeys: Array<keyof CanvasProject> = [
        "title", "projectId", "chatSessions", "activeChatId",
        "starterMode", "appearance", "backgroundMode", "showImageInfo", "directorScenes", "timeline",
    ];
    const rootBefore: Record<string, unknown> = {};
    const rootPatch: Record<string, unknown> = {};
    for (const key of rootKeys) {
        const beforeValue = initial[key];
        const nextValue = remotePayload[key];
        if (canvasCollaborationValueEqual(beforeValue, nextValue)) continue;
        rootBefore[key] = beforeValue === undefined ? null : beforeValue;
        rootPatch[key] = nextValue === undefined ? null : nextValue;
    }
    if (Object.keys(rootPatch).length) {
        await submit({
            opId: newCanvasCollaborationOperationID(),
            kind: "update_canvas",
            rootBefore,
            rootPatch,
        });
    }

    // Existing nodes are compared by top-level fields. The server applies only
    // the changed fields, so a remote position edit does not overwrite a local
    // prompt edit and vice versa.
    for (const [nodeID, baseNode] of baseNodes) {
        const localNode = localNodesById.get(nodeID);
        if (!localNode) continue;
        const patch: Record<string, unknown> = {};
        const before: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(baseNode), ...Object.keys(localNode)])) {
            if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
            const beforeValue = (baseNode as unknown as Record<string, unknown>)[key];
            const nextValue = (localNode as unknown as Record<string, unknown>)[key];
            if (canvasCollaborationValueEqual(beforeValue, nextValue)) continue;
            before[key] = beforeValue === undefined ? null : beforeValue;
            patch[key] = nextValue === undefined ? null : nextValue;
        }
        if (!Object.keys(patch).length) continue;
        await submit({
            opId: newCanvasCollaborationOperationID(),
            kind: "update_node",
            nodeId: nodeID,
            incarnation: canvasNodeIncarnation(baseNode),
            fieldGroup: canvasCollaborationFieldGroup(Object.keys(patch)),
            before,
            patch,
        });
    }

    // Deletions run before new-node batches. This prevents a local graph that
    // deletes A and also connects a new child to A from partially publishing
    // the child before the deletion conflict is discovered.
    for (const [nodeID, baseNode] of baseNodes) {
        if (localNodesById.has(nodeID)) continue;
        const initialIncidentConnections = (initial.connections || [])
            .filter((connection) => connection.fromNodeId === nodeID || connection.toNodeId === nodeID)
        const currentRemoteConnectionIDs = new Set((remote.connections || []).map((connection) => connection.id));
        // A previous local deletion may already have removed a shared edge.
        // Keep only still-present edges from the original read set; any new
        // remote edge remains an unexpected relation and causes a conflict.
        const expectedConnections = initialIncidentConnections.filter((connection) => currentRemoteConnectionIDs.has(connection.id));
        await submit({
            opId: newCanvasCollaborationOperationID(),
            kind: "delete_node",
            nodeId: nodeID,
            incarnation: canvasNodeIncarnation(baseNode),
            before: baseNode as unknown as Record<string, unknown>,
            expectedConnectionIds: expectedConnections.map((connection) => connection.id).sort(),
            expectedConnections: expectedConnections as unknown as Array<Record<string, unknown>>,
        });
    }

    // New nodes and their new relations are submitted as one atomic batch. If
    // an existing endpoint was deleted by another member, the whole batch is
    // rejected and the new nodes remain in the local conflict draft.
    const newNodes = localNodes.filter((node) => !baseNodes.has(node.id));
    if (newNodes.length) {
        const newIDs = new Set(newNodes.map((node) => node.id));
        const newConnections = (remotePayload.connections || []).filter((connection) => {
            return newIDs.has(connection.fromNodeId) || newIDs.has(connection.toNodeId);
        });
        await submit({
            opId: newCanvasCollaborationOperationID(),
            kind: "create_nodes",
            nodes: newNodes as unknown as Array<Record<string, unknown>>,
            connections: newConnections as unknown as Array<Record<string, unknown>>,
            // The new nodes may connect to existing endpoints. Keep the
            // relation set observed immediately before this atomic batch so a
            // concurrent edge change cannot be silently folded into it.
            expectedConnections: (remote.connections || []) as unknown as Array<Record<string, unknown>>,
        });
    }

    const remoteConnectionIDs = new Set((remote.connections || []).map((connection) => connection.id));
    const desiredConnections = remotePayload.connections || [];
    const desiredConnectionIDs = new Set(desiredConnections.map((connection) => connection.id));
    if (!canvasCollaborationConnectionListsEqual(remote.connections || [], desiredConnections) || remoteConnectionIDs.size !== desiredConnectionIDs.size) {
        await submit({
            opId: newCanvasCollaborationOperationID(),
            kind: "update_connections",
            expectedConnectionIds: [...remoteConnectionIDs].sort(),
            expectedConnections: (remote.connections || []) as unknown as Array<Record<string, unknown>>,
            connections: desiredConnections as unknown as Array<Record<string, unknown>>,
        });
    }

    return operations;
}

async function saveCollaborativeCanvasProject(source: CanvasProject, remotePayload: CanvasProject, _uploaded: Map<string, string>) {
    const scope = getActiveUserScope();
    return withCanvasCollaborationQueueLock(scope, source.id, async () => {
        const assertScope = () => {
            if (getActiveUserScope() !== scope || !activeRemoteUserId) throw new Error("账号已切换，待同步修改保留在原账号");
        };
        assertScope();
        let queue = await readCanvasCollaborationQueue(scope, source.id);
        assertScope();
        if (queue?.blocked) throw new ApiError("有修改需要确认，草稿已保留", { status: 409 });
        if (!queue) {
            const initial = acknowledgedProjects.get(source.id);
            if (!initial || !Number.isSafeInteger(initial.revision)) throw new ApiError("协作画布缺少可靠基线，请重新打开", { status: 428 });
            queue = { base: initial, source, target: remotePayload, confirmed: initial, pending: await buildCollaborativeOperations(initial, remotePayload) };
            await writeCanvasCollaborationQueue(scope, source.id, queue);
            assertScope();
            queuedCollaborationProjects.add(source.id);
        }
        // Persist exact requests before sending. A lost acknowledgement repeats
        // the same opId, baseRevision and payload after a retry or browser restart.
        let needsFreshSnapshot = true;
        while (queue.pending.length) {
            assertScope();
            const operation = queue.pending[0];
            try {
                const result = await submitCanvasCollaborationOperation(source.id, operation);
                if (!result.document) throw new Error("服务端未返回操作确认，修改保留等待重试");
                needsFreshSnapshot = result.status === "already_applied";
                assertScope();
                queue = { ...queue, confirmed: result.document, pending: queue.pending.slice(1) };
                await writeCanvasCollaborationQueue(scope, source.id, queue);
            } catch (error) {
                if (error instanceof ApiError && (error.status === 409 || error.status === 428)) {
                    queue.blocked = true;
                    await writeCanvasCollaborationQueue(scope, source.id, queue);
                    throw new ApiError(formatCanvasCollaborationConflict(operation, error.message, new Map(queue.base.nodes.map((n) => [n.id, n]))), { status: error.status, cause: error });
                }
                throw error;
            }
        }
        // The last receipt may be an old already_applied acknowledgement. Fetch
        // once per batch, never replace later commits with that historical receipt.
        const remote = needsFreshSnapshot ? (await getRemoteCanvasProject(source.id)).project : queue.confirmed;
        const hash = await canvasContentHash(remote);
        assertScope();
        const current = useCanvasStore.getState().openProject(source.id);
        const rebased = current && rebaseCanvasCollaborationProject(queue.source, current, remote);
        const next = { ...(rebased?.project || remote), remoteContentHash: hash, viewport: current?.viewport || remote.viewport };
        if (rebased?.conflicts.length) {
            await preserveCanvasSyncDraft(current!, scope);
            await persistCanvasConflictSnapshot(source.id, queue.source, current, remote, scope);
            queue.blocked = true;
            await writeCanvasCollaborationQueue(scope, source.id, queue);
            throw new ApiError("保存期间同一处内容又有修改，已保留草稿供确认", { status: 409 });
        }
        acknowledgedProjects.set(source.id, { ...remote, remoteContentHash: hash });
        verifiedProjects.add(source.id);
        publishCollaborativeProject(source.id, current || undefined, next);
        await flushCanvasStorePersistence();
        assertScope();
        if (useSyncProgressStore.getState().syncingProjects[source.id]?.phase === "conflict") {
            // The editor may detect a newer edit while applying the receipt.
            // Keep that conflict and the completed receipt available for resolution.
            await writeCanvasCollaborationQueue(scope, source.id, { ...queue, blocked: true });
            return remote;
        }
        await writeCanvasCollaborationQueue(scope, source.id, null);
        assertScope();
        queuedCollaborationProjects.delete(source.id);
        const dirty = !sameCanvasContent(remote, useCanvasStore.getState().openProject(source.id) || undefined);
        if (dirty) syncQueued = true;
        useSyncProgressStore.getState().setProjectProgress(source.id, { phase: dirty ? "pending" : "done", message: dirty ? "有新修改等待同步" : "已同步" });
        return remote;
    });
}

/**
 * Apply a user-selected three-way merge as normal collaboration operations.
 * The remote revision is the optimistic-lock base, so a new remote edit
 * during conflict resolution is rejected and the resolver stays open.
 */
export async function resolveCanvasConflict(snapshot: CanvasConflictSnapshot, merged: CanvasProject) {
    const scope = getActiveUserScope();
    return withRemoteUserDataSyncExclusive(async () => {
        const assertScope = () => {
            if (getActiveUserScope() !== scope || !activeRemoteUserId) throw new Error("账号已切换，请在原账号继续处理草稿");
        };
        assertScope();
        requireRemoteUserDataBaseline();
        const latest = (await getRemoteCanvasProject(snapshot.projectId)).project;
        assertScope();
        if (latest.revision !== snapshot.remote.revision) {
            const draftCount = await preserveCanvasSyncDraft(merged, scope);
            await persistCanvasConflictSnapshot(snapshot.projectId, snapshot.remote, merged, latest, scope);
            assertScope();
            useSyncProgressStore.getState().setProjectProgress(snapshot.projectId, {
                phase: "conflict",
                draftCount,
                message: "云端又有新修改，请重新确认合并内容",
            });
            throw new ApiError("云端又有新修改，请重新打开冲突处理", { status: 409 });
        }
        acknowledgedProjects.set(snapshot.projectId, latest);
        await discardCanvasCollaborationQueue(snapshot.projectId);
        assertScope();
        const source = { ...merged, revision: latest.revision, collaborationEnabled: true };
        useSyncProgressStore.getState().setProjectProgress(snapshot.projectId, { phase: "saving", message: "正在同步确认后的内容" });
        // This is the user's explicit resolution. Adopt it before sending, so
        // the old draft is not replayed over the chosen fields on acknowledgement.
        publishCollaborativeProject(snapshot.projectId, undefined, source);
        try {
            const remotePayload = await ensureRemoteResourceReferences(source, new Map());
            assertScope();
            await saveCollaborativeCanvasProject(source, remotePayload, new Map());
            assertScope();
            if (useSyncProgressStore.getState().syncingProjects[snapshot.projectId]?.phase === "conflict") throw new ApiError("合并期间又有新修改，请再次确认", { status: 409 });
            const next = useCanvasStore.getState().openProject(snapshot.projectId)!;
            await clearCanvasConflict(snapshot.projectId, scope);
            return next;
        } catch (error) {
            assertScope();
            if (error instanceof ApiError && (error.status === 409 || error.status === 428)) {
                const currentLatest = (await getRemoteCanvasProject(snapshot.projectId)).project;
                assertScope();
                const current = useCanvasStore.getState().openProject(snapshot.projectId) || merged;
                const draftCount = await preserveCanvasSyncDraft(current, scope);
                await persistCanvasConflictSnapshot(snapshot.projectId, snapshot.remote, current, currentLatest, scope);
                assertScope();
                useSyncProgressStore.getState().setProjectProgress(snapshot.projectId, {
                    phase: "conflict",
                    draftCount,
                    message: "云端又有新修改，请重新确认合并内容",
                });
            } else {
                useSyncProgressStore.getState().setProjectProgress(snapshot.projectId, { phase: "error", message: "合并尚未同步，请重试；确认后的内容仍在本地" });
            }
            throw error;
        }
    });
}

async function discardCanvasCollaborationQueue(id: string) {
    const scope = getActiveUserScope();
    await withCanvasCollaborationQueueLock(scope, id, async () => {
        const queue = await readCanvasCollaborationQueue(scope, id);
        if (queue) {
            await preserveCanvasSyncDraft(queue.source, scope);
            await writeCanvasCollaborationQueue(scope, id, null);
        }
        if (getActiveUserScope() === scope) queuedCollaborationProjects.delete(id);
    });
}

function newCanvasCollaborationOperationID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `canvas-op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCanvasCollaborationConflict(operation: CanvasCollaborationOperation, message: string, baseNodes: Map<string, CanvasNodeData>) {
    const node = operation.nodeId ? baseNodes.get(operation.nodeId) : undefined;
    const nodeLabel = node?.title?.trim() || "未命名节点";
    if (operation.kind === "delete_node" && /已被删除|已经被删除|删除了|存续版本/.test(message)) {
        return message.includes("删除了") ? message : `节点“${nodeLabel}”已被其他成员删除，你的修改已保留为待处理草稿。`;
    }
    if (operation.kind === "update_node" && /已被删除|已经删除|删除了|存续版本/.test(message)) {
        return message.includes("删除了") ? message : `节点“${nodeLabel}”已被其他成员删除，你对它的修改已保留为待处理草稿。`;
    }
    if (operation.kind === "update_node" && /字段已被其他成员修改|内容已变化/.test(message)) {
        return `节点“${nodeLabel}”刚被其他成员修改，双方内容没有自动覆盖；你的修改已保留为待处理草稿。`;
    }
    if (operation.kind === "create_nodes") {
        return `新增节点组与其他成员的最新画布关系发生冲突，整组修改已保留为待处理草稿。`;
    }
    if (operation.kind === "update_connections") {
        return `画布连线刚被其他成员修改，你的连线修改已保留为待处理草稿。`;
    }
    return message;
}

function canvasCollaborationValueEqual(left: unknown, right: unknown) {
    return collaborationValueEqual(left, right);
}

function canvasNodeIncarnation(node: CanvasProject["nodes"][number]) {
    const value = (node.metadata as unknown as Record<string, unknown> | undefined)?.collaborationIncarnation;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function canvasCollaborationFieldGroup(keys: string[]) {
    if (keys.some((key) => key === "position" || key === "width" || key === "height")) return "geometry";
    if (keys.some((key) => key === "metadata" || key === "type")) return "config";
    return "content";
}

function canvasCollaborationConnectionListsEqual(left: CanvasProject["connections"], right: CanvasProject["connections"]) {
    if (left.length !== right.length) return false;
    const byID = new Map(left.map((connection) => [connection.id, connection]));
    return right.every((connection) => canvasCollaborationValueEqual(byID.get(connection.id), connection));
}

// Pull shared-canvas changes without replacing a local draft. A clean editor
// follows the latest remote revision; a dirty editor keeps its work and moves
// into the same conflict/draft state used by an ordinary save conflict.
export type CollaborativeCanvasPullResult = {
    changed: boolean;
    project?: CanvasProject;
    usedIncremental: boolean;
};

function publishCollaborativeProject(id: string, previous: CanvasProject | undefined, project: CanvasProject) {
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === id ? project : item) }));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("canvas-collaboration-projection", { detail: { canvasId: id, previous, project } }));
    }
}

export async function preserveCanvasLiveConflict(base: CanvasProject, local: CanvasProject, remote: CanvasProject) {
    const scope = getActiveUserScope();
    useSyncProgressStore.getState().setProjectProgress(local.id, { phase: "conflict", message: "你正在编辑的内容也被其他成员修改，请确认后继续" });
    try {
        const draftCount = await preserveCanvasSyncDraft(local, scope);
        await persistCanvasConflictSnapshot(local.id, base, local, remote, scope);
        if (getActiveUserScope() === scope) useSyncProgressStore.getState().setProjectProgress(local.id, { draftCount });
    } catch {
        if (getActiveUserScope() === scope) useSyncProgressStore.getState().setProjectProgress(local.id, { message: "本地草稿保存失败，请先下载草稿再关闭页面" });
    }
}

async function acceptCollaborativeSnapshot(id: string, remote: CanvasProject, usedIncremental: boolean, scope: string): Promise<CollaborativeCanvasPullResult> {
    const hash = await canvasContentHash(remote);
    if (getActiveUserScope() !== scope || !activeRemoteUserId) return { changed: false, usedIncremental };
    const acknowledged = acknowledgedProjects.get(id);
    if (!acknowledged || (remote.revision || 0) < (acknowledged.revision || 0)) return { changed: false, usedIncremental };
    if (sameCanvasContent(acknowledged, remote) && acknowledged.revision === remote.revision) return { changed: false, usedIncremental };
    if (useSyncProgressStore.getState().syncingProjects[id]?.phase === "conflict") return { changed: false, usedIncremental };
    const local = useCanvasStore.getState().openProject(id);
    if (!local) return { changed: false, usedIncremental };
    const merged = rebaseCanvasCollaborationProject(acknowledged, local, remote);
    if (merged.conflicts.length) {
        await preserveCanvasLiveConflict(acknowledged, local, remote);
        return { changed: false, usedIncremental };
    }
    const next = { ...merged.project, remoteContentHash: hash };
    acknowledgedProjects.set(id, { ...remote, remoteContentHash: hash });
    publishCollaborativeProject(id, local, next);
    await flushCanvasStorePersistence();
    if (getActiveUserScope() !== scope || !activeRemoteUserId) return { changed: false, usedIncremental };
    if (useSyncProgressStore.getState().syncingProjects[id]?.phase === "conflict") return { changed: true, usedIncremental };
    const dirty = !sameCanvasContent(remote, useCanvasStore.getState().openProject(id) || undefined);
    useSyncProgressStore.getState().setProjectProgress(id, { phase: dirty ? "pending" : "done", message: dirty ? "有修改等待同步" : "已同步" });
    if (dirty) scheduleRemoteUserDataSync();
    return { changed: true, usedIncremental, project: next };
}

async function pullCollaborativeDelta(id: string, acknowledged: CanvasProject): Promise<{ project: CanvasProject; changed: boolean } | null> {
    const baseRevision = Number.isSafeInteger(acknowledged.revision) ? acknowledged.revision! : 0;
    const events = await listCanvasCollaborationEvents(id, baseRevision, 100);
    if (events.currentRevision === baseRevision) return { project: acknowledged, changed: false };
    if (events.events.length !== events.currentRevision - baseRevision) return null;
    let project = acknowledged;
    for (const event of events.events.sort((left, right) => left.revision - right.revision)) {
        const operation = event.operation as CanvasCollaborationOperationDelta | undefined;
        if (!operation) return null;
        const applied = applyCanvasCollaborationOperation(project, operation);
        if (applied.requiresResync) return null;
        project = applied.project;
    }
    if (project.revision !== events.currentRevision) return null;
    return { project, changed: true };
}

// Applies a websocket operation without waiting for the events endpoint. The
// authenticated events pull remains the recovery path for gaps, older servers,
// and private restore operations.
export async function applyCanvasCollaborationRemoteOperation(id: string, operation: CanvasCollaborationOperationDelta): Promise<CollaborativeCanvasPullResult | null> {
    const scope = getActiveUserScope();
    return withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        if (getActiveUserScope() !== scope) return { changed: false, usedIncremental: true };
        // A pending receipt must be resolved by replaying its exact request.
        if (await readCanvasCollaborationQueue(scope, id)) return { changed: false, usedIncremental: true };
        if (getActiveUserScope() !== scope || !activeRemoteUserId) return { changed: false, usedIncremental: true };
        const acknowledged = acknowledgedProjects.get(id);
        if (!acknowledged?.collaborationEnabled) return null;
        const applied = applyCanvasCollaborationOperation(acknowledged, operation);
        if (applied.requiresResync) return null;
        if (!applied.applied) return { changed: false, usedIncremental: true };
        return acceptCollaborativeSnapshot(id, applied.project, true, scope);
    });
}

export async function pullLatestCollaborativeCanvasProject(id: string): Promise<CollaborativeCanvasPullResult> {
    const scope = getActiveUserScope();
    return withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        if (getActiveUserScope() !== scope || await readCanvasCollaborationQueue(scope, id)) return { changed: false, usedIncremental: false };
        if (getActiveUserScope() !== scope || !activeRemoteUserId) return { changed: false, usedIncremental: false };
        const acknowledged = acknowledgedProjects.get(id);
        let remote: CanvasProject;
        let usedIncremental = false;
        let changed = false;
        if (acknowledged?.collaborationEnabled) {
            const incremental = await pullCollaborativeDelta(id, acknowledged).catch(() => null);
            if (incremental) {
                remote = incremental.project;
                changed = incremental.changed;
                usedIncremental = true;
            } else {
                remote = (await getRemoteCanvasProject(id)).project;
                changed = !sameCanvasContent(acknowledged, remote);
            }
        } else {
            remote = (await getRemoteCanvasProject(id)).project;
            changed = true;
        }
        if (!remote.collaborationEnabled) return { changed: false, usedIncremental };
        if (!changed && acknowledged?.revision === remote.revision) return { changed: false, usedIncremental };
        return acceptCollaborativeSnapshot(id, remote, usedIncremental, scope);
    });
}

// Keep automatic saves behind the merge receipt. Accept the committed target
// through the normal rebase path so edits made during the request survive.
export async function mergeCanvasBranchWithSync(branchId: string, input: Parameters<typeof mergeCanvasBranch>[1]) {
    const scope = getActiveUserScope();
    return withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        if (getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开合并窗口");
        const result = await mergeCanvasBranch(branchId, input);
        if (getActiveUserScope() !== scope) return result;
        if (result.project) {
            try { await acceptCollaborativeSnapshot(result.targetCanvasId, result.project, false, scope); }
            catch { throw new Error("合并已完成，但本机显示更新失败，请重新打开接收画布查看结果"); }
        }
        return result;
    });
}

async function persistCanvasConflictSnapshot(projectId: string, base: CanvasProject | undefined, local: CanvasProject | null | undefined, remote: CanvasProject, scope = getActiveUserScope()) {
    if (!base || !local) return;
    try {
        await saveCanvasConflict({
            projectId,
            base,
            local,
            remote,
            fields: buildCanvasConflictFields(base, local, remote),
        }, scope);
    } catch (error) {
        // The normal draft remains available even if IndexedDB is unavailable;
        // keep the conflict state visible and let the user use that fallback.
        console.warn("保存协作冲突三方快照失败:", error);
    }
}

function collectLocalMediaKeys(value: unknown, set = new Set<string>()): string[] {
    if (!value || typeof value !== "object") return [...set];
    if (Array.isArray(value)) {
        for (const item of value) collectLocalMediaKeys(item, set);
        return [...set];
    }
    const record = value as Record<string, unknown>;
    const storageKey = typeof record.storageKey === "string" ? record.storageKey : "";
    if (isLocalStorageKey(storageKey) && !resourceIdFromStorageKey(storageKey)) {
        set.add(storageKey);
    } else {
        const inline = inlineMediaDataUrl(record);
        if (inline) set.add(`${inline.length}:${inline.slice(0, 64)}:${inline.slice(-64)}`);
    }
    for (const child of Object.values(record)) {
        collectLocalMediaKeys(child, set);
    }
    return [...set];
}

async function ensureRemoteResourceReferences<T>(value: T, uploaded = new Map<string, string>(), onUploaded?: () => void): Promise<T> {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        const result: unknown[] = [];
        for (const item of value) result.push(await ensureRemoteResourceReferences(item, uploaded, onUploaded));
        return result as T;
    }

    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        next[key] = await ensureRemoteResourceReferences(child, uploaded, onUploaded);
    }

    const storageKey = typeof next.storageKey === "string" ? next.storageKey : "";
    const remoteResourceId = resourceIdFromStorageKey(storageKey);
    if (remoteResourceId) return applyResourceReference(next, storageKey) as T;

    if (!isLocalStorageKey(storageKey)) {
        const inline = inlineMediaDataUrl(next);
        if (!inline) return next as T;
        const identity = await inlineMediaUploadIdentity(inline);
        const cached = uploaded.get(identity);
        if (cached) return applyResourceReference(next, cached) as T;
        const resourceStorage = await uploadInlineDataUrl(inline, identity);
        uploaded.set(identity, resourceStorage);
        onUploaded?.();
        return applyResourceReference(next, resourceStorage) as T;
    }

    const cached = uploaded.get(storageKey);
    if (cached) return applyResourceReference(next, cached) as T;
    const resourceStorage = await uploadLocalStorageKey(storageKey, next);
    uploaded.set(storageKey, resourceStorage);
    onUploaded?.();
    return applyResourceReference(next, resourceStorage) as T;
}

function applyResourceReference(payload: Record<string, unknown>, storageKey: string) {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (!resourceId) {
        throw new Error(`远端资源引用无效：${storageKey}`);
    }
    const url = resourceFileUrl(resourceId);
    payload.storageKey = storageKey;
    for (const key of ["content", "dataUrl", "url", "coverUrl"]) {
        if (typeof payload[key] === "string") payload[key] = url;
    }
    return payload;
}

function inlineMediaDataUrl(payload: Record<string, unknown>) {
    for (const key of ["dataUrl", "content", "url", "coverUrl"]) {
        const value = payload[key];
        if (typeof value === "string" && /^data:(image|video|audio)\//i.test(value)) return value;
    }
    return "";
}

async function uploadInlineDataUrl(dataUrl: string, identity: string) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("内嵌媒体读取失败");
    const blob = await response.blob();
    const kind: "image" | "video" | "audio" | "file" = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind, { idempotencyKey: identity });
    return resourceStorageKey(resource.id);
}

async function inlineMediaUploadIdentity(dataUrl: string) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
    return `inline:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function uploadLocalStorageKey(storageKey: string, payload: Record<string, unknown>) {
    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob) throw new Error(`本地媒体不存在，无法同步：${storageKey}`);
    const kind = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind, {
        width: numberValue(payload.naturalWidth) || numberValue(payload.width),
        height: numberValue(payload.naturalHeight) || numberValue(payload.height),
        durationMs: numberValue(payload.durationMs),
        idempotencyKey: storageKey,
    });
    return resourceStorageKey(resource.id);
}

function requireRemoteUserDataBaseline() {
    if (remoteUserDataPhase !== "ready") throw new Error("云端数据基线尚未建立，已停止写入");
}

function sameEntitySnapshot<T>(acknowledged: T | undefined, current: T) {
    return acknowledged !== undefined && (acknowledged === current || JSON.stringify(acknowledged) === JSON.stringify(current));
}

function isLocalStorageKey(value: string) {
    return LOCAL_STORAGE_KEY_PATTERN.test(value) && !resourceIdFromStorageKey(value);
}

function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function sanitizeCanvasProjectForRemoteSync<T>(project: T): T {
    if (!project || typeof project !== "object") return project;
    const clone = { ...(project as Record<string, unknown>) };
    if (Array.isArray(clone.chatSessions)) {
        clone.chatSessions = clone.chatSessions.map((session) => {
            if (!session || typeof session !== "object") return session;
            const s = { ...(session as Record<string, unknown>) };
            if (Array.isArray(s.messages)) {
                s.messages = s.messages.map((message) => {
                    if (!message || typeof message !== "object" || !message.detail) return message;
                    const m = { ...(message as Record<string, unknown>) };
                    if (m.detail && typeof m.detail === "object") {
                        const d = { ...(m.detail as Record<string, unknown>) };
                        if (Array.isArray(d.results)) {
                            d.results = d.results.map((r) => {
                                if (!r || typeof r !== "object") return r;
                                const res = { ...(r as Record<string, unknown>) };
                                if (res.result && typeof res.result === "object") {
                                    const inner = { ...(res.result as Record<string, unknown>) };
                                    if (inner.data && typeof inner.data === "object") {
                                        const { snapshot: _s, before: _b, after: _a, ...restData } = inner.data as Record<string, unknown>;
                                        inner.data = restData;
                                    }
                                    res.result = inner;
                                }
                                return res;
                            });
                        }
                        m.detail = d;
                    }
                    return m;
                });
            }
            return s;
        });
    }
    return clone as T;
}
