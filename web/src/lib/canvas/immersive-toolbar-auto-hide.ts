export const IMMERSIVE_TOOLBAR_HIDE_DELAY_MS = 2200;

type TimerHandle = ReturnType<typeof setTimeout>;

export type ImmersiveToolbarScheduler = {
    schedule: (callback: () => void, delayMs: number) => TimerHandle;
    cancel: (handle: TimerHandle) => void;
};

type ImmersiveToolbarAutoHideOptions = {
    delayMs?: number;
    scheduler?: ImmersiveToolbarScheduler;
    onVisibilityChange: (visible: boolean) => void;
    onIdle?: () => void;
};

export type ImmersiveToolbarAutoHideController = {
    setEnabled: (enabled: boolean) => void;
    setSuspended: (suspended: boolean) => void;
    reveal: () => void;
    dispose: () => void;
    isVisible: () => boolean;
};

const browserScheduler: ImmersiveToolbarScheduler = {
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle),
};

export function createImmersiveToolbarAutoHideController({ delayMs = IMMERSIVE_TOOLBAR_HIDE_DELAY_MS, scheduler = browserScheduler, onVisibilityChange, onIdle }: ImmersiveToolbarAutoHideOptions): ImmersiveToolbarAutoHideController {
    let enabled = false;
    let suspended = false;
    let visible = true;
    let timer: TimerHandle | null = null;

    const cancelPendingHide = () => {
        if (timer === null) return;
        scheduler.cancel(timer);
        timer = null;
    };

    const publishVisibility = (next: boolean) => {
        if (visible === next) return;
        visible = next;
        onVisibilityChange(next);
    };

    const scheduleHide = () => {
        cancelPendingHide();
        if (!enabled || suspended) return;
        timer = scheduler.schedule(() => {
            timer = null;
            if (!enabled || suspended) return;
            publishVisibility(false);
            onIdle?.();
        }, delayMs);
    };

    return {
        setEnabled(next) {
            enabled = next;
            cancelPendingHide();
            publishVisibility(true);
            if (enabled) scheduleHide();
        },
        setSuspended(next) {
            suspended = next;
            cancelPendingHide();
            if (suspended) publishVisibility(true);
            else scheduleHide();
        },
        reveal() {
            if (!enabled) return;
            publishVisibility(true);
            scheduleHide();
        },
        dispose() {
            enabled = false;
            cancelPendingHide();
        },
        isVisible: () => visible,
    };
}
