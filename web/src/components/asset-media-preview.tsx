import type { ReactNode } from "react";

import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null }: AssetMediaPreviewProps) {
    if (!asset) return fallback;

    if (asset.kind === "video" && asset.data.url) {
        const poster = asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : undefined;
        return (
            <video
                src={asset.data.url}
                poster={poster}
                aria-label={alt}
                muted
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

    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl) return fallback;
    return <img src={imageUrl} alt={alt} loading="lazy" decoding="async" className={className} />;
}
