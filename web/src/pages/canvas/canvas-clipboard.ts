// 画布节点复制到系统剪贴板：图片统一转成 PNG 写入。
//
// 资源型图片必须经资源访问合同读取（本地/代理分发需要会话 Cookie，CDN 分发又必须不带 Cookie），
// 因此只从资源缓存取 Blob，不回退到直接 fetch 源地址。

import { translate } from "@/i18n";
import { getCachedResourceBlob } from "@/services/resource-blob-cache";

export async function copyImageToSystemClipboard(source: string, storageKey?: string) {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error(translate("canvasPage.clipboard.copyImageUnsupported"));
    if (typeof window !== "undefined") window.focus();

    const fetchPNG = async (): Promise<Blob> => {
        let sourceBlob: Blob | null = null;
        if (storageKey) {
            sourceBlob = await getCachedResourceBlob(storageKey).catch(() => null);
            // A resource-backed image must be read through the resource access
            // contract. Do not fall back to fetch(source) here: local/proxy
            // deliveries may require the session cookie and a separate API
            // origin, while CDN deliveries must omit that cookie.
            if (!sourceBlob) throw new Error(translate("canvasPage.clipboard.readFailed"));
        }
        if (!sourceBlob) {
            const response = await fetch(source);
            if (!response.ok) throw new Error(translate("canvasPage.clipboard.readFailedHttp", { status: response.status }));
            sourceBlob = await response.blob();
        }
        return sourceBlob.type === "image/png" ? sourceBlob : await convertClipboardImageToPNG(sourceBlob);
    };

    // 优先尝试将 Promise 直接传给 ClipboardItem（现代浏览器标准），在用户激活手势内立即声明写入，
    // 避免因 fetch / 格式转换耗时导致手势过期或窗口失焦抛出 "Document is not focused" 错误。
    try {
        const item = new ClipboardItem({ "image/png": fetchPNG() });
        await navigator.clipboard.write([item]);
        return;
    } catch {
        // 部分浏览器环境不支持延迟 Promise，回退到先取 Blob 再写入
    }

    const blob = await fetchPNG();
    if (typeof window !== "undefined") window.focus();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export async function convertClipboardImageToPNG(blob: Blob) {
    if (typeof createImageBitmap !== "function") throw new Error(translate("canvasPage.clipboard.convertUnsupported"));
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error(translate("canvasPage.clipboard.processUnsupported"));
        context.drawImage(bitmap, 0, 0);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error(translate("canvasPage.clipboard.convertFailed")))), "image/png"));
    } finally {
        bitmap.close();
    }
}
