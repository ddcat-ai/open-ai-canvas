import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { resourceIdFromStorageKey } from "@/services/api/resources";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";

type CachedResourceImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    storageKey?: string;
    src?: string;
    fallback?: ReactNode;
    eager?: boolean;
};

/**
 * 资源图片优先读取按用户隔离的本地 Blob 缓存，避免刷新后再次从对象存储下载。
 * 普通外链、data URL 和本地 Blob URL 不经过资源缓存，保持原有行为。
 */
export function CachedResourceImage({ storageKey, src = "", fallback = null, eager = false, onError, ...props }: CachedResourceImageProps) {
    const remoteResource = Boolean(resourceIdFromStorageKey(storageKey));
    const targetRef = useRef<HTMLSpanElement>(null);
    const [nearViewport, setNearViewport] = useState(eager || !remoteResource);
    const [cachedSrc, setCachedSrc] = useState(remoteResource ? "" : src);
    const [cacheFailed, setCacheFailed] = useState(false);

    useEffect(() => {
        if (!remoteResource || eager) {
            setNearViewport(true);
            return;
        }
        const image = targetRef.current;
        if (!image || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setNearViewport(true);
                observer.disconnect();
            }
        }, { rootMargin: "240px" });
        observer.observe(image);
        return () => observer.disconnect();
    }, [eager, remoteResource]);

    useEffect(() => {
        let cancelled = false;
        setCacheFailed(false);
        if (!remoteResource || !storageKey) {
            setCachedSrc(src);
            return () => { cancelled = true; };
        }
        if (!nearViewport) {
            setCachedSrc("");
            return () => { cancelled = true; };
        }

        setCachedSrc("");
        const resolve = cacheResourceObjectUrl(storageKey);
        void resolve.then((url) => {
            if (!cancelled) setCachedSrc(url || src);
        }).catch(() => {
            if (!cancelled) {
                setCacheFailed(true);
                setCachedSrc(src);
            }
        });
        return () => { cancelled = true; };
    }, [nearViewport, remoteResource, src, storageKey]);

    if (!remoteResource) return <img {...props} src={cachedSrc} onError={onError} />;
    return (
        <span ref={targetRef} className="cached-resource-image-shell">
            {cachedSrc && !(cacheFailed && !src) ? <img {...props} src={cachedSrc} onError={onError} /> : fallback}
        </span>
    );
}
