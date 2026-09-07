import { useEffect, useMemo, useState } from "react";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { resolveImageUrl } from "@/services/image-storage";
import { resourceFallbackUrl, resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";

type ResolvedPreview = {
    identity: string;
    url: string;
};

const previewPromiseCache = new Map<string, Promise<string>>();

export function useResolvedCanvasResourceReferences(references: CanvasResourceReference[]) {
    const requests = useMemo(
        () => references.flatMap((reference) => {
            const identity = previewIdentity(reference);
            return identity ? [{ reference, identity }] : [];
        }),
        [references],
    );
    const [resolvedById, setResolvedById] = useState<Record<string, ResolvedPreview>>({});

    useEffect(() => {
        if (!requests.length) return;
        let cancelled = false;
        void Promise.all(
            requests.map(async ({ reference, identity }) => ({
                id: reference.id,
                identity,
                url: await resolveReferencePreview(reference, identity),
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
    }, [requests]);

    return useMemo(
        () => references.map((reference) => {
            const identity = previewIdentity(reference);
            const resolved = identity ? resolvedById[reference.id] : undefined;
            if (resolved?.identity === identity) {
                return resolved.url !== reference.previewUrl ? { ...reference, previewUrl: resolved.url } : reference;
            }
            // A persisted canvas can still carry the legacy same-origin
            // `/api/resources/:id/file` URL. Do not mount it for one render
            // while the Blob/direct provider URL is being resolved; every
            // remount of the prompt panel would otherwise trigger a redirect.
            if (identity && resourceIdForReferencePreview(reference)) return reference.previewUrl ? { ...reference, previewUrl: "" } : reference;
            return reference;
        }),
        [references, resolvedById],
    );
}

function previewIdentity(reference: CanvasResourceReference) {
    const storageKey = referencePreviewStorageKey(reference);
    if (!storageKey || !["image", "video", "character"].includes(reference.kind)) return "";
    return `${reference.kind}:${storageKey}`;
}

function resolveReferencePreview(reference: CanvasResourceReference, identity: string) {
    const cached = previewPromiseCache.get(identity);
    if (cached) return cached;
    const storageKey = referencePreviewStorageKey(reference);
    const resourceId = resourceIdFromStorageKey(storageKey);
    const fallback = resourceId ? resourceFallbackUrl(resourceId, reference.previewUrl || "") : reference.previewUrl || "";
    const pending = resolveImageUrl(storageKey, fallback, { cacheMiss: true, proxyFallback: false })
        .catch(() => fallback)
        .then((url) => {
            if (!url) previewPromiseCache.delete(identity);
            return url;
        });
    previewPromiseCache.set(identity, pending);
    return pending;
}

function resourceIdForReferencePreview(reference: CanvasResourceReference) {
    return resourceIdFromStorageKey(referencePreviewStorageKey(reference)) || resourceIdFromFileUrl(reference.previewUrl);
}

function referencePreviewStorageKey(reference: CanvasResourceReference) {
    const storageKey = reference.kind === "video" ? reference.previewStorageKey : reference.storageKey;
    if (storageKey) return storageKey;
    const resourceId = resourceIdFromFileUrl(reference.previewUrl);
    return resourceId ? resourceStorageKey(resourceId) : "";
}
