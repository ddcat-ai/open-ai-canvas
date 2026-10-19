export type SpriteImageKind = "atlas" | "thumbnail";
type Entry = { key: string; kind: SpriteImageKind; promise: Promise<string>; controller: AbortController; refs: number; src: string; bytes: number; touched: number; timer?: ReturnType<typeof setTimeout> };

/** Separate queues reserve an atlas slot for the selected pet, even while the picker is loading. */
export function createSpriteImageCache() {
    const entries = new Map<string, Entry>();
    const queues: Record<SpriteImageKind, (() => void)[]> = { atlas: [], thumbnail: [] };
    const active = { atlas: 0, thumbnail: 0 };
    const limits = { atlas: 1, thumbnail: 3 };
    const budgets = { atlas: 64 * 1024 * 1024, thumbnail: 4 * 1024 * 1024 };
    const counts = { atlas: 3, thumbnail: 64 };
    function schedule(kind: SpriteImageKind) {
        while (active[kind] < limits[kind] && queues[kind].length) queues[kind].shift()!();
    }
    function remove(entry: Entry) {
        if (entries.get(entry.key) !== entry) return;
        entries.delete(entry.key);
        clearTimeout(entry.timer);
        entry.controller.abort();
        if (entry.src) URL.revokeObjectURL(entry.src);
    }
    function trim(kind: SpriteImageKind) {
        const all = [...entries.values()].filter((e) => e.kind === kind);
        let bytes = all.reduce((n, e) => n + e.bytes, 0),
            count = all.length;
        for (const e of all.filter((e) => !e.refs && e.src).sort((a, b) => a.touched - b.touched)) {
            if (bytes <= budgets[kind] && count <= counts[kind]) break;
            bytes -= e.bytes;
            count--;
            remove(e);
        }
    }
    return {
        acquire(url: string, scope: string, kind: SpriteImageKind, decodedBytes = kind === "thumbnail" ? 88 * 88 * 4 : 4096 * 4096 * 4) {
            const key = `${scope}:${kind}:${url}`;
            let entry = entries.get(key);
            if (!entry) {
                const controller = new AbortController();
                const e: Entry = { key, kind, controller, refs: 0, src: "", bytes: decodedBytes, touched: Date.now(), promise: Promise.resolve("") };
                e.promise = new Promise<string>((resolve, reject) => {
                    const run = () => {
                        if (controller.signal.aborted) {
                            reject(new Error("加载已取消"));
                            return;
                        }
                        active[kind]++;
                        const deadline = setTimeout(() => controller.abort(), 30000);
                        fetch(url, { credentials: "include", signal: controller.signal, priority: kind === "atlas" ? "high" : "low" })
                            .then(async (response) => {
                                if (!response.ok) throw new Error("形象加载失败");
                                const blob = await response.blob();
                                if (controller.signal.aborted) throw new Error("加载已取消");
                                if (blob.size > (kind === "thumbnail" ? 256 * 1024 : 16 * 1024 * 1024) || !["image/png", "image/webp"].includes(blob.type)) throw new Error("形象图片无效");
                                e.src = URL.createObjectURL(blob);
                                e.bytes = decodedBytes + blob.size;
                                resolve(e.src);
                                trim(kind);
                            })
                            .catch((error) => {
                                remove(e);
                                reject(error);
                            })
                            .finally(() => {
                                clearTimeout(deadline);
                                active[kind]--;
                                schedule(kind);
                            });
                    };
                    queues[kind].push(run);
                });
                entries.set(key, e);
                entry = e;
            }
            const current = entry;
            clearTimeout(current.timer);
            current.refs++;
            current.touched = Date.now();
            schedule(kind);
            return {
                promise: current.promise,
                release() {
                    current.refs = Math.max(0, current.refs - 1);
                    current.touched = Date.now();
                    if (!current.refs) {
                        if (!current.src) remove(current);
                        else {
                            current.timer = setTimeout(() => remove(current), kind === "thumbnail" ? 600000 : 120000);
                            trim(kind);
                        }
                    }
                },
            };
        },
        clear() {
            for (const entry of entries.values()) remove(entry);
        },
    };
}

export const spriteImageCache = createSpriteImageCache();
