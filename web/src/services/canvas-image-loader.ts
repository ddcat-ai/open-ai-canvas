import { getActiveUserScope } from "@/lib/user-scope";

const MAX_ACTIVE_IMAGE_PREPARATIONS = 4;
const IMAGE_PREPARATION_TIMEOUT_MS = 60_000;
const MAX_CACHED_IMAGES = 48;
const MAX_CACHED_PIXELS = 16_000_000;
const IMAGE_CACHE_TTL_MS = 60_000;

type SharedPreparation = { controller: AbortController; promise: Promise<HTMLImageElement>; consumers: number };
const preparations = new Map<string, SharedPreparation>();
const preparedImages = new Map<string, { image: HTMLImageElement; pixels: number; expiresAt: number }>();
let preparedPixels = 0;
let preparationScope = "";

/** Share work across nodes and LOD remounts without letting one consumer cancel the others. */
export function prepareCanvasImage(src: string, signal: AbortSignal, timeoutMs = IMAGE_PREPARATION_TIMEOUT_MS): Promise<HTMLImageElement> {
    if (signal.aborted) return Promise.reject(abortError());
    const scope = getActiveUserScope();
    if (scope !== preparationScope) {
        preparationScope = scope;
        preparedImages.clear();
        preparedPixels = 0;
        for (const pending of preparations.values()) pending.controller.abort();
        preparations.clear();
    }
    for (const [key, value] of preparedImages) {
        if (value.expiresAt <= Date.now()) {
            preparedPixels -= value.pixels;
            preparedImages.delete(key);
        }
    }
    const cached = preparedImages.get(src);
    if (cached) {
        preparedImages.delete(src);
        preparedImages.set(src, cached);
        return Promise.resolve(cached.image);
    }
    let pending = preparations.get(src);
    if (!pending) {
        const controller = new AbortController();
        const entry: SharedPreparation = { controller, consumers: 0, promise: enqueueCanvasImage(src, controller.signal, timeoutMs) };
        entry.promise = entry.promise
            .then((image) => {
                if (controller.signal.aborted || scope !== getActiveUserScope() || preparations.get(src) !== entry) throw abortError();
                const pixels = image.naturalWidth * image.naturalHeight;
                if (pixels > 0 && pixels <= MAX_CACHED_PIXELS && !src.startsWith("blob:")) {
                    while (preparedImages.size >= MAX_CACHED_IMAGES || preparedPixels + pixels > MAX_CACHED_PIXELS) {
                        const oldest = preparedImages.keys().next().value;
                        if (oldest === undefined) break;
                        preparedPixels -= preparedImages.get(oldest)!.pixels;
                        preparedImages.delete(oldest);
                    }
                    preparedImages.set(src, { image, pixels, expiresAt: Date.now() + IMAGE_CACHE_TTL_MS });
                    preparedPixels += pixels;
                }
                return image;
            })
            .finally(() => {
                if (preparations.get(src) === entry) preparations.delete(src);
            });
        pending = entry;
        preparations.set(src, pending);
    }
    const shared = pending;
    shared.consumers += 1;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (image?: HTMLImageElement, error?: unknown) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            shared.consumers -= 1;
            if (error !== undefined) reject(error);
            else resolve(image!);
        };
        const onAbort = () => {
            finish(undefined, abortError());
            // React can immediately remount the same image. Allow that consumer
            // to join before cancelling an otherwise unreferenced job.
            queueMicrotask(() => {
                if (shared.consumers === 0 && preparations.get(src) === shared) {
                    preparations.delete(src);
                    shared.controller.abort();
                }
            });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        shared.promise.then(
            (image) => finish(image),
            (error) => finish(undefined, error),
        );
    });
}

type ImagePreparationJob = {
    src: string;
    signal: AbortSignal;
    resolve: (image: HTMLImageElement) => void;
    reject: (error: unknown) => void;
    started: boolean;
    settled: boolean;
    image?: HTMLImageElement;
    timeout?: ReturnType<typeof setTimeout>;
    timeoutMs: number;
    onAbort: () => void;
};

const queue: ImagePreparationJob[] = [];
let activePreparations = 0;

/** Load and decode one image under a shared concurrency budget. Queued work is cancellable. */
function enqueueCanvasImage(src: string, signal: AbortSignal, timeoutMs: number): Promise<HTMLImageElement> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const job: ImagePreparationJob = { src, signal, resolve, reject, started: false, settled: false, timeoutMs, onAbort: () => {} };
        job.onAbort = () => {
            if (job.settled) return;
            if (!job.started) {
                const index = queue.indexOf(job);
                if (index >= 0) queue.splice(index, 1);
                settle(job, undefined, abortError());
                return;
            }
            job.image?.removeAttribute("src");
            settle(job, undefined, abortError());
        };
        signal.addEventListener("abort", job.onAbort, { once: true });
        queue.push(job);
        pump();
    });
}

export function canvasImagePreparationStats() {
    return { active: activePreparations, queued: queue.length, limit: MAX_ACTIVE_IMAGE_PREPARATIONS };
}

function pump() {
    while (activePreparations < MAX_ACTIVE_IMAGE_PREPARATIONS && queue.length) {
        const job = queue.shift()!;
        if (job.settled || job.signal.aborted) {
            settle(job, undefined, abortError());
            continue;
        }
        job.started = true;
        activePreparations += 1;
        job.timeout = setTimeout(() => {
            job.image?.removeAttribute("src");
            settle(job, undefined, new Error("图片加载或解码超时"));
        }, job.timeoutMs);

        const image = new Image();
        job.image = image;
        image.decoding = "async";
        image.onload = () => {
            if (job.settled || job.signal.aborted) return;
            image.onload = null;
            void image.decode().then(
                () => settle(job, image),
                (error) => settle(job, undefined, error),
            );
        };
        image.onerror = () => settle(job, undefined, new Error("图片加载失败"));
        image.src = job.src;
        if (image.complete && image.naturalWidth > 0) image.onload?.call(image, new Event("load"));
    }
}

function settle(job: ImagePreparationJob, image?: HTMLImageElement, error?: unknown) {
    if (job.settled) return;
    job.settled = true;
    job.signal.removeEventListener("abort", job.onAbort);
    if (job.timeout) clearTimeout(job.timeout);
    if (job.image) {
        job.image.onload = null;
        job.image.onerror = null;
    }
    if (job.started) {
        activePreparations = Math.max(0, activePreparations - 1);
        pump();
    }
    if (error !== undefined) job.reject(error);
    else if (image) job.resolve(image);
    else job.reject(new Error("图片准备未完成"));
}

function abortError() {
    return new DOMException("图片准备已取消", "AbortError");
}
