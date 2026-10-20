// One clock per canvas runtime, not one timer per loading node. No work while
// hidden or when the final loading node unmounts.
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

export const taskTickerSnapshot = () => now;
export const idleTaskTickerSubscribe = () => () => {};

function tick() {
    now = Date.now();
    for (const listener of listeners) listener();
}

function reconcileTimer() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (listeners.size && (typeof document === "undefined" || !document.hidden)) {
        tick();
        timer = setInterval(tick, 1000);
    }
}

export function subscribeTaskTicker(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", reconcileTimer);
        reconcileTimer();
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size) {
            if (typeof document !== "undefined") document.removeEventListener("visibilitychange", reconcileTimer);
            reconcileTimer();
        }
    };
}

/** 终态（completedAt 有效）以完成时刻为终点冻结耗时，避免任务结束后数字继续增长。 */
export function formatTaskElapsed(createdAt: string | undefined, now: number, completedAt?: string) {
    if (!createdAt) return "刚刚";
    const started = new Date(createdAt).getTime();
    if (!Number.isFinite(started)) return "刚刚";
    const completed = completedAt ? new Date(completedAt).getTime() : Number.NaN;
    // 时钟偏差或异常时间戳可能让 completedAt 早于 createdAt，夹紧避免显示负值。
    const end = Number.isFinite(completed) ? Math.max(completed, started) : now;
    const seconds = Math.max(0, Math.floor((end - started) / 1000));
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}分${seconds % 60}秒` : `${Math.floor(minutes / 60)}时${minutes % 60}分`;
}
