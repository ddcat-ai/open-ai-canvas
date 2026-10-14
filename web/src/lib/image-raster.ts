export async function prepareRasterSource(source: string, readBlob?: () => Promise<Blob | null>): Promise<{ url: string; release: () => void }> {
    if (!source.trim()) throw new Error("图片地址为空");
    if (source.startsWith("data:") || source.startsWith("blob:")) return { url: source, release: () => {} };
    let blob = await readBlob?.();
    if (!blob) {
        // fetch validates CORS across redirects; a display-only image URL must never be drawn as a fallback.
        const response = await fetch(source, { mode: "cors", credentials: "same-origin" });
        if (!response.ok) throw new Error(`原图读取失败（${response.status}）`);
        blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    return { url, release: () => URL.revokeObjectURL(url) };
}

export function loadRasterImage(source: string, signal?: AbortSignal): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const picture = new Image();
        let finished = false;
        const settle = (error?: Error) => {
            if (finished) return;
            finished = true;
            clearTimeout(deadline);
            signal?.removeEventListener("abort", cancel);
            picture.onload = null;
            picture.onerror = null;
            if (error) {
                picture.src = "";
                reject(error);
            } else resolve(picture);
        };
        const cancel = () => settle(new DOMException("图片读取已取消", "AbortError"));
        const deadline = setTimeout(() => settle(new Error("图片读取超时")), 15000);
        picture.onload = () => settle(picture.naturalWidth > 0 && picture.naturalHeight > 0 ? undefined : new Error("图片尺寸无效"));
        picture.onerror = () => settle(new Error("图片加载失败，无法处理该图片"));
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) return cancel();
        if (!source.trim()) return settle(new Error("图片地址为空"));
        try {
            const location = globalThis.location;
            if (location) {
                const address = new URL(source, location.href);
                // Same-origin resource URLs can redirect to OSS/CDN, so they also need a CORS image request.
                if (["https:", "http:"].includes(address.protocol)) picture.crossOrigin = "anonymous";
            }
            picture.src = source;
        } catch (error) {
            settle(error instanceof Error ? error : new Error("图片地址无效"));
        }
    });
}
