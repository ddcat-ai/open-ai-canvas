import { useEffect, useState } from "react";
import { loadRasterImage } from "@/lib/image-raster";
import type { PixelSize } from "@/lib/canvas/image-operation-plan";

export function useImageToolSource(source: string) {
    const [result, setResult] = useState<{ source: string; size: PixelSize | null; error: string }>({ source, size: null, error: "" });
    useEffect(() => {
        const request = new AbortController();
        setResult({ source, size: null, error: "" });
        void loadRasterImage(source, request.signal).then(
            (image) => {
                if (!request.signal.aborted) setResult({ source, size: { width: image.naturalWidth, height: image.naturalHeight }, error: "" });
            },
            (error: unknown) => {
                if (!request.signal.aborted) setResult({ source, size: null, error: error instanceof Error ? error.message : "图片读取失败" });
            },
        );
        return () => request.abort();
    }, [source]);
    return result.source === source ? result : { source, size: null, error: "" };
}
