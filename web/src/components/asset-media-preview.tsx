import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
    thumbnailOnly?: boolean;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null, thumbnailOnly = false }: AssetMediaPreviewProps) {
    if (!asset) return fallback;

    if ((asset.kind === "video" || asset.kind === "audio") && asset.data.url) {
        if (thumbnailOnly && asset.kind === "video") {
            return asset.coverUrl ? <CachedResourceImage src={asset.coverUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} /> : fallback;
        }
        if (asset.kind === "audio") {
            return <audio src={asset.data.url} aria-label={alt} controls preload="metadata" className={className} />;
        }
        const poster = asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : undefined;
        return (
            <video
                src={asset.data.url}
                poster={poster}
                aria-label={alt}
                muted
                controls
                playsInline
                preload="metadata"
                className={className}
                onLoadedMetadata={(event) => {
                    // 主动触发首帧附近的解码，避免只有 metadata 时长期停留在空白画面。
                    const video = event.currentTarget;
                    if (!poster && video.currentTime === 0 && video.duration > 0) video.currentTime = Math.min(0.001, video.duration);
                }}
            />
        );
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (thumbnailOnly && asset.kind === "image") {
        return asset.coverUrl ? <CachedResourceImage src={asset.coverUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} /> : fallback;
    }
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} />;
}
