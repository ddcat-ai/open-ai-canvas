import type { ReferenceImage } from "@/types/image";
import { loadRasterImage } from "./image-raster";

export function formatBytes(bytes: number): string {
    if (!(bytes > 0) || !Number.isFinite(bytes)) return "";
    const exponent = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
    const power = Math.max(0, exponent);
    const scaled = bytes / 1024 ** power;
    return `${scaled.toFixed(power > 0 && scaled < 10 ? 1 : 0)} ${["B", "KB", "MB", "GB"][power]}`;
}

export function formatDuration(milliseconds: number): string {
    const seconds = Number.isFinite(milliseconds) ? Math.max(0, Math.trunc(milliseconds / 1000)) : 0;
    if (seconds < 60) return `${seconds}秒`;
    return `${Math.trunc(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}

function decodeDataUrl(url: string): { bytes: Uint8Array<ArrayBuffer>; mimeType: string } {
    const separator = url.indexOf(",");
    if (!url.startsWith("data:") || separator < 0) throw new Error("无效的图片数据地址");
    const parameters = url.slice(5, separator).split(";");
    const payload = url.slice(separator + 1);
    let bytes: Uint8Array<ArrayBuffer>;
    if (parameters.includes("base64")) {
        const binary = atob(payload.replace(/\s/g, ""));
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } else {
        const encoded = new TextEncoder().encode(payload);
        const output: number[] = [];
        for (let cursor = 0; cursor < encoded.length; cursor++) {
            if (encoded[cursor] !== 37) {
                output.push(encoded[cursor]);
                continue;
            }
            const hex = String.fromCharCode(...encoded.slice(cursor + 1, cursor + 3));
            if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error("图片数据包含无效的转义字符");
            output.push(parseInt(hex, 16));
            cursor += 2;
        }
        bytes = Uint8Array.from(output);
    }
    return { bytes, mimeType: parameters[0] || "" };
}

export function getDataUrlByteSize(url: string): number {
    try {
        const split = url.indexOf(",");
        if (/;base64$/i.test(url.slice(0, split))) {
            const payload = url.slice(split + 1).replace(/\s/g, "");
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return 0;
            return Math.floor(payload.replace(/=+$/, "").length * 0.75);
        }
        return decodeDataUrl(url).bytes.byteLength;
    } catch {
        return 0;
    }
}

export async function readFileAsDataUrl(file: Blob): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16384) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
    return `data:${file.type || "application/octet-stream"};base64,${btoa(chunks.join(""))}`;
}

/** Metadata probes retain their bounded fallback; editing uses strict loadRasterImage directly. */
export async function readImageMeta(source: string, signal?: AbortSignal): Promise<{ width: number; height: number; mimeType: string }> {
    const mimeType = /^data:([^;,]+)/.exec(source)?.[1] || "image/png";
    const request = new AbortController();
    const cancel = () => request.abort();
    const expired = setTimeout(cancel, 3000);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
        const image = await loadRasterImage(source, request.signal);
        return { width: image.naturalWidth, height: image.naturalHeight, mimeType };
    } catch (failure) {
        if (signal?.aborted) throw new DOMException("图片读取已取消", "AbortError");
        return { width: 1024, height: 1024, mimeType };
    } finally {
        clearTimeout(expired);
        signal?.removeEventListener("abort", cancel);
    }
}

export function dataUrlToFile(image: ReferenceImage): File {
    const decoded = decodeDataUrl(image.dataUrl);
    return new File([decoded.bytes], image.name || "reference.png", { type: decoded.mimeType || image.type || "image/png" });
}
