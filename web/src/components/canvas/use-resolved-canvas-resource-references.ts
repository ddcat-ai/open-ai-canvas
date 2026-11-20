import { useEffect, useMemo, useState } from "react";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { loadCanvasDrawingPreview } from "@/lib/canvas/canvas-drawing-storage";
import { getResourceAccess, resolveResourceAccessURL, resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveImageUrl } from "@/services/image-storage";
import { translate } from "@/i18n";

type ResolvedPreview = {
    identity: string;
    url: string;
};

type CachedPreview = {
    promise: Promise<string>;
    expiresAt: number;
    url?: string;
};

// 签名地址的有效期由 getResourceAccess 的缓存判断；这里只合并短时间内同一素材的重复解析。
// 不能永久持有：地址过期后重新打开提示词面板仍会拿到旧地址，@ 缩略图就显示空白。
const STORAGE_PREVIEW_CACHE_MS = 60_000;
// 同一素材加载失败后强制换新地址的最短间隔，避免坏文件反复请求后端。
const PREVIEW_REFRESH_COOLDOWN_MS = 30_000;

const previewPromiseCache = new Map<string, CachedPreview>();
const forcedRefreshAt = new Map<string, number>();
const pendingForceRefresh = new Set<string>();
const previewFailureListeners = new Set<() => void>();

/** 缩略图加载失败时调用：作废对应地址，并让正在使用它的提示词编辑器换新签名地址。 */
export function reportResourcePreviewFailure(url: string) {
    if (!url) return;
    const now = Date.now();
    let refreshed = false;
    previewPromiseCache.forEach((entry, identity) => {
        if (entry.url !== url) return;
        previewPromiseCache.delete(identity);
        if (now - (forcedRefreshAt.get(identity) ?? 0) < PREVIEW_REFRESH_COOLDOWN_MS) return;
        forcedRefreshAt.set(identity, now);
        pendingForceRefresh.add(identity);
        refreshed = true;
    });
    if (refreshed) previewFailureListeners.forEach((listener) => listener());
}

export function useResolvedCanvasResourceReferences(references: CanvasResourceReference[], options?: { projectId?: string }) {
    const projectId = options?.projectId;
    const [refreshEpoch, setRefreshEpoch] = useState(0);
    useEffect(() => {
        const listener = () => setRefreshEpoch((value) => value + 1);
        previewFailureListeners.add(listener);
        return () => {
            previewFailureListeners.delete(listener);
        };
    }, []);
    const requests = useMemo(
        () => references.flatMap((reference) => {
            const identity = previewIdentity(reference, projectId);
            return identity ? [{ reference, identity }] : [];
        }),
        [projectId, references],
    );
    const [resolvedById, setResolvedById] = useState<Record<string, ResolvedPreview>>({});

    useEffect(() => {
        if (!requests.length) return;
        let cancelled = false;
        void Promise.all(
            requests.map(async ({ reference, identity }) => ({
                id: reference.id,
                identity,
                url: await resolveReferencePreview(reference, identity, projectId),
            })),
        ).then((resolved) => {
            if (cancelled) return;
            setResolvedById((current) => {
                let changed = false;
                const next = { ...current };
                resolved.forEach(({ id, identity, url }) => {
                    if (!url || (current[id]?.identity === identity && current[id]?.url === url)) return;
                    next[id] = { identity, url };
                    changed = true;
                });
                return changed ? next : current;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [projectId, requests, refreshEpoch]);

    return useMemo(
        () => references.map((reference) => {
            const identity = previewIdentity(reference, projectId);
            const resolved = identity ? resolvedById[reference.id] : undefined;
            return resolved?.identity === identity && resolved.url !== reference.previewUrl ? { ...reference, previewUrl: resolved.url } : reference;
        }),
        [projectId, references, resolvedById],
    );
}

function previewIdentity(reference: CanvasResourceReference, projectId?: string) {
    // 只有当 drawingId 和 projectId 同时存在时才返回绘图身份,避免不完整的缓存键导致运行时错误
    if (reference.drawingId) {
        if (!projectId) return "";
        return `drawing:${projectId}:${reference.drawingId}:${reference.drawingRevision || 0}`;
    }
    const storageKey = reference.kind === "video" ? reference.previewStorageKey : reference.storageKey;
    if (!storageKey || !["image", "video", "character"].includes(reference.kind)) return "";
    return `${reference.kind}:${storageKey}`;
}

function resolveReferencePreview(reference: CanvasResourceReference, identity: string, projectId?: string) {
    const cached = previewPromiseCache.get(identity);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const fallback = reference.previewUrl || "";
    let resolving: Promise<string>;
    let expiresAt: number;
    if (reference.drawingId && projectId) {
        // 绘图预览按修订号区分且是本地 data URL，不会过期。
        resolving = loadCanvasDrawingPreview(projectId, reference.drawingId).then((preview) => (preview ? blobToDataUrl(preview) : ""));
        expiresAt = Number.POSITIVE_INFINITY;
    } else {
        const storageKey = reference.kind === "video" ? reference.previewStorageKey : reference.storageKey;
        resolving =
            pendingForceRefresh.delete(identity) && resourceIdFromStorageKey(storageKey)
                ? getResourceAccess(storageKey, "display", "original", "", { forceRefresh: true }).then((access) => resolveResourceAccessURL(access.url))
                : resolveImageUrl(storageKey, "", { cacheMiss: true });
        expiresAt = Date.now() + STORAGE_PREVIEW_CACHE_MS;
    }
    const entry: CachedPreview = { promise: Promise.resolve(""), expiresAt };
    // 解析失败只退回引用自带的地址，不进缓存：它可能已过期或已被释放，下次仍要重新解析。
    entry.promise = resolving
        .catch(() => "")
        .then((url) => {
            if (!url) {
                if (previewPromiseCache.get(identity) === entry) previewPromiseCache.delete(identity);
                return fallback;
            }
            entry.url = url;
            return url;
        });
    previewPromiseCache.set(identity, entry);
    return entry.promise;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error(translate("canvasC.resourceRefs.drawingPreviewReadFailed")));
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.readAsDataURL(blob);
    });
}
