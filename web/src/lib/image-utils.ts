import { t } from "@/i18n";
import type { ReferenceImage } from "@/types/image";

export function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(ms: number) {
    const value = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return minutes ? `${minutes}分${String(seconds).padStart(2, "0")}秒` : t("lib:params", { seconds: seconds });
}

export function getDataUrlByteSize(dataUrl: string) {
    const base64 = dataUrl.split(",", 2)[1];
    if (!base64) {
        return 0;
    }
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(t("lib:failed-to-read-the-image")));
        reader.readAsDataURL(file);
    });
}

export function readImageMeta(dataUrl: string, signal?: AbortSignal) {
    return new Promise<{ width: number; height: number; mimeType: string }>((resolve, reject) => {
        const image = new Image();
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = (cancelLoad = false) => {
            if (timer !== undefined) clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            signal?.removeEventListener("abort", onAbort);
            if (cancelLoad) image.src = "";
        };
        const done = (cancelLoad = false) => {
            if (settled) return;
            settled = true;
            cleanup(cancelLoad);
            resolve({ width: image.naturalWidth || 1024, height: image.naturalHeight || 1024, mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" });
        };
        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup(true);
            reject(new DOMException("The operation was aborted", "AbortError"));
        };

        image.onload = () => done();
        image.onerror = () => done();
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => done(true), 3000);
        if (signal?.aborted) {
            onAbort();
            return;
        }
        image.src = dataUrl;
    });
}

export function dataUrlToFile(image: ReferenceImage) {
    const [header, content] = image.dataUrl.split(",", 2);
    const mimeType = header.match(/data:(.*?);base64/)?.[1] || image.type || "image/png";
    const binary = atob(content || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], image.name || "reference.png", { type: mimeType });
}
