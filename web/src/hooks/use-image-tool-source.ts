import { useEffect, useState } from "react";
import { loadRasterImage, prepareRasterSource } from "@/lib/image-raster";
import type { PixelSize } from "@/lib/canvas/image-operation-plan";
import { getImageBlob } from "@/services/image-storage";

export function useImageToolSource(source: string, storageKey?: string) {
    const identity = `${source}\n${storageKey || ""}`;
    const initialDisplaySource = storageKey ? "" : source;
    const [result, setResult] = useState<{ identity: string; displaySource: string; size: PixelSize | null; error: string }>({ identity, displaySource: initialDisplaySource, size: null, error: "" });
    useEffect(() => {
        const request = new AbortController();
        let release = () => {};
        setResult({ identity, displaySource: initialDisplaySource, size: null, error: "" });
        void prepareRasterSource(source, storageKey ? () => getImageBlob(storageKey) : undefined)
            .then((prepared) => {
                if (request.signal.aborted) {
                    prepared.release();
                    return null;
                }
                release = prepared.release;
                setResult({ identity, displaySource: prepared.url, size: null, error: "" });
                return loadRasterImage(prepared.url, request.signal);
            })
            .then(
                (image) => {
                    if (image && !request.signal.aborted) setResult({ identity, displaySource: image.src, size: { width: image.naturalWidth, height: image.naturalHeight }, error: "" });
                },
                (error: unknown) => {
                    if (!request.signal.aborted) setResult({ identity, displaySource: initialDisplaySource, size: null, error: error instanceof Error ? error.message : "图片读取失败" });
                },
            );
        return () => {
            request.abort();
            release();
        };
    }, [identity, initialDisplaySource, source, storageKey]);
    return result.identity === identity ? result : { identity, displaySource: initialDisplaySource, size: null, error: "" };
}
