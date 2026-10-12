import type { PrevisScene } from "@/types/previs";

export type PrevisSaveStatus = "dirty" | "saving" | "saved" | "error";
export type PrevisCloseDecision = "close" | "stay";

export type PrevisFlushRequest = {
    scene: PrevisScene;
    revision: number;
    baseUpdatedAt: string;
};

export type FlushFunction = (request: Readonly<PrevisFlushRequest>) => Promise<void>;
export type ScheduleFunction = (callback: () => void, delay: number) => unknown;
export type CancelScheduleFunction = (handle: unknown) => void;

export type PrevisSaveSnapshot = {
    revision: number;
    confirmedRevision: number;
    status: PrevisSaveStatus;
};

export type PrevisSaveCoordinatorOptions = {
    initialScene: PrevisScene;
    flush: FlushFunction;
    debounceMs?: number;
    schedule?: ScheduleFunction;
    cancelSchedule?: CancelScheduleFunction;
};

export interface PrevisSaveCoordinator {
    getSnapshot: () => PrevisSaveSnapshot;
    edit: (scene: PrevisScene) => boolean;
    flushLatest: () => Promise<boolean>;
    prepareClose: () => Promise<PrevisCloseDecision>;
    handlePageHide: () => Promise<boolean>;
    onStatusChange: (handler: (status: PrevisSaveStatus) => void) => () => void;
    dispose: () => void;
}

const cloneScene = (scene: PrevisScene): PrevisScene => structuredClone(scene);

export function createPrevisSaveCoordinator(options: PrevisSaveCoordinatorOptions): PrevisSaveCoordinator {
    const { initialScene, flush, debounceMs = 300 } = options;
    const schedule: ScheduleFunction = options.schedule ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    const cancelSchedule: CancelScheduleFunction = options.cancelSchedule ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));

    const fixedSceneId = initialScene.id;
    let currentScene = cloneScene(initialScene);
    let currentRevision = 0;
    let confirmedRevision = 0;
    let baseUpdatedAt = initialScene.updatedAt;
    let status: PrevisSaveStatus = "saved";
    let debounceHandle: unknown | null = null;
    let inFlightFlush: Promise<boolean> | null = null;
    let closePromise: Promise<PrevisCloseDecision> | null = null;
    let pageHidePromise: Promise<boolean> | null = null;
    let disposed = false;

    const subscribers = new Set<(status: PrevisSaveStatus) => void>();

    const setStatus = (nextStatus: PrevisSaveStatus) => {
        if (disposed || status === nextStatus) return;
        status = nextStatus;
        for (const subscriber of subscribers) {
            try {
                subscriber(nextStatus);
            } catch {
                // A subscriber must not break persistence.
            }
        }
    };

    const getSnapshot = (): PrevisSaveSnapshot => ({
        revision: currentRevision,
        confirmedRevision,
        status,
    });

    const cancelDebounce = () => {
        if (debounceHandle === null) return;
        cancelSchedule(debounceHandle);
        debounceHandle = null;
    };

    const scheduleFlush = () => {
        cancelDebounce();
        debounceHandle = schedule(() => {
            debounceHandle = null;
            void flushLatest();
        }, debounceMs);
    };

    const edit = (scene: PrevisScene): boolean => {
        if (disposed || scene.id !== fixedSceneId) return false;
        currentScene = cloneScene(scene);
        currentRevision += 1;
        setStatus("dirty");
        scheduleFlush();
        return true;
    };

    const runDrain = async (): Promise<boolean> => {
        try {
            while (!disposed && confirmedRevision < currentRevision) {
                const targetRevision = currentRevision;
                const targetScene = cloneScene(currentScene);
                const targetBaseUpdatedAt = baseUpdatedAt;
                setStatus("saving");

                try {
                    await flush({
                        scene: targetScene,
                        revision: targetRevision,
                        baseUpdatedAt: targetBaseUpdatedAt,
                    });
                } catch {
                    if (!disposed) setStatus("error");
                    return false;
                }

                if (disposed) return false;
                confirmedRevision = Math.max(confirmedRevision, targetRevision);
                baseUpdatedAt = targetScene.updatedAt;
                if (confirmedRevision === currentRevision) {
                    setStatus("saved");
                    return true;
                }
            }

            if (disposed) return false;
            setStatus("saved");
            return confirmedRevision === currentRevision;
        } catch {
            if (!disposed) setStatus("error");
            return false;
        }
    };

    function flushLatest(): Promise<boolean> {
        cancelDebounce();
        if (disposed) return Promise.resolve(false);
        if (inFlightFlush) return inFlightFlush;
        if (confirmedRevision === currentRevision) {
            setStatus("saved");
            return Promise.resolve(true);
        }

        const pending = runDrain();
        inFlightFlush = pending;
        void pending.then(
            () => {
                if (inFlightFlush === pending) inFlightFlush = null;
            },
            () => {
                if (inFlightFlush === pending) inFlightFlush = null;
            },
        );
        return pending;
    }

    const prepareClose = (): Promise<PrevisCloseDecision> => {
        if (disposed) return Promise.resolve("stay");
        if (confirmedRevision === currentRevision) return Promise.resolve("close");
        if (closePromise) return closePromise;
        const pending = flushLatest().then<PrevisCloseDecision>((success) => (success ? "close" : "stay"));
        closePromise = pending;
        void pending.then(
            () => {
                if (closePromise === pending) closePromise = null;
            },
            () => {
                if (closePromise === pending) closePromise = null;
            },
        );
        return pending;
    };

    const handlePageHide = (): Promise<boolean> => {
        if (disposed) return Promise.resolve(false);
        if (pageHidePromise) return pageHidePromise;
        const pending = flushLatest();
        pageHidePromise = pending;
        void pending.then(
            () => {
                if (pageHidePromise === pending) pageHidePromise = null;
            },
            () => {
                if (pageHidePromise === pending) pageHidePromise = null;
            },
        );
        return pending;
    };

    const onStatusChange = (handler: (status: PrevisSaveStatus) => void): (() => void) => {
        if (disposed) return () => undefined;
        subscribers.add(handler);
        return () => subscribers.delete(handler);
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelDebounce();
        subscribers.clear();
        closePromise = null;
        pageHidePromise = null;
    };

    return { getSnapshot, edit, flushLatest, prepareClose, handlePageHide, onStatusChange, dispose };
}
