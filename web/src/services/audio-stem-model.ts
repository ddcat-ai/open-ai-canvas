import { AUDIO_STEM_MODEL } from "@/lib/audio-stem/contracts";

const CACHE_NAME = "pixelshort-audio-stem-v1";
const CACHE_KEY = `/__audio-stem-model__/${AUDIO_STEM_MODEL.sha256}`;

async function validateModel(buffer: ArrayBuffer) {
    if (buffer.byteLength !== AUDIO_STEM_MODEL.bytes) throw new Error("分离模型下载不完整，请重试");
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== AUDIO_STEM_MODEL.sha256) throw new Error("分离模型校验失败，请重试");
    return buffer;
}

export async function readAudioStemModel(signal: AbortSignal, onProgress: (percent: number) => void): Promise<ArrayBuffer> {
    signal.throwIfAborted();
    let cache: Cache | undefined;
    try {
        cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(CACHE_KEY);
        if (cached) {
            try {
                const model = await validateModel(await cached.arrayBuffer());
                signal.throwIfAborted();
                onProgress(100);
                return model;
            } catch (error) {
                signal.throwIfAborted();
                await cache.delete(CACHE_KEY);
            }
        }
    } catch {
        // 缓存被禁用或配额不足时，本次下载和推理仍然可用。
    }
    signal.throwIfAborted();
    const base = (import.meta.env.VITE_AUDIO_STEM_MODEL_BASE_URL || "https://hf-mirror.com").replace(/\/$/, "");
    const url = new URL(`${base}/${AUDIO_STEM_MODEL.path}`);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("分离模型下载源必须使用无凭据的 HTTPS 地址");
    const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]);
    const response = await fetch(url, { signal: downloadSignal, credentials: "omit" });
    if (!response.ok || !response.body) throw new Error(`分离模型下载失败（${response.status}）`);
    const reader = response.body.getReader();
    const bytes = new Uint8Array(AUDIO_STEM_MODEL.bytes);
    let offset = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (offset + value.length > bytes.length) throw new Error("分离模型大小异常");
            bytes.set(value, offset);
            offset += value.length;
            onProgress(Math.floor((offset / bytes.length) * 100));
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const model = await validateModel(bytes.buffer);
    signal.throwIfAborted();
    try {
        await cache?.put(CACHE_KEY, new Response(model, { headers: { "Content-Type": "application/octet-stream" } }));
    } catch {
        // 模型校验已通过，持久缓存失败不能阻断这次处理。
    }
    signal.throwIfAborted();
    return model;
}
