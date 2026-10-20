import { useEffect, useState } from "react";
import { loadRasterImage } from "@/lib/image-raster";
import type { PixelSize } from "@/lib/canvas/image-operation-plan";
import { resolveImageUrl } from "@/services/image-storage";

export function useImageToolSource(source: string, options: { storageKey?: string; readPixels?: boolean } = {}) {
    const { storageKey, readPixels = true } = options;
    const requestKey = JSON.stringify([source, storageKey, readPixels]);
    const [result, setResult] = useState<{ source: string; resolvedSource: string; size: PixelSize | null; error: string }>({ source: requestKey, resolvedSource: "", size: null, error: "" });
    useEffect(() => {
        const request = new AbortController();
        setResult({ source: requestKey, resolvedSource: "", size: null, error: "" });
        void (async () => {
            const resolvedSource = storageKey ? await resolveImageUrl(storageKey, source) : source;
            const image = await loadRasterImage(resolvedSource, request.signal, { readPixels });
            return { image, resolvedSource };
        })().then(
            ({ image, resolvedSource }) => {
                if (!request.signal.aborted) setResult({ source: requestKey, resolvedSource, size: { width: image.naturalWidth, height: image.naturalHeight }, error: "" });
            },
            (error: unknown) => {
                if (!request.signal.aborted) setResult({ source: requestKey, resolvedSource: "", size: null, error: error instanceof Error ? error.message : "图片读取失败" });
            },
        );
        return () => request.abort();
    }, [source, storageKey, readPixels, requestKey]);
    return result.source === requestKey ? result : { source: requestKey, resolvedSource: "", size: null, error: "" };
}
