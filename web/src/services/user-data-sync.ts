import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { deleteRemoteAsset, deleteRemoteCanvasProject, getRemoteUserDataSnapshot, upsertRemoteAsset, upsertRemoteCanvasProject } from "@/services/api/user-data";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { assetForRemoteSync } from "@/lib/asset-remote-sync";
import type { Asset } from "@/stores/use-asset-store";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { repairMissingCanvasAssets } from "@/services/canvas-asset-repair";

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
    let repairedCanvasAssets = false;
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
            const repair = repairMissingCanvasAssets();
            repairedCanvasAssets = repair.createdAssets > 0 || repair.updatedProjects > 0;
            await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
            acknowledgedProjects = new Map(snapshot.projects.map((project) => [project.id, project]));
            acknowledgedAssets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
            remoteUserDataPhase = "ready";
        } catch (error) {
            remoteUserDataPhase = "failed";
            throw error;
        }
    });
    if (repairedCanvasAssets) await saveRemoteUserDataNow();
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
    useSyncProgressStore.getState().clearAll();
}

export function hasRemoteUserDataSyncSession() {
    return Boolean(activeRemoteUserId) && remoteUserDataPhase === "ready";
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

        // 2. 对于画布中尚未入库的媒体节点，直接归档为回收站素材
        for (const project of deletedProjectObjects) {
            for (const node of project.nodes || []) {
                const isMedia = node.type === "image" || node.type === "video" || node.type === "audio";
                const content = typeof node.metadata?.content === "string" ? node.metadata.content : "";
                const storageKey = typeof node.metadata?.storageKey === "string" ? node.metadata.storageKey : undefined;
                if (!isMedia || (!content && !storageKey)) continue;

                const existingAsset = node.metadata?.assetId ? currentAssets.find((a) => a.id === node.metadata?.assetId) : undefined;
                if (existingAsset) {
                    const owningCanvasId = existingAsset.metadata?.canvasId as string | undefined;
                    if (owningCanvasId === project.id && !activeAssetIds.has(existingAsset.id) && existingAsset.status !== "archived") {
                        useAssetStore.getState().updateAsset(existingAsset.id, { status: "archived" });
                        assetChanged = true;
                    }
                    continue;
                }

                const title = node.title || `${project.title} - ${node.type === "image" ? "图片" : node.type === "video" ? "视频" : "音频"}`;
                const prompt = typeof node.metadata?.prompt === "string" ? node.metadata.prompt : "";
                if (node.type === "image") {
                    useAssetStore.getState().addAsset({
                        kind: "image",
                        title,
                        coverUrl: content || "",
                        tags: prompt ? [prompt.slice(0, 16)] : ["画布生成"],
                        category: "other",
                        status: "archived",
                        source: `已删除画布：${project.title}`,
                        data: {
                            dataUrl: content || "",
                            storageKey,
                            width: Number(node.width) || 1024,
                            height: Number(node.height) || 1024,
                            bytes: Number(node.metadata?.bytes) || 0,
                            mimeType: (node.metadata?.mimeType as string) || "image/png",
                        },
                        metadata: {
                            canvasId: project.id,
                            sourceNodeId: node.id,
                        },
                    });
                    assetChanged = true;
                } else if (node.type === "video") {
                    useAssetStore.getState().addAsset({
                        kind: "video",
                        title,
                        coverUrl: content || "",
                        tags: prompt ? [prompt.slice(0, 16)] : ["画布视频"],
                        category: "other",
                        status: "archived",
                        source: `已删除画布：${project.title}`,
                        data: {
                            url: content || "",
                            storageKey,
                            width: Number(node.width) || 1280,
                            height: Number(node.height) || 720,
                            durationMs: Number(node.metadata?.durationMs) || 0,
                            bytes: Number(node.metadata?.bytes) || 0,
                            mimeType: (node.metadata?.mimeType as string) || "video/mp4",
                        },
                        metadata: {
                            canvasId: project.id,
                            sourceNodeId: node.id,
                        },
                    });
                    assetChanged = true;
                } else if (node.type === "audio") {
                    useAssetStore.getState().addAsset({
                        kind: "audio",
                        title,
                        coverUrl: "",
                        tags: ["画布音频"],
                        category: "other",
                        status: "archived",
                        source: `已删除画布：${project.title}`,
                        data: {
                            url: content || "",
                            storageKey,
                            durationMs: Number(node.metadata?.durationMs) || 0,
                            bytes: Number(node.metadata?.bytes) || 0,
                            mimeType: (node.metadata?.mimeType as string) || "audio/mpeg",
                        },
                        metadata: {
                            canvasId: project.id,
                            sourceNodeId: node.id,
                        },
                    });
                    assetChanged = true;
                }
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
    const uploaded = new Map<string, string>();
    do {
        syncQueued = false;
        await saveRemoteUserDataBatch(uploaded);
    } while (syncQueued);
}

async function saveRemoteUserDataBatch(uploaded: Map<string, string>) {
    // 中央兜底：任何调用方只要把持久媒体写进画布，提交前都会先补齐素材记录与 assetId。
    // 页面级入口仍主动入库，以便立即反馈；这里负责阻止遗漏入口形成远端幽灵资源。
    repairMissingCanvasAssets();
    const currentProjects = useCanvasStore.getState().projects;
    const currentAssets = useAssetStore.getState().assets;
    const dirtyProjects = currentProjects.filter((project) => !sameEntitySnapshot(acknowledgedProjects.get(project.id), project));
    const dirtyAssets = currentAssets.filter((asset) => !sameEntitySnapshot(acknowledgedAssets.get(asset.id), asset));
    const currentProjectIds = new Set(currentProjects.map((project) => project.id));
    const currentAssetIds = new Set(currentAssets.map((asset) => asset.id));
    const deletedProjectIds = [...acknowledgedProjects.keys()].filter((id) => !currentProjectIds.has(id));
    const deletedAssetIds = [...acknowledgedAssets.keys()].filter((id) => !currentAssetIds.has(id));
    if (!dirtyProjects.length && !dirtyAssets.length && !deletedProjectIds.length && !deletedAssetIds.length) return;

    // 转换后的 resource: 引用只属于发往服务端的 payload，不能反写整份实时 store。
    // 已确认快照记录的是本次上传所依据的本地实体；上传期间的新编辑会在下一轮继续提交。
    // 素材先于画布提交。这样画布中的 resource: 引用一旦成为远端事实，
    // 对应 Asset 已经存在，刷新或换设备不会出现只占容量、不见素材的窗口。
    for (const source of dirtyAssets) {
        const remotePayload = await ensureRemoteResourceReferences(assetForRemoteSync(source), uploaded);
        await upsertRemoteAsset(remotePayload);
        acknowledgedAssets.set(source.id, source);
    }
    for (const source of dirtyProjects) {
        const keysToUpload = collectLocalMediaKeys(source);
        const total = keysToUpload.length;
        if (total > 0) {
            useSyncProgressStore.getState().setProjectProgress(source.id, {
                projectId: source.id,
                total,
                completed: 0,
                phase: "uploading",
                message: "正在同步媒体至云端",
            });
        }
        const onMediaUploaded = () => {
            if (total > 0) {
                useSyncProgressStore.getState().incrementProjectCompleted(source.id);
            }
        };
        try {
            const remotePayload = await ensureRemoteResourceReferences(source, uploaded, onMediaUploaded);
            if (total > 0) {
                useSyncProgressStore.getState().setProjectProgress(source.id, {
                    phase: "saving",
                    message: "正在保存画布结构",
                });
            }
            await upsertRemoteCanvasProject(remotePayload);
            acknowledgedProjects.set(source.id, source);
            if (total > 0) useSyncProgressStore.getState().setProjectProgress(source.id, null);
        } catch (error) {
            if (total > 0) {
                useSyncProgressStore.getState().setProjectProgress(source.id, {
                    phase: "error",
                    message: error instanceof Error ? error.message : "云端同步失败，等待重试",
                });
            }
            throw error;
        }
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
