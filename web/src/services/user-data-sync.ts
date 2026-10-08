import { canonicalize } from "json-canonicalize";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import {
    deleteRemoteAssets,
    deleteRemoteCanvasProject,
    getRemoteAsset,
    getRemoteAssetsByIds,
    getRemoteCanvasProject,
    getRemoteUserDataSnapshot,
    listRemoteAssetsPage,
    restoreRemoteCanvasHistory,
    upsertRemoteAsset,
    upsertRemoteCanvasProject,
} from "@/services/api/user-data";
import { ApiError } from "@/services/api/request";
import { canvasContentHash, sameCanvasContent } from "@/lib/canvas/canvas-content";
import { getActiveUserScope } from "@/lib/user-scope";
import { preserveCanvasSyncDraft, readCanvasSyncDrafts } from "@/services/canvas-sync-drafts";
import { appQueryClient } from "@/lib/query-client";
import { parseAssetRecordList } from "@/lib/asset-record";
import { assetForRemoteSync } from "@/lib/asset-remote-sync";
import type { Asset } from "@/stores/use-asset-store";
import { flushAssetStorePersistence, getGenerationAssetDefaults, useAssetStore } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { repairMissingCanvasAssets, repairMissingCanvasVideoPreviews, collectCanvasMediaAssetIds, rebindInconsistentCanvasAssets, type CanvasAssetRebindResult } from "@/services/canvas-asset-repair";
import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import { applyAgentCanvasPatch, mergeAgentCanvasEditor, mergeThreeWayValue, type AgentCanvasPatch } from "@/lib/canvas/agent-canvas-patch";
import { collectLocalMediaKeys, ensureRemoteResourceReferences } from "./user-data-sync-media";

export { numberValue } from "./user-data-sync-media";

let activeRemoteUserId = "";
type RemoteUserDataPhase = "inactive" | "hydrating" | "ready" | "failed";

let remoteUserDataPhase: RemoteUserDataPhase = "inactive";
let syncTimer: number | null = null;
let syncPromise: Promise<void> | null = null;
let syncQueued = false;
let syncRetryAttempt = 0;
let remoteOperationTail: Promise<void> = Promise.resolve();
let subscriptionsInstalled = false;
let acknowledgedAssets = new Map<string, Asset>();
let acknowledgedProjects = new Map<string, CanvasProject>();
let incrementalSession = false;
let sessionEpoch = 0;
const verifiedProjects = new Set<string>();
const verifiedAssets = new Set<string>();
const remoteProjectLoadPromises = new Map<string, Promise<CanvasProject | undefined>>();
const REMOTE_SYNC_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

export async function initializeRemoteUserDataSession(userId: string) {
    await withRemoteUserDataSyncExclusive(async () => {
        resetRemoteUserDataSync();
        activeRemoteUserId = userId;
        incrementalSession = true;
        acknowledgedProjects = new Map(useCanvasStore.getState().projects.map((project) => [project.id, project]));
        acknowledgedAssets = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
        remoteUserDataPhase = "ready";
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
            const knownRemote = verifiedProjects.has(id) ? acknowledgedProjects.get(id) : undefined;
            remote = (await getRemoteCanvasProject(id, knownRemote)).project;
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
        if (dirty && !sameCanvasContent(local, remote)) {
            const draftCount = await preserveCanvasSyncDraft(local, scope);
            const liveAfterDraft = requireUnchangedLocal(local, "画布仍在更新，已保留本地内容，请稍后再加载最新版本");
            useSyncProgressStore.getState().setProjectProgress(id, { draftCount });
            if (!options.latest && !options.historyRestore && local.revision !== undefined) {
                if (local.revision !== remote.revision) {
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
        useCanvasStore.setState((state) => ({ projects: local ? state.projects.map((item) => (item.id === id ? project : item)) : [...state.projects, project] }));
        await flushCanvasStorePersistence();
        useSyncProgressStore.getState().setProjectProgress(id, { phase: "done", message: "已加载云端最新版本" });
        return project;
    });
    remoteProjectLoadPromises.set(id, request);
    const clearPending = () => {
        if (remoteProjectLoadPromises.get(id) === request) remoteProjectLoadPromises.delete(id);
    };
    void request.then(clearPending, clearPending);
    return request;
}

// Never replace edits made while the Agent was running. Leave the acknowledged
// baseline untouched on conflict, so automatic sync cannot silently overwrite it.
const agentCanvasListeners = new Set<(project: CanvasProject, previous: CanvasProject | undefined) => void>();

export function subscribeAgentCanvasRefresh(listener: (project: CanvasProject, previous: CanvasProject | undefined) => void) {
    agentCanvasListeners.add(listener);
    return () => {
        agentCanvasListeners.delete(listener);
    };
}

export async function refreshCanvasAfterAgent(id: string) {
    const epoch = sessionEpoch;
    return withRemoteUserDataSyncExclusive(async () => {
        if (!activeRemoteUserId) throw new Error("请先登录再刷新 Agent 画布结果");
        const knownRemote = verifiedProjects.has(id) ? acknowledgedProjects.get(id) : undefined;
        const { project } = await getRemoteCanvasProject(id, knownRemote);
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
                projected = mergeAgentCanvasEditor(baseline, project, current.nodes, current.connections, current);
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
                for (const listener of agentCanvasListeners) listener(projected, current);
            }
        } catch (error) {
            if (current) await preserveAgentConflict(current);
            throw error;
        }
        acknowledgedProjects.set(id, { ...project, viewport: projected.viewport, remoteContentHash: hash });
        verifiedProjects.add(id);
        useCanvasStore.setState((state) => ({ projects: [...state.projects.filter((candidate) => candidate.id !== id), projected] }));
        await flushCanvasStorePersistence();
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
        if (incrementalSession && !verifiedProjects.has(id) && baseline.remoteContentHash !== (await canvasContentHash(baseline))) throw new Error("本地缓存尚未核对，请加载云端最新版本");
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
    const result = await listRemoteAssetsPage(options);
    // 分页列表是展示数据，不是同步快照。不要把每一页都合并进全局
    // asset store，否则滚动/翻页会不断重建并持久化整个素材数组。
    // 真正被画布引用的素材仍由 loadAssetsForUse 按 ID 拉取并写入 store。
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
    const loadedIds = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
    const pending = [...new Set(ids)].filter((id) => !loadedIds.has(id) || !verifiedAssets.has(id));
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

export async function syncRemoteUserData(userId?: string | null) {
    // 登录/切换账号时，服务端快照建立新的远端基线；本地 IndexedDB 只负责首屏缓存，
    // 不能把服务端已经删除或当前用户无权访问的实体重新补回去。后续增量保存必须基于这份基线做冲突校验。
    await withRemoteUserDataSyncExclusive(async () => {
        incrementalSession = false;
        activeRemoteUserId = userId || "";
        acknowledgedProjects.clear();
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
                const clean = local.remoteContentHash && local.remoteContentHash === (await canvasContentHash(local));
                if (!clean && !sameCanvasContent(local, remoteById.get(local.id))) await preserveCanvasSyncDraft(local);
            }
            const projects = await Promise.all(
                snapshot.projects.map(async (project) => {
                    const local = localProjects.find((item) => item.id === project.id);
                    const draftCount = (await readCanvasSyncDrafts(project.id)).length;
                    useSyncProgressStore.getState().setProjectProgress(project.id, { phase: "done", draftCount, message: "已保存到云端" });
                    return { ...project, viewport: local?.viewport || project.viewport || { x: 0, y: 0, k: 1 }, remoteContentHash: await canvasContentHash(project) };
                }),
            );
            if (useCanvasStore.getState().projects !== localProjects) throw new Error("本地画布仍在更新，已保留本地内容，请重新同步");
            useCanvasStore.getState().replaceProjects(projects);
            useAssetStore.getState().replaceAssets(parseAssetRecordList(snapshot.assets));
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            acknowledgedProjects = new Map(projects.map((project) => [project.id, project]));
            acknowledgedAssets = new Map(parseAssetRecordList(snapshot.assets).map((asset) => [asset.id, asset]));
            remoteUserDataPhase = "ready";
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
    if (syncTimer) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
    }
    syncRetryAttempt = 0;
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
        syncQueued = true;
        return;
    }
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
        syncTimer = null;
        void saveRemoteUserDataNow().catch((error) => console.warn("云端自动同步失败", error));
    }, 1200);
}

function isRetryableRemoteSyncError(error: unknown) {
    if (error instanceof ApiError) return error.retryable;
    if (error instanceof DOMException && error.name === "AbortError") return false;
    if (typeof error === "object" && error !== null && "permanent" in error) {
        return (error as { permanent?: unknown }).permanent !== true;
    }
    // Plain errors from validation/local storage should remain visible instead of
    // being retried indefinitely. Transport failures are normalized as ApiError.
    return false;
}

function updateRetryProgress(delayMs: number) {
    const seconds = Math.max(1, Math.ceil(delayMs / 1_000));
    const progress = useSyncProgressStore.getState();
    for (const item of Object.values(progress.syncingProjects)) {
        if (item.phase !== "error") continue;
        progress.setProjectProgress(item.projectId, {
            message: `${item.message || "云端同步失败"}；${seconds} 秒后自动重试`,
        });
    }
}

function stopRetryProgress() {
    const progress = useSyncProgressStore.getState();
    for (const item of Object.values(progress.syncingProjects)) {
        if (item.phase !== "error" || !item.message?.includes("自动重试")) continue;
        progress.setProjectProgress(item.projectId, { message: "云端同步失败，请点击立即重试" });
    }
}

function scheduleRemoteUserDataRetry(error: unknown) {
    if (!isRetryableRemoteSyncError(error) || !activeRemoteUserId || remoteUserDataPhase !== "ready") return false;
    if (syncRetryAttempt >= REMOTE_SYNC_RETRY_DELAYS_MS.length) {
        stopRetryProgress();
        return false;
    }
    const delayMs = Math.max(REMOTE_SYNC_RETRY_DELAYS_MS[syncRetryAttempt], error instanceof ApiError ? error.retryAfterMs || 0 : 0);
    syncRetryAttempt += 1;
    if (syncTimer) window.clearTimeout(syncTimer);
    updateRetryProgress(delayMs);
    syncTimer = window.setTimeout(() => {
        syncTimer = null;
        void saveRemoteUserDataNow().catch((retryError) => console.warn("云端自动重试失败", retryError));
    }, delayMs);
    return true;
}

/** 用户主动点击重试时重新开始退避窗口，不影响本地已保存的内容。 */
export function retryRemoteUserDataSync(projectId?: string) {
    syncRetryAttempt = 0;
    if (syncTimer) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
    }
    return saveRemoteUserDataNow(projectId);
}

export function formatLocalSavedRemotePending(localAction: string, error: unknown): string {
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "未知错误";
    if (error instanceof ApiError && error.reason === "canvas_history_resources_missing") {
        return `${localAction}，云端同步已暂停：${detail}。请修复缺失素材或从有效历史版本恢复。`;
    }
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

export async function saveRemoteUserDataNow(input?: string | readonly string[] | { force?: boolean; repairMissingResources?: boolean }) {
    const projectId = typeof input === "string" || Array.isArray(input) ? (input as string | readonly string[]) : undefined;
    const options = input && typeof input === "object" && !Array.isArray(input) ? (input as { force?: boolean; repairMissingResources?: boolean }) : {};
    const epoch = sessionEpoch;
    if (!activeRemoteUserId) throw new Error("尚未建立云端同步会话，本地内容尚未保存到云端");
    requireRemoteUserDataBaseline();
    const assertNoConflict = () => {
        const ids = projectId === undefined ? useCanvasStore.getState().projects.map((project) => project.id) : typeof projectId === "string" ? [projectId] : projectId;
        if (ids.some((id) => useSyncProgressStore.getState().syncingProjects[id]?.phase === "conflict")) {
            throw new ApiError("云端画布已有更新，请保留本地草稿并加载最新版本", { status: 409 });
        }
    };
    if (projectId !== undefined) assertNoConflict();
    await waitForRemoteProjectLoads();
    if (syncPromise) {
        syncQueued = true;
        await syncPromise;
        assertNoConflict();
        // The in-flight drain may have started before this explicit repair/force
        // request. Re-enter after it settles so the user's intent is not lost.
        if (options.force || options.repairMissingResources) {
            return saveRemoteUserDataNow(input);
        }
        return;
    }
    syncPromise = withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止旧会话保存");
        await drainRemoteUserDataChanges(options);
    });
    let syncFailed = false;
    let syncError: unknown;
    try {
        await syncPromise;
        assertNoConflict();
        syncRetryAttempt = 0;
    } catch (error) {
        syncFailed = true;
        syncError = error;
    } finally {
        syncPromise = null;
        if (syncQueued) scheduleRemoteUserDataSync();
    }
    if (syncFailed) {
        scheduleRemoteUserDataRetry(syncError);
        throw syncError;
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
        await repairMissingCanvasVideoPreviews();
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止修复保存");
        const projects = useCanvasStore.getState().projects;
        // 服务端素材记录是 guard 实际校验的事实；本地缓存可能落后，须先取回再判定绑定一致性。
        const claimedIds = [...collectCanvasMediaAssetIds(projects)];
        const remoteAssets: Asset[] = [];
        for (let offset = 0; offset < claimedIds.length; offset += 100) {
            const { assets } = await getRemoteAssetsByIds(claimedIds.slice(offset, offset + 100));
            remoteAssets.push(...assets);
        }
        if (epoch !== sessionEpoch) throw new Error("账号已切换，已停止修复保存");
        const remoteById = new Map(remoteAssets.map((asset) => [asset.id, asset]));
        const merged = [...remoteAssets, ...useAssetStore.getState().assets.filter((asset) => !remoteById.has(asset.id))];
        const result = rebindInconsistentCanvasAssets(parseAssetRecordList(merged));
        await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
        return result;
    });
    await saveRemoteUserDataNow({ force: true, repairMissingResources: true });
    return rebind;
}

async function drainRemoteUserDataChanges(options: { force?: boolean; repairMissingResources?: boolean } = {}) {
    const uploaded = new Map<string, string>();
    do {
        syncQueued = false;
        await saveRemoteUserDataBatch(uploaded, options);
    } while (syncQueued);
}

async function saveRemoteUserDataBatch(uploaded: Map<string, string>, options: { force?: boolean; repairMissingResources?: boolean } = {}) {
    // 中央兜底：任何调用方只要把持久媒体写进画布，提交前都会先补齐素材记录与 assetId。
    // 页面级入口仍主动入库，以便立即反馈；这里负责阻止遗漏入口形成远端幽灵资源。
    const changedProjectIds = new Set(
        useCanvasStore
            .getState()
            .projects.filter((project) => !sameCanvasContent(acknowledgedProjects.get(project.id), project))
            .map((project) => project.id),
    );
    repairMissingCanvasAssets(changedProjectIds, incrementalSession);
    const currentProjects = useCanvasStore.getState().projects;
    const currentAssets = useAssetStore.getState().assets;
    const dirtyProjects = currentProjects.filter((project) => !sameCanvasContent(acknowledgedProjects.get(project.id), project) && useSyncProgressStore.getState().syncingProjects[project.id]?.phase !== "conflict");
    const dirtyAssets = currentAssets.filter((asset) => !sameEntitySnapshot(acknowledgedAssets.get(asset.id), asset));
    if (!dirtyProjects.length && !dirtyAssets.length) return;

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
                            result = result.kind === "image"
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
            useAssetStore.setState((state) => ({ assets: state.assets.map((item) => item.id === source.id ? merged : item) }));
        }
    }

    if (incrementalSession) {
        for (const source of dirtyAssets) {
            const baseline = acknowledgedAssets.get(source.id);
            if (!baseline || verifiedAssets.has(source.id)) continue;
            const { asset } = await getRemoteAsset(source.id);
            if (Date.parse(asset.updatedAt) !== Date.parse(baseline.updatedAt)) {
                if (!options.force) throw assetRemoteVersionConflict();
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
    for (const dirty of dirtyAssets) {
        if (adoptedAssetIds.has(dirty.id)) continue;
        const source = mergedAssets.get(dirty.id) ?? dirty;
        const remotePayload = await ensureRemoteResourceReferences(assetForRemoteSync(source), uploaded);
        await upsertRemoteAsset(remotePayload);
        acknowledgedAssets.set(source.id, source);
        verifiedAssets.add(source.id);
    }
    const errors: unknown[] = [];
    for (const source of dirtyProjects) {
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
            let candidate = source;
            let saved = false;
            let lastError: unknown;
            for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
                if (!Number.isSafeInteger(candidate.revision) || candidate.revision! < 0) {
                    throw new ApiError("缺少画布版本，请保留草稿并加载云端最新版本", { status: 428 });
                }
                const hash = await canvasContentHash(candidate);
                const remotePayload = await ensureRemoteResourceReferences(candidate, uploaded, onMediaUploaded);
                if (total > 0) {
                    useSyncProgressStore.getState().setProjectProgress(source.id, {
                        phase: attempt > 0 ? "reconciling" : "saving",
                        message: attempt > 0 ? "正在自动合并云端与本地修改" : "正在保存画布结构",
                    });
                }
                try {
                    const { project: savedProject } = await upsertRemoteCanvasProject(sanitizeCanvasProjectForRemoteSync(remotePayload), { repairMissingResources: options.repairMissingResources === true });
                    if (!Number.isSafeInteger(savedProject.revision) || savedProject.revision !== candidate.revision! + 1) {
                        throw new ApiError("服务端未返回有效画布版本，请加载云端最新版本", { status: 409 });
                    }
                    const current = useCanvasStore.getState().openProject(source.id);
                    if (current && current.revision !== candidate.revision) {
                        throw new ApiError("画布基线已变化，请加载云端最新版本", { status: 409 });
                    }
                    const acknowledged = { ...candidate, revision: savedProject.revision, remoteContentHash: hash };
                    acknowledgedProjects.set(source.id, acknowledged);
                    verifiedProjects.add(source.id);
                    if (current) {
                        useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project === current ? { ...project, revision: savedProject.revision, remoteContentHash: hash } : project)) }));
                    }
                    await flushCanvasStorePersistence();
                    const pending = !sameCanvasContent(candidate, useCanvasStore.getState().openProject(source.id) || undefined);
                    useSyncProgressStore.getState().setProjectProgress(source.id, { phase: pending ? "pending" : "done", message: pending ? "有新修改等待保存" : "已保存到云端" });
                    if (pending) syncQueued = true;
                    saved = true;
                    continue;
                } catch (error) {
                    lastError = error;
                    const conflict = error instanceof ApiError && error.reason !== "canvas_history_resources_missing" && (error.status === 409 || error.status === 428);
                    if (!conflict || attempt >= 2) throw error;
                    try {
                        const { project: remote } = await getRemoteCanvasProject(source.id);
                        const current = useCanvasStore.getState().openProject(source.id);
                        if (!current || current !== useCanvasStore.getState().openProject(source.id)) throw error;
                        if (sameCanvasContent(current, remote)) {
                            const remoteHash = await canvasContentHash(remote);
                            const reconciled = { ...remote, viewport: current.viewport, remoteContentHash: remoteHash };
                            acknowledgedProjects.set(source.id, reconciled);
                            verifiedProjects.add(source.id);
                            useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === source.id ? reconciled : project)) }));
                            await flushCanvasStorePersistence();
                            useSyncProgressStore.getState().setProjectProgress(source.id, { phase: "done", message: "云端内容一致，已自动校准版本" });
                            saved = true;
                            continue;
                        }
                        const baseline = acknowledgedProjects.get(source.id);
                        if (!baseline) throw error;
                        let rebased: CanvasProject;
                        try {
                            rebased = mergeAgentCanvasEditor(baseline, remote, current.nodes, current.connections, current);
                        } catch (mergeError) {
                            throw new ApiError(mergeError instanceof Error ? mergeError.message : "本地与云端存在同一字段修改", { status: 409 });
                        }
                        const remoteHash = await canvasContentHash(remote);
                        if (useCanvasStore.getState().openProject(source.id) !== current) {
                            throw new ApiError("画布在自动合并期间发生新修改，请重试", { status: 409 });
                        }
                        candidate = { ...rebased, viewport: current.viewport, remoteContentHash: remoteHash };
                        acknowledgedProjects.set(source.id, { ...remote, viewport: current.viewport, remoteContentHash: remoteHash });
                        verifiedProjects.add(source.id);
                        useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === source.id ? candidate : project)) }));
                        await flushCanvasStorePersistence();
                        useSyncProgressStore.getState().setProjectProgress(source.id, { phase: "reconciling", message: "检测到云端更新，正在自动合并本地修改" });
                    } catch (rebaseError) {
                        lastError = rebaseError;
                        throw rebaseError;
                    }
                }
            }
            if (!saved && lastError) throw lastError;
        } catch (error) {
            const conflict = error instanceof ApiError && error.reason !== "canvas_history_resources_missing" && (error.status === 409 || error.status === 428);
            useSyncProgressStore.getState().setProjectProgress(source.id, {
                phase: conflict ? "conflict" : "error",
                message: conflict ? "本地与云端存在同一字段修改，请选择保留的版本" : error instanceof Error ? error.message : "云端同步失败，等待重试",
            });
            if (conflict) {
                try {
                    const current = useCanvasStore.getState().openProject(source.id) || source;
                    const draftCount = await preserveCanvasSyncDraft(current);
                    useSyncProgressStore.getState().setProjectProgress(source.id, { draftCount });
                } catch (draftError) {
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

function assetRemoteVersionConflict() {
    return new Error("素材远端版本已变化，已停止覆盖，请重新打开素材库");
}

function requireRemoteUserDataBaseline() {
    if (remoteUserDataPhase !== "ready") throw new Error("云端数据基线尚未建立，已停止写入");
}

function sameEntitySnapshot<T>(acknowledged: T | undefined, current: T) {
    return acknowledged !== undefined && (acknowledged === current || JSON.stringify(acknowledged) === JSON.stringify(current));
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
