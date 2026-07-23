import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import { deleteRemoteAsset, deleteRemoteCanvasProject, getRemoteAsset, getRemoteCanvasProject, listRemoteAssets, listRemoteCanvasProjects, upsertRemoteAsset, upsertRemoteCanvasProject, type RemoteUserDataSummary } from "@/services/api/user-data";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

let activeRemoteUserId = "";
let applyingRemoteState = false;
let syncTimer: number | null = null;
let syncPromise: Promise<void> | null = null;
let syncQueued = false;
let subscriptionsInstalled = false;
let remoteAssetVersions = new Map<string, string>();
let remoteProjectVersions = new Map<string, string>();

const LOCAL_STORAGE_KEY_PATTERN = /^(image|video|audio|file|video-reference|audio-reference):/;

export async function syncRemoteUserData(userId?: string | null) {
    activeRemoteUserId = userId || "";
    if (!activeRemoteUserId) return;
    applyingRemoteState = true;
    try {
        const [remoteCanvas, remoteAssets] = await Promise.all([listRemoteCanvasProjects(), listRemoteAssets()]);
        remoteProjectVersions = versionMap(remoteCanvas.projects);
        remoteAssetVersions = versionMap(remoteAssets.assets);
        const localProjects = useCanvasStore.getState().projects;
        const localAssets = useAssetStore.getState().assets;
        const [changedProjects, changedAssets] = await Promise.all([
            fetchNewerRemoteItems(localProjects, remoteCanvas.projects, async (id) => (await getRemoteCanvasProject(id)).project),
            fetchNewerRemoteItems(localAssets, remoteAssets.assets, async (id) => (await getRemoteAsset(id)).asset),
        ]);
        const mergedProjects = mergeById(localProjects, changedProjects);
        const mergedAssets = mergeById(localAssets, await hydrateAssets(changedAssets));
        useCanvasStore.getState().replaceProjects(mergedProjects);
        useAssetStore.getState().replaceAssets(mergedAssets);
    } finally {
        applyingRemoteState = false;
    }
    // 首次登录可能带有尚未创建到云端的本地画布；先完成一次 upsert，避免详情页保存/分享先于项目创建。
    try {
        await saveRemoteUserDataNow();
    } catch (error) {
        console.warn("登录后画布首次同步失败，保留本地项目等待重试", error);
    }
    scheduleRemoteUserDataSync();
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
    remoteAssetVersions.clear();
    remoteProjectVersions.clear();
    if (syncTimer) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
    }
}

export function scheduleRemoteUserDataSync() {
    if (!activeRemoteUserId || applyingRemoteState) return;
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

export async function createCanvasProjectWithRemoteSync(title: string, projectId?: string) {
    const id = useCanvasStore.getState().createProject(title, projectId);
    if (!activeRemoteUserId) return { id, syncError: new Error("尚未建立云端同步会话") };
    try {
        await saveRemoteUserDataNow();
        return { id };
    } catch (syncError) {
        scheduleRemoteUserDataSync();
        return { id, syncError };
    }
}

export async function saveRemoteUserDataNow() {
    if (!activeRemoteUserId) return;
    if (syncPromise) {
        syncQueued = true;
        return syncPromise;
    }
    syncPromise = drainRemoteUserDataChanges();
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
    try {
        const currentProjects = useCanvasStore.getState().projects;
        const currentAssets = useAssetStore.getState().assets;
        const dirtyProjects = currentProjects.filter((item) => remoteProjectVersions.get(item.id) !== item.updatedAt);
        const dirtyAssets = currentAssets.filter((item) => remoteAssetVersions.get(item.id) !== item.updatedAt);
        const deletedProjectIds = missingIds(remoteProjectVersions, currentProjects);
        const deletedAssetIds = missingIds(remoteAssetVersions, currentAssets);
        if (!dirtyProjects.length && !dirtyAssets.length && !deletedProjectIds.length && !deletedAssetIds.length) return;
        const uploaded = new Map<string, string>();
        const projects = await prepareRemoteCanvasProjects(dirtyProjects, uploaded);
        const assets = await prepareRemoteAssets(dirtyAssets, uploaded);
        applyingRemoteState = true;
        if (projects.length) useCanvasStore.getState().replaceProjects(replaceById(currentProjects, projects));
        if (assets.length) useAssetStore.getState().replaceAssets(replaceById(currentAssets, assets));
        applyingRemoteState = false;
        // SQLite 和接口频控都要求写入保持有界；逐项提交还能准确记录已完成版本。
        for (const project of projects) {
            await upsertRemoteCanvasProject(project);
            remoteProjectVersions.set(project.id, project.updatedAt);
        }
        for (const asset of assets) {
            await upsertRemoteAsset(asset);
            remoteAssetVersions.set(asset.id, asset.updatedAt);
        }
        for (const id of deletedProjectIds) {
            await deleteRemoteCanvasProject(id);
            remoteProjectVersions.delete(id);
        }
        for (const id of deletedAssetIds) {
            await deleteRemoteAsset(id);
            remoteAssetVersions.delete(id);
        }
    } finally {
        applyingRemoteState = false;
    }
}

async function hydrateAssets(assets: Asset[]) {
    return Promise.all(
        assets.map(async (asset) => {
            if (asset.kind === "image" && asset.data.storageKey) {
                const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
                return { ...asset, coverUrl: shouldReplaceEphemeralUrl(asset.coverUrl) ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
            }
            if (asset.kind === "video" && asset.data.storageKey) {
                const url = await resolveResourceOrMediaUrl(asset.data.storageKey, asset.data.url);
                return { ...asset, coverUrl: shouldReplaceEphemeralUrl(asset.coverUrl) ? url : asset.coverUrl, data: { ...asset.data, url } };
            }
            if (asset.kind === "model" && asset.data.storageKey) {
                const url = await resolveResourceOrMediaUrl(asset.data.storageKey, asset.data.url);
                return { ...asset, data: { ...asset.data, url } };
            }
            return asset;
        }),
    );
}

async function prepareRemoteAssets(assets: Asset[], uploaded: Map<string, string>) {
    const result: Asset[] = [];
    for (const asset of assets) result.push(await ensureRemoteResourceReferences(asset, uploaded));
    return result;
}

async function prepareRemoteCanvasProjects(projects: CanvasProject[], uploaded: Map<string, string>) {
    const result: CanvasProject[] = [];
    for (const project of projects) result.push(await ensureRemoteResourceReferences(project, uploaded));
    return result;
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
        const resourceStorage = await uploadInlineDataUrl(inline).catch(() => "");
        return (resourceStorage ? applyResourceReference(next, resourceStorage) : next) as T;
    }

    const cached = uploaded.get(storageKey);
    const resourceStorage = cached || (await uploadLocalStorageKey(storageKey, next).catch(() => ""));
    if (!resourceStorage) return next as T;
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
    const blob = await (await fetch(dataUrl)).blob();
    const kind: "image" | "video" | "audio" | "file" = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind);
    return resourceStorageKey(resource.id);
}

async function uploadLocalStorageKey(storageKey: string, payload: Record<string, unknown>) {
    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob) return "";
    const kind = blob.type.startsWith("image/") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
    const resource = await uploadResourceFile(blob, kind, {
        width: numberValue(payload.naturalWidth) || numberValue(payload.width),
        height: numberValue(payload.naturalHeight) || numberValue(payload.height),
        durationMs: numberValue(payload.durationMs),
    });
    return resourceStorageKey(resource.id);
}

function mergeById<T extends { id?: string; updatedAt?: string }>(local: T[], remote: T[]) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        if (item.id) items.set(item.id, item);
    });
    local.forEach((item) => {
        if (!item.id) return;
        const current = items.get(item.id);
        if (!current || timeValue(item.updatedAt) >= timeValue(current.updatedAt)) items.set(item.id, item);
    });
    return Array.from(items.values()).sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
}

async function fetchNewerRemoteItems<T extends { id: string; updatedAt?: string }>(local: T[], remote: RemoteUserDataSummary[], fetchItem: (id: string) => Promise<T>) {
    const localById = new Map(local.map((item) => [item.id, item]));
    const pending = remote.filter((item) => {
        const current = localById.get(item.id);
        return !current || timeValue(item.updatedAt) > timeValue(current.updatedAt);
    });
    return Promise.all(pending.map((item) => fetchItem(item.id)));
}

function versionMap(items: RemoteUserDataSummary[]) {
    return new Map(items.map((item) => [item.id, item.updatedAt]));
}

function missingIds<T extends { id: string }>(remote: Map<string, string>, local: T[]) {
    const localIds = new Set(local.map((item) => item.id));
    return Array.from(remote.keys()).filter((id) => !localIds.has(id));
}

function replaceById<T extends { id: string }>(current: T[], changed: T[]) {
    const changedById = new Map(changed.map((item) => [item.id, item]));
    return current.map((item) => changedById.get(item.id) || item);
}

function timeValue(value?: string) {
    const time = value ? Date.parse(value) : 0;
    return Number.isFinite(time) ? time : 0;
}

function isLocalStorageKey(value: string) {
    return LOCAL_STORAGE_KEY_PATTERN.test(value) && !resourceIdFromStorageKey(value);
}

function shouldReplaceEphemeralUrl(value: string) {
    return !value || value.startsWith("blob:") || value.startsWith("data:");
}

async function resolveResourceOrMediaUrl(storageKey: string, fallback: string) {
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (resourceId) return resourceFileUrl(resourceId);
    const { resolveMediaUrl } = await import("@/services/file-storage");
    return resolveMediaUrl(storageKey, fallback);
}

function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}
