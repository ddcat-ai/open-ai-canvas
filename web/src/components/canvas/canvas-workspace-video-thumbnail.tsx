import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { resolveVideoMediaUrl } from "@/services/file-storage";

/** Prefer an existing cover; only decode a video frame for visible rows without one. */
export function CanvasWorkspaceVideoThumbnail({ cover, coverStorageKey, videoStorageKey, videoUrl }: { cover?: string; coverStorageKey?: string; videoStorageKey?: string; videoUrl?: string }) {
    const fallback = <VideoFrame storageKey={videoStorageKey} url={videoUrl} />;
    if (!cover && !coverStorageKey) return fallback;
    return <CachedResourceImage src={cover} storageKey={coverStorageKey} variant="thumbnail" alt="" className="h-full w-full object-cover" loadingFallback={<Video className="size-4 text-muted-foreground" />} fallback={fallback} />;
}

function VideoFrame({ storageKey, url }: { storageKey?: string; url?: string }) {
    const target = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(false);
    const [src, setSrc] = useState("");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const element = target.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "80px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setSrc("");
        setFailed(false);
        if (!visible || (!storageKey && !url)) return;
        let cancelled = false;
        void resolveVideoMediaUrl(storageKey, url || "")
            .then((value) => {
                if (!cancelled) {
                    setSrc(value);
                    setFailed(!value);
                }
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [storageKey, url, visible]);
    return (
        <span ref={target} className="grid h-full w-full place-items-center">
            {src && !failed ? (
                <video
                    src={src}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden
                    className="h-full w-full object-cover"
                    onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        if (video.currentTime === 0 && video.duration > 0) video.currentTime = Math.min(0.001, video.duration);
                    }}
                    onError={() => setFailed(true)}
                />
            ) : (
                <Video className="size-4 text-muted-foreground" />
            )}
        </span>
    );
}
