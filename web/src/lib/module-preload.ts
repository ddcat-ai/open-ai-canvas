const MAX_ACTIVE_PRELOADS = 4;
const MAX_BACKGROUND_PRELOADS = MAX_ACTIVE_PRELOADS - 1;

export class PageResourceError extends Error {
    constructor(
        readonly resource: string,
        message: string,
        readonly status?: number,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = "PageResourceError";
    }
}

export type ModuleLoadPriority = { foreground: boolean };

type Download = {
    owners: Set<ModuleLoadPriority>;
    start: () => void;
    promise: Promise<void>;
};

const foreground: ModuleLoadPriority = { foreground: true };
let currentPriority = foreground;
const requests = new Map<string, Download>();
const queue: Download[] = [];
const active = new Set<Download>();

export function withModuleLoadPriority<T>(priority: ModuleLoadPriority, load: () => Promise<T>): Promise<T> {
    const previous = currentPriority;
    currentPriority = priority;
    try {
        // Vite's generated helper captures the priority before its first await.
        return load();
    } finally {
        currentPriority = previous;
    }
}

export function prioritizeModuleLoad(priority: ModuleLoadPriority) {
    priority.foreground = true;
    drain();
}

/** Validate transport before native import, which can cache a failed module for this document. */
export async function warmPreloadResources(urls: string[]) {
    const priority = currentPriority;
    const pending = urls.map((url) => {
        let download = requests.get(url);
        if (!download) {
            let start!: () => void;
            const promise = new Promise<void>((resolve, reject) => {
                start = () => {
                    void fetchResource(url, isForeground(download!))
                        .finally(() => {
                            active.delete(download!);
                            requests.delete(url);
                            drain();
                        })
                        .then(resolve, reject);
                };
            });
            download = { owners: new Set(), start, promise };
            requests.set(url, download);
            queue.push(download);
        }
        download.owners.add(priority);
        return download.promise;
    });
    drain();
    await Promise.all(pending);
}

function isForeground(download: Download) {
    return [...download.owners].some((owner) => owner.foreground);
}

function drain() {
    while (active.size < MAX_ACTIVE_PRELOADS && queue.length) {
        const next = queue.findIndex(isForeground);
        if (next === -1 && [...active].filter((download) => !isForeground(download)).length >= MAX_BACKGROUND_PRELOADS) return;
        const [download] = queue.splice(next === -1 ? 0 : next, 1);
        active.add(download);
        download.start();
    }
}

async function fetchResource(url: string, foreground: boolean) {
    const expectedType = new URL(url).pathname.endsWith(".css") ? /^text\/css(?:;|$)/i : /(?:javascript|ecmascript)/i;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        let retryable = true;
        try {
            const response = await fetch(url, { credentials: "same-origin", priority: foreground ? "high" : "low" });
            if (!response.ok) {
                retryable = response.status >= 500 || response.status === 408 || response.status === 429;
                await response.body?.cancel().catch(() => undefined);
                throw new PageResourceError(url, `页面资源读取失败（${response.status}）`, response.status);
            }
            const type = response.headers.get("Content-Type") || "";
            if (!expectedType.test(type)) {
                retryable = false;
                await response.body?.cancel().catch(() => undefined);
                throw new PageResourceError(url, "页面资源返回了错误的脚本或样式类型", response.status);
            }
            // Complete the body so the subsequent module/link load can reuse the immutable HTTP cache.
            await response.arrayBuffer();
            return;
        } catch (error) {
            if (!retryable || attempt === 2 || globalThis.navigator?.onLine === false) {
                throw error instanceof PageResourceError ? error : new PageResourceError(url, "页面资源下载中断", undefined, error);
            }
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
    }
}
