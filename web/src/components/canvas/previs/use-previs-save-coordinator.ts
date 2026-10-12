import { useCallback, useEffect, useRef, useState } from "react";

import { createPrevisSaveCoordinator, type PrevisCloseDecision, type PrevisSaveCoordinator } from "@/lib/canvas/previs/previs-save";
import { idlePrevisSaveProgress, previsSaveProgress, type PrevisSaveProgress } from "@/lib/canvas/previs/previs-save-wiring";
import { recordPrevisDiagnostic } from "@/lib/canvas/previs/previs-diagnostics-recorder";
import type { PrevisScene } from "@/types/previs";

export type PrevisSaveController = {
    progress: PrevisSaveProgress;
    commitScene: (scene: PrevisScene) => void;
    retrySave: () => Promise<boolean>;
    prepareClose: () => Promise<PrevisCloseDecision>;
    handlePageHide: () => Promise<boolean>;
};

export function usePrevisSaveCoordinator(input: { sceneId: string | null; initialScene: PrevisScene | null; persistScene: (scene: PrevisScene) => void; flushPersistence: () => void | Promise<void> }): PrevisSaveController {
    const { sceneId, initialScene, persistScene, flushPersistence } = input;
    const coordinatorRef = useRef<PrevisSaveCoordinator | null>(null);
    const persistSceneRef = useRef(persistScene);
    const flushPersistenceRef = useRef(flushPersistence);
    const initialSceneRef = useRef(initialScene);
    const [progress, setProgress] = useState<PrevisSaveProgress>(idlePrevisSaveProgress);

    useEffect(() => {
        persistSceneRef.current = persistScene;
        flushPersistenceRef.current = flushPersistence;
        initialSceneRef.current = initialScene;
    });

    useEffect(() => {
        const base = initialSceneRef.current;
        if (!sceneId || !base || base.id !== sceneId) {
            coordinatorRef.current = null;
            return;
        }

        let active = true;
        const coordinator = createPrevisSaveCoordinator({
            initialScene: base,
            flush: async (request) => {
                try {
                    persistSceneRef.current(request.scene);
                    await flushPersistenceRef.current();
                } catch (error) {
                    recordPrevisDiagnostic("PREVIS_SAVE_FLUSH_FAILED", { sceneId: request.scene.id, revision: request.revision });
                    throw error;
                }
            },
        });

        coordinatorRef.current = coordinator;
        setProgress(previsSaveProgress(coordinator.getSnapshot()));
        const unsubscribe = coordinator.onStatusChange(() => {
            if (active) setProgress(previsSaveProgress(coordinator.getSnapshot()));
        });

        return () => {
            active = false;
            unsubscribe();
            coordinatorRef.current = null;
            const pending = coordinator.getSnapshot();
            if (pending.confirmedRevision < pending.revision) {
                void coordinator
                    .flushLatest()
                    .catch(() => undefined)
                    .finally(() => coordinator.dispose());
                return;
            }
            coordinator.dispose();
        };
    }, [sceneId]);

    const syncProgress = useCallback(() => {
        const coordinator = coordinatorRef.current;
        if (coordinator) setProgress(previsSaveProgress(coordinator.getSnapshot()));
    }, []);

    const commitScene = useCallback(
        (scene: PrevisScene) => {
            if (!coordinatorRef.current?.edit(scene)) return;
            syncProgress();
        },
        [syncProgress],
    );

    const retrySave = useCallback(async () => {
        const coordinator = coordinatorRef.current;
        if (!coordinator) return false;
        const success = await coordinator.flushLatest();
        syncProgress();
        return success;
    }, [syncProgress]);

    const prepareClose = useCallback(async () => {
        const coordinator = coordinatorRef.current;
        if (!coordinator) return "close" as PrevisCloseDecision;
        const decision = await coordinator.prepareClose();
        syncProgress();
        return decision;
    }, [syncProgress]);

    const handlePageHide = useCallback(async () => {
        const coordinator = coordinatorRef.current;
        try {
            if (!coordinator) {
                await flushPersistenceRef.current();
                return false;
            }
            const pending = coordinator.getSnapshot();
            if (pending.confirmedRevision === pending.revision) {
                await flushPersistenceRef.current();
                return true;
            }
            return await coordinator.handlePageHide();
        } catch {
            return false;
        } finally {
            syncProgress();
        }
    }, [syncProgress]);

    return { progress, commitScene, retrySave, prepareClose, handlePageHide };
}
