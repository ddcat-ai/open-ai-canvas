type Timer = ReturnType<typeof setTimeout>;
type PollingEnvironment = {
    hidden: () => boolean;
    online: () => boolean;
    listen: (wake: () => void) => () => void;
    schedule: (callback: () => void, delay: number) => Timer;
    clear: (timer: Timer) => void;
};

const browserEnvironment: PollingEnvironment = {
    hidden: () => document.hidden,
    online: () => navigator.onLine !== false,
    listen(wake) {
        document.addEventListener("visibilitychange", wake);
        window.addEventListener("online", wake);
        window.addEventListener("offline", wake);
        return () => {
            document.removeEventListener("visibilitychange", wake);
            window.removeEventListener("online", wake);
            window.removeEventListener("offline", wake);
        };
    },
    schedule: (callback, delay) => setTimeout(callback, delay),
    clear: (timer) => clearTimeout(timer),
};

// One request at a time, including foreground/network wakeups. Presence reads
// never retry mutations; the caller retains drafts and durable save errors.
export function startCanvasSyncPolling(poll: (signal: AbortSignal) => Promise<void>, env: PollingEnvironment = browserEnvironment) {
    let stopped = false;
    let failures = 0;
    let timer: Timer | undefined;
    let active: AbortController | undefined;
    let wakePending = false;
    const clearTimer = () => {
        if (timer !== undefined) env.clear(timer);
        timer = undefined;
    };
    const schedule = () => {
        if (stopped || !env.online()) return;
        const delay = Math.max(env.hidden() ? 15000 : 2000, failures ? Math.min(30000, 2000 * 2 ** (failures - 1)) : 0);
        timer = env.schedule(() => {
            timer = undefined;
            void run();
        }, delay);
    };
    const run = async () => {
        if (stopped || active || !env.online()) return;
        const controller = new AbortController();
        active = controller;
        try {
            await poll(controller.signal);
            if (!controller.signal.aborted) failures = 0;
        } catch (cause) {
            if (!controller.signal.aborted) {
                const status = (cause as { status?: number } | null)?.status;
                if (status && [401, 403, 404].includes(status)) {
                    stop();
                    return;
                }
                failures = Math.min(failures + 1, 5);
            }
        } finally {
            active = undefined;
            if (wakePending && !stopped && env.online()) {
                wakePending = false;
                void run();
            } else schedule();
        }
    };
    const wake = () => {
        if (stopped) return;
        clearTimer();
        if (!env.online()) {
            wakePending = false;
            active?.abort();
            return;
        }
        if (env.hidden()) {
            wakePending = false;
            if (!active) schedule();
            return;
        }
        failures = 0;
        if (active) wakePending = true;
        else void run();
    };
    const unlisten = env.listen(wake);
    const stop = () => {
        stopped = true;
        wakePending = false;
        clearTimer();
        active?.abort();
        unlisten();
    };
    void run();
    return stop;
}
