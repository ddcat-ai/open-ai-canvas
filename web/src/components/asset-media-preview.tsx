import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
    /** 解析授权地址期间显示的内容，缺省与 fallback 相同。 */
    loadingFallback?: ReactNode;
    /** 图片或视频首帧可以显示时调用，供卡片结束加载骨架。 */
    onLoad?: () => void;
    onError?: () => void;
};

export function AssetMediaPreview({ asset, alt, className = "", fallback = null, loadingFallback = fallback, onLoad, onError }: AssetMediaPreviewProps) {
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
                    // 有封面时显示的是 poster，preload=metadata 下不一定再触发 loadeddata。
                    if (poster) onLoad?.();
                    else if (video.currentTime === 0 && video.duration > 0) video.currentTime = Math.min(0.001, video.duration);
                }}
                onLoadedData={onLoad}
                onError={onError}
            />
        );
    }

    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return <CachedResourceImage storageKey={storageKey} src={imageUrl} alt={alt} loading="lazy" decoding="async" className={className} fallback={fallback} loadingFallback={loadingFallback} onLoad={onLoad} onError={onError} />;
}
