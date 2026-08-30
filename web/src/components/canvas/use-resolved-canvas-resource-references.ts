import { useEffect, useMemo, useState } from "react";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { resolveImageUrl } from "@/services/image-storage";

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
            return resolved?.identity === identity && resolved.url !== reference.previewUrl ? { ...reference, previewUrl: resolved.url } : reference;
        }),
        [references, resolvedById],
    );
}

function previewIdentity(reference: CanvasResourceReference) {
    const storageKey = reference.kind === "video" ? reference.previewStorageKey : reference.storageKey;
    if (!storageKey || !["image", "video", "character"].includes(reference.kind)) return "";
    return `${reference.kind}:${storageKey}`;
}

function resolveReferencePreview(reference: CanvasResourceReference, identity: string) {
    const cached = previewPromiseCache.get(identity);
    if (cached) return cached;
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
