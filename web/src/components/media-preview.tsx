import { ImageOff } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_UNAVAILABLE_LABEL = "预览不可用，素材可能已删除";

export function MediaPreview({
    src,
    kind,
    alt = "",
    className,
    fallbackClassName,
    fallbackLabel = DEFAULT_UNAVAILABLE_LABEL,
    controls = false,
    loading,
    width,
    height,
    onUnavailable,
}: {
    src: string;
    kind: "image" | "video";
    alt?: string;
    className?: string;
    fallbackClassName?: string;
    fallbackLabel?: string;
    controls?: boolean;
    loading?: "eager" | "lazy";
    width?: number;
    height?: number;
    onUnavailable?: () => void;
}) {
    const [failedSrc, setFailedSrc] = useState("");
    const unavailable = failedSrc === src;

    const handleUnavailable = () => {
        setFailedSrc(src);
        onUnavailable?.();
    };

    if (unavailable) {
        return (
            <span className={cn("media-unavailable", fallbackClassName)} role="img" aria-label={fallbackLabel} title={fallbackLabel}>
                <ImageOff aria-hidden="true" />
                <span>{fallbackLabel}</span>
            </span>
        );
    }

    if (kind === "video") {
        return <video src={src} width={width} height={height} muted={!controls} playsInline controls={controls} preload="metadata" className={className} onError={handleUnavailable} />;
    }

    return <img src={src} alt={alt} width={width} height={height} loading={loading} className={className} onError={handleUnavailable} />;
}
