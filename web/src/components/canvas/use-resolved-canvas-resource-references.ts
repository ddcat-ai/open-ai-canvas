import { useEffect, useMemo, useState } from "react";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { loadCanvasDrawingPreview } from "@/lib/canvas/canvas-drawing-storage";
import { resolveImageUrl } from "@/services/image-storage";

type ResolvedPreview = {
    identity: string;
    url: string;
};

const previewPromiseCache = new Map<string, Promise<string>>();

export function useResolvedCanvasResourceReferences(references: CanvasResourceReference[], options?: { projectId?: string }) {
    const projectId = options?.projectId;
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
    }, [projectId, requests]);

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
    if (cached) return cached;
    if (reference.drawingId && projectId) {
        const pending = loadCanvasDrawingPreview(projectId, reference.drawingId)
            .then((preview) => preview ? blobToDataUrl(preview) : reference.previewUrl || "")
            .catch(() => reference.previewUrl || "")
            .then((url) => {
                if (!url) previewPromiseCache.delete(identity);
                return url;
            });
        previewPromiseCache.set(identity, pending);
        return pending;
    }
    const storageKey = reference.kind === "video" ? reference.previewStorageKey : reference.storageKey;
    const pending = resolveImageUrl(storageKey, reference.previewUrl || "", { cacheMiss: true })
        .catch(() => reference.previewUrl || "")
        .then((url) => {
            if (!url) previewPromiseCache.delete(identity);
            return url;
        });
    previewPromiseCache.set(identity, pending);
    return pending;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("读取绘图预览失败"));
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.readAsDataURL(blob);
    });
}
