import { scopedStorageKey } from "@/lib/user-scope";
import type { PrevisScene } from "@/types/previs";

export type PrevisSaveStatus = "dirty" | "saving" | "saved" | "error";
export type PrevisCloseDecision = "close" | "offer-draft-exit" | "stay";

export type PrevisDraftEnvelope = {
    schemaVersion: 1;
    sceneId: string;
    baseUpdatedAt: string;
    scene: PrevisScene;
    revision: number;
    savedAt: number;
};

export type PrevisFlushRequest = {
    scene: PrevisScene;
    revision: number;
    baseUpdatedAt: string;
};

export type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};

export type FlushFunction = (request: Readonly<PrevisFlushRequest>) => Promise<void>;

export type ScheduleFunction = (callback: () => void, delay: number) => unknown;

export type CancelScheduleFunction = (handle: unknown) => void;

export type PrevisSaveSnapshot = {
    scene: PrevisScene;
    revision: number;
    confirmedRevision: number;
    status: PrevisSaveStatus;
    draftStored: boolean;
};

export type PrevisSaveCoordinatorOptions = {
    initialScene: PrevisScene;
    scope: string;
    storage: StorageLike;
    flush: FlushFunction;
    now?: () => number;
    debounceMs?: number;
    schedule?: ScheduleFunction;
    cancelSchedule?: CancelScheduleFunction;
};

export interface PrevisSaveCoordinator {
    getSnapshot: () => PrevisSaveSnapshot;
    edit: (scene: PrevisScene) => boolean;
    flushLatest: () => Promise<boolean>;
    retry: () => Promise<boolean>;
    restoreCandidate: () => PrevisDraftEnvelope | null;
    discardDraft: () => boolean;
    explicitRestore: (candidate: unknown) => boolean;
    prepareClose: () => Promise<PrevisCloseDecision>;
    handlePageHide: () => Promise<boolean>;
    onStatusChange: (handler: (status: PrevisSaveStatus) => void) => () => void;
    dispose: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const cloneScene = (scene: PrevisScene): PrevisScene => structuredClone(scene);

const isPrevisScene = (value: unknown, expectedSceneId: string): value is PrevisScene => {
    if (!isRecord(value)) return false;

    return (
        value.id === expectedSceneId &&
        value.version === 1 &&
        typeof value.title === "string" &&
        typeof value.background === "string" &&
        typeof value.environmentIntensity === "number" &&
        Number.isFinite(value.environmentIntensity) &&
        typeof value.gridVisible === "boolean" &&
        Array.isArray(value.objects) &&
        Array.isArray(value.cameras) &&
        Array.isArray(value.lights) &&
        Array.isArray(value.shots) &&
        typeof value.activeShotId === "string" &&
        typeof value.createdAt === "string" &&
        typeof value.updatedAt === "string"
    );
};

const validateDraftEnvelope = (candidate: unknown, expectedSceneId: string): PrevisDraftEnvelope | null => {
    if (!isRecord(candidate)) return null;

    if (
        candidate.schemaVersion !== 1 ||
        candidate.sceneId !== expectedSceneId ||
        typeof candidate.baseUpdatedAt !== "string" ||
        typeof candidate.revision !== "number" ||
        !Number.isSafeInteger(candidate.revision) ||
        candidate.revision < 0 ||
        typeof candidate.savedAt !== "number" ||
        !Number.isFinite(candidate.savedAt) ||
        candidate.savedAt < 0 ||
        !isPrevisScene(candidate.scene, expectedSceneId)
    ) {
        return null;
    }

    return {
        schemaVersion: 1,
        sceneId: expectedSceneId,
        baseUpdatedAt: candidate.baseUpdatedAt,
        scene: cloneScene(candidate.scene),
        revision: candidate.revision,
        savedAt: candidate.savedAt,
    };
};

const parseDraftEnvelope = (raw: string, expectedSceneId: string): PrevisDraftEnvelope | null => {
    try {
        const candidate: unknown = JSON.parse(raw);
        return validateDraftEnvelope(candidate, expectedSceneId);
    } catch {
        return null;
    }
};

export function createPrevisSaveCoordinator(options: PrevisSaveCoordinatorOptions): PrevisSaveCoordinator {
    const { initialScene, scope, storage, flush, now = Date.now, debounceMs = 300 } = options;

    const schedule: ScheduleFunction = options.schedule ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    const cancelSchedule: CancelScheduleFunction = options.cancelSchedule ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));

    const fixedSceneId = initialScene.id;
    const storageKey = scopedStorageKey("previs-scene-draft:" + fixedSceneId, scope);

    let currentScene = cloneScene(initialScene);
    let currentRevision = 0;
    let confirmedRevision = 0;
    let baseUpdatedAt = initialScene.updatedAt;
    let status: PrevisSaveStatus = "saved";
    let localDraft: PrevisDraftEnvelope | null = null;
    let draftStored = false;
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
        scene: cloneScene(currentScene),
        revision: currentRevision,
        confirmedRevision,
        status,
        draftStored,
    });

    const cancelDebounce = () => {
        if (debounceHandle === null) return;
        cancelSchedule(debounceHandle);
        debounceHandle = null;
    };

    const storeCurrentDraft = () => {
        const envelope: PrevisDraftEnvelope = {
            schemaVersion: 1,
            sceneId: fixedSceneId,
            baseUpdatedAt,
            scene: cloneScene(currentScene),
            revision: currentRevision,
            savedAt: now(),
        };

        localDraft = envelope;

        try {
            storage.setItem(storageKey, JSON.stringify(envelope));
            draftStored = true;
            setStatus("dirty");
        } catch {
            draftStored = false;
            setStatus("error");
        }
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
        storeCurrentDraft();
        scheduleFlush();
        return true;
    };

    const clearStoredDraft = (revision: number) => {
        if (localDraft?.revision !== revision) return;

        try {
            storage.removeItem(storageKey);
            localDraft = null;
            draftStored = false;
        } catch {
            draftStored = true;
        }
    };

    const refreshStoredDraftBase = () => {
        if (!localDraft || localDraft.revision <= confirmedRevision) return;

        localDraft = {
            ...localDraft,
            baseUpdatedAt,
        };

        try {
            storage.setItem(storageKey, JSON.stringify(localDraft));
            draftStored = true;
        } catch {
            draftStored = false;
        }
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
                    clearStoredDraft(targetRevision);
                    setStatus("saved");
                    return true;
                }

                refreshStoredDraftBase();
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

    const retry = (): Promise<boolean> => flushLatest();

    const restoreCandidate = (): PrevisDraftEnvelope | null => {
        try {
            const raw = storage.getItem(storageKey);
            if (raw === null) return null;
            return parseDraftEnvelope(raw, fixedSceneId);
        } catch {
            return null;
        }
    };

    /**
     * 显式放弃本地草稿：真正删除该 scoped key，避免同一旧草稿每次重开都提示。
     * 删除失败返回 false，调用方必须告知用户草稿仍在，不能假装已放弃。
     */
    const discardDraft = (): boolean => {
        try {
            storage.removeItem(storageKey);
        } catch {
            return false;
        }

        localDraft = null;
        draftStored = false;
        return true;
    };

    const explicitRestore = (candidate: unknown): boolean => {
        if (disposed) return false;

        const envelope = validateDraftEnvelope(candidate, fixedSceneId);
        if (!envelope || envelope.revision <= currentRevision) return false;

        cancelDebounce();
        currentScene = cloneScene(envelope.scene);
        currentRevision = envelope.revision;
        baseUpdatedAt = envelope.baseUpdatedAt;
        localDraft = envelope;

        try {
            storage.setItem(storageKey, JSON.stringify(envelope));
            draftStored = true;
            setStatus("dirty");
        } catch {
            draftStored = false;
            setStatus("error");
        }

        return true;
    };

    const prepareClose = (): Promise<PrevisCloseDecision> => {
        if (disposed) return Promise.resolve("stay");
        if (confirmedRevision === currentRevision) {
            return Promise.resolve("close");
        }
        if (closePromise) return closePromise;

        const pending = flushLatest().then<PrevisCloseDecision>((success) => {
            if (success) return "close";
            return draftStored ? "offer-draft-exit" : "stay";
        });

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
        return () => {
            subscribers.delete(handler);
        };
    };

    const dispose = () => {
        if (disposed) return;

        disposed = true;
        cancelDebounce();
        subscribers.clear();
        closePromise = null;
        pageHidePromise = null;
    };

    return {
        getSnapshot,
        edit,
        flushLatest,
        retry,
        restoreCandidate,
        discardDraft,
        explicitRestore,
        prepareClose,
        handlePageHide,
        onStatusChange,
        dispose,
    };
}
