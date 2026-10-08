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
                if (["https:", "http:"].includes(address.protocol) && address.origin !== location.origin) picture.crossOrigin = "anonymous";
            }
            picture.src = source;
        } catch (error) {
            settle(error instanceof Error ? error : new Error("图片地址无效"));
        }
    });
}
