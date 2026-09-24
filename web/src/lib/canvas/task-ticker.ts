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
