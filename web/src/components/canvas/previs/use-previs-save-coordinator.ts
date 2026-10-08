import { useCallback, useEffect, useRef, useState } from "react";

import { createPrevisSaveCoordinator, type PrevisCloseDecision, type PrevisDraftEnvelope, type PrevisSaveCoordinator } from "@/lib/canvas/previs/previs-save";
import { previsSaveProgress, idlePrevisSaveProgress, resolvePrevisDraftStorage, type PrevisSaveProgress } from "@/lib/canvas/previs/previs-save-wiring";
import { recordPrevisDiagnostic } from "@/lib/canvas/previs/previs-diagnostics-recorder";
import { useUserStore } from "@/stores/use-user-store";
import type { PrevisScene } from "@/types/previs";

export type PrevisSaveController = {
    progress: PrevisSaveProgress;
    /** canonical 提交入口：预览态与「仅镜像」路径都不得调用。 */
    commitScene: (scene: PrevisScene) => void;
    retry: () => Promise<boolean>;
    restoreCandidate: () => PrevisDraftEnvelope | null;
    restoreDraft: (candidate: PrevisDraftEnvelope) => boolean;
    discardDraft: () => boolean;
    prepareClose: () => Promise<PrevisCloseDecision>;
    handlePageHide: () => Promise<boolean>;
};

/**
 * 按 scene.id 持有唯一 coordinator：切换场景或卸载时 dispose。
 * persistScene 必须把 request.scene 落到项目状态，flushPersistence 负责真正落盘。
 */
export function usePrevisSaveCoordinator(input: { sceneId: string | null; initialScene: PrevisScene | null; persistScene: (scene: PrevisScene) => void; flushPersistence: () => void | Promise<void> }): PrevisSaveController {
    const { sceneId, initialScene, persistScene, flushPersistence } = input;

    const coordinatorRef = useRef<PrevisSaveCoordinator | null>(null);
    const persistSceneRef = useRef(persistScene);
    const flushPersistenceRef = useRef(flushPersistence);
    const initialSceneRef = useRef(initialScene);
    const [progress, setProgress] = useState<PrevisSaveProgress>(idlePrevisSaveProgress);

    // scope 取响应式 user id：user-session 先切 active scope 再 setUser，
    // 因此这里能在用户变化时重建 coordinator，且不会在播放时每帧读 localStorage。
    const scope = useUserStore((state) => state.user?.id) ?? "guest";

    // 依赖为空的 effect 每次 render 后都跑，保证 coordinator effect 读到的是最新回调。
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
            scope,
            storage: resolvePrevisDraftStorage(() => globalThis.localStorage),
            flush: async (request) => {
                try {
                    // 先把这次 flush 对应的场景写进项目状态，再等持久化真正完成。
                    persistSceneRef.current(request.scene);
                    await flushPersistenceRef.current();
                } catch (error) {
                    // 只记录稳定码与安全字段；原始 error 继续上抛给 coordinator 走 error/draft 语义。
                    recordPrevisDiagnostic("PREVIS_SAVE_FLUSH_FAILED", { sceneId: request.scene.id, revision: request.revision });
                    throw error;
                }
            },
        });

        coordinatorRef.current = coordinator;
        setProgress(previsSaveProgress(coordinator.getSnapshot()));

        // 通知里必须读完整快照：只搬 status 会让 confirmedRevision/draftStored 停在旧值，
        // UI 继续显示未保存、beforeunload 也会误拦。
        const unsubscribe = coordinator.onStatusChange(() => {
            if (!active) return;
            setProgress(previsSaveProgress(coordinator.getSnapshot()));
        });

        return () => {
            active = false;
            unsubscribe();
            coordinatorRef.current = null;

            // 卸载前把未确认改动推完再 dispose，否则 debounce 里的最后一次编辑只剩本地草稿。
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
    }, [sceneId, scope]);

    /** dispose 后 coordinatorRef 为 null，因此卸载期的调用不会再 setState。 */
    const syncProgress = useCallback(() => {
        const coordinator = coordinatorRef.current;
        if (coordinator) setProgress(previsSaveProgress(coordinator.getSnapshot()));
    }, []);

    /** canonical 提交唯一入口：预览态和「仅镜像当前 draft」都不得调用。 */
    const commitScene = useCallback(
        (scene: PrevisScene) => {
            if (!coordinatorRef.current?.edit(scene)) return;
            syncProgress();
        },
        [syncProgress],
    );

    const retry = useCallback(async () => {
        const coordinator = coordinatorRef.current;
        if (!coordinator) return false;
        const result = await coordinator.retry();
        syncProgress();
        return result;
    }, [syncProgress]);

    const restoreCandidate = useCallback(() => coordinatorRef.current?.restoreCandidate() ?? null, []);

    const restoreDraft = useCallback(
        (candidate: PrevisDraftEnvelope) => {
            const coordinator = coordinatorRef.current;
            if (!coordinator?.explicitRestore(candidate)) return false;
            // 恢复后必须回到项目状态并触发可靠保存，否则草稿只活在本地。
            persistSceneRef.current(candidate.scene);
            void coordinator.flushLatest().finally(syncProgress);
            syncProgress();
            return true;
        },
        [syncProgress],
    );

    const discardDraft = useCallback(() => {
        const discarded = coordinatorRef.current?.discardDraft() ?? false;
        syncProgress();
        return discarded;
    }, [syncProgress]);

    const prepareClose = useCallback(async () => {
        const coordinator = coordinatorRef.current;
        if (!coordinator) return "close" as PrevisCloseDecision;
        const decision = await coordinator.prepareClose();
        syncProgress();
        return decision;
    }, [syncProgress]);

    /**
     * pagehide：dirty 时只能走 coordinator.handlePageHide —— 它的 flush 已经
     * persist(request.scene) + await flushPersistence，组件再叠一次就是重复落盘。
     * clean 时 coordinator 不会 flush，因此这里显式落盘，保留原有「离开页面必落盘」语义。
     */
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

    return {
        progress,
        commitScene,
        retry,
        restoreCandidate,
        restoreDraft,
        discardDraft,
        prepareClose,
        handlePageHide,
    };
}
