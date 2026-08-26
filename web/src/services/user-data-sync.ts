import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { deleteRemoteAsset, deleteRemoteCanvasProject, getRemoteUserDataSnapshot, upsertRemoteAsset, upsertRemoteCanvasProject } from "@/services/api/user-data";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { Asset } from "@/stores/use-asset-store";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";

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

const LOCAL_STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;

export async function syncRemoteUserData(userId?: string | null) {
    await withRemoteUserDataSyncExclusive(async () => {
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
            // 登录时服务端是实体真相。浏览器 IndexedDB 只作为首屏缓存，不能把服务端已删除的记录补回去。
            // 这里只替换结构化记录，不在登录阶段解析图片/视频/音频 URL；媒体由实际使用方按需解析。
            useCanvasStore.getState().replaceProjects(snapshot.projects);
            useAssetStore.getState().replaceAssets(snapshot.assets);
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            acknowledgedProjects = new Map(snapshot.projects.map((project) => [project.id, project]));
            acknowledgedAssets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
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
        if (state.projects !== previous.projects) scheduleRemoteUserDataSync();
    });
    useAssetStore.subscribe((state, previous) => {
        if (state.assets !== previous.assets) scheduleRemoteUserDataSync();
    });
}

export function resetRemoteUserDataSync() {
    activeRemoteUserId = "";
    remoteUserDataPhase = "inactive";
    acknowledgedAssets.clear();
    acknowledgedProjects.clear();
    if (syncTimer) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
    }
    syncQueued = false;
}

export function withRemoteUserDataSyncExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = remoteOperationTail.catch(() => undefined).then(operation);
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

export async function createCanvasProjectWithRemoteSync(title: string, projectId?: string, initialContent?: Partial<Pick<CanvasProject, "nodes" | "connections">>) {
    const id = useCanvasStore.getState().createProject(title, projectId);
    if (initialContent) useCanvasStore.getState().updateProject(id, initialContent);
    if (!activeRemoteUserId) return { id, syncError: new Error("尚未建立云端同步会话") };
    try {
        await saveRemoteUserDataNow();
        return { id };
    } catch (syncError) {
        scheduleRemoteUserDataSync();
        return { id, syncError };
    }
}

export async function deleteAssetWithRemoteSync(id: string) {
    const assetId = id.trim();
    if (!assetId) throw new Error("素材 ID 不能为空");
    await withRemoteUserDataSyncExclusive(async () => {
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
    const projectIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!projectIds.length) return;
    await withRemoteUserDataSyncExclusive(async () => {
        if (activeRemoteUserId) requireRemoteUserDataBaseline();
        for (const id of projectIds) {
            if (activeRemoteUserId) {
                await deleteRemoteCanvasProject(id);
                acknowledgedProjects.delete(id);
            }
            useCanvasStore.getState().deleteProjects([id]);
            // 批量删除允许部分成功；每个已成功远端删除的实体都立即落实到本地 durable cache。
            await flushCanvasStorePersistence();
        }
    });
}

export async function saveRemoteUserDataNow() {
    if (!activeRemoteUserId) return;
    requireRemoteUserDataBaseline();
    if (syncPromise) {
        syncQueued = true;
        return syncPromise;
    }
    syncPromise = withRemoteUserDataSyncExclusive(async () => {
        requireRemoteUserDataBaseline();
        await drainRemoteUserDataChanges();
    });
    try {
        await syncPromise;
    } finally {
        syncPromise = null;
    }
}

async function drainRemoteUserDataChanges() {
    do {
        syncQueued = false;
        await saveRemoteUserDataBatch();
    } while (syncQueued);
}

async function saveRemoteUserDataBatch() {
    const currentProjects = useCanvasStore.getState().projects;
    const currentAssets = useAssetStore.getState().assets;
    const dirtyProjects = currentProjects.filter((project) => !sameEntitySnapshot(acknowledgedProjects.get(project.id), project));
    const dirtyAssets = currentAssets.filter((asset) => !sameEntitySnapshot(acknowledgedAssets.get(asset.id), asset));
    const currentProjectIds = new Set(currentProjects.map((project) => project.id));
    const currentAssetIds = new Set(currentAssets.map((asset) => asset.id));
    const deletedProjectIds = [...acknowledgedProjects.keys()].filter((id) => !currentProjectIds.has(id));
    const deletedAssetIds = [...acknowledgedAssets.keys()].filter((id) => !currentAssetIds.has(id));
    if (!dirtyProjects.length && !dirtyAssets.length && !deletedProjectIds.length && !deletedAssetIds.length) return;

    const uploaded = new Map<string, string>();
    // 转换后的 resource: 引用只属于发往服务端的 payload，不能反写整份实时 store。
    // 已确认快照记录的是本次上传所依据的本地实体；上传期间的新编辑会在下一轮继续提交。
    for (const source of dirtyProjects) {
        const remotePayload = await ensureRemoteResourceReferences(source, uploaded);
        await upsertRemoteCanvasProject(remotePayload);
        acknowledgedProjects.set(source.id, source);
    }
    for (const source of dirtyAssets) {
        const remotePayload = await ensureRemoteResourceReferences(source, uploaded);
        await upsertRemoteAsset(remotePayload);
        acknowledgedAssets.set(source.id, source);
    }
    for (const id of deletedProjectIds) {
        await deleteRemoteCanvasProject(id);
        acknowledgedProjects.delete(id);
    }
    for (const id of deletedAssetIds) {
        await deleteRemoteAsset(id);
        acknowledgedAssets.delete(id);
    }
}

async function ensureRemoteResourceReferences<T>(value: T, uploaded = new Map<string, string>()): Promise<T> {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        const result: unknown[] = [];
        for (const item of value) result.push(await ensureRemoteResourceReferences(item, uploaded));
        return result as T;
    }

    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        next[key] = await ensureRemoteResourceReferences(child, uploaded);
    }

    const storageKey = typeof next.storageKey === "string" ? next.storageKey : "";
    const remoteResourceId = resourceIdFromStorageKey(storageKey);
    if (remoteResourceId) return applyResourceReference(next, storageKey) as T;

    if (!isLocalStorageKey(storageKey)) {
        const inline = inlineMediaDataUrl(next);
        if (!inline) return next as T;
        const resourceStorage = await uploadInlineDataUrl(inline);
        return applyResourceReference(next, resourceStorage) as T;
    }

    const cached = uploaded.get(storageKey);
    const resourceStorage = cached || (await uploadLocalStorageKey(storageKey, next));
    uploaded.set(storageKey, resourceStorage);
    return applyResourceReference(next, resourceStorage) as T;
}

function applyResourceReference(payload: Record<string, unknown>, storageKey: string) {
    const url = resourceFileUrl(storageKey.slice("resource:".length));
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

async function uploadInlineDataUrl(dataUrl: string) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("内嵌媒体读取失败");
    const blob = await response.blob();
    const kind: "image" | "video" | "audio" | "file" = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind);
    return resourceStorageKey(resource.id);
}

async function uploadLocalStorageKey(storageKey: string, payload: Record<string, unknown>) {
    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob) throw new Error(`本地媒体不存在：${storageKey}`);
    const kind = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind, {
        width: numberValue(payload.naturalWidth) || numberValue(payload.width),
        height: numberValue(payload.naturalHeight) || numberValue(payload.height),
        durationMs: numberValue(payload.durationMs),
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
