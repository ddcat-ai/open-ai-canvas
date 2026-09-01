// 编辑器状态机（ADR-0002）：命令唯一入口 + 有界快照撤销 + 1.5s 防抖保存。
// - dispatch：同步 apply 命令，失败（fail-closed）不改状态、错误进 saveError 供 UI 上报
// - 保存层依赖注入（saveTimeline），M4 前不绑定后端；保存串行化防止旧快照覆盖新状态
// - previewGesture/commitGesture/cancelGesture：拖拽等连续手势期间只改渲染态，
//   松手提交时一次性入历史（手势不逐帧污染撤销栈）

import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { TimelineProject } from "@/types/timeline";
import {
    createEditorHistory,
    pushEditorHistory,
    redoEditorHistory,
    undoEditorHistory,
    type EditorHistory,
} from "@/lib/timeline/editor-history";
import { getEditorCommandRegistry, type EditCommand, type EditorCommandRegistry } from "@/lib/timeline/editor-commands";

export type SaveTimeline = (project: TimelineProject) => Promise<void>;

export const EDITOR_SAVE_DEBOUNCE_MS = 1500;

export type EditorStore = {
    /** 编辑器当前项目；null 表示尚未加载（进入编辑器前由 load 注入）。 */
    project: TimelineProject | null;
    history: EditorHistory | null;
    /** 手势预览进行中（drag/trim 未松手）：期间 dispatch/undo/redo 被拒绝。 */
    inPreview: boolean;
    isDirty: boolean;
    saving: boolean;
    saveError: string | null;
    lastSavedAt: number | null;
    /** 加载/切换项目：重置历史与保存状态（数据由外部传入，不触发保存）。 */
    load: (project: TimelineProject) => void;
    /** 应用一条编辑命令（唯一修改入口）。 */
    dispatch: (cmd: EditCommand) => void;
    undo: () => void;
    redo: () => void;
    /** 手势预览：临时应用命令到渲染态，不入历史。 */
    previewGesture: (cmd: EditCommand) => void;
    /** 提交预览：预览态作为一次历史入栈并触发保存。 */
    commitGesture: () => void;
    /** 取消预览：丢弃预览态，回到手势前状态。 */
    cancelGesture: () => void;
    /** 立即保存（离开编辑器/卸载前调用）。 */
    flushSave: () => Promise<void>;
};

export type EditorStoreOptions = {
    saveTimeline?: SaveTimeline;
    registry?: EditorCommandRegistry;
    debounceMs?: number;
};

export function createEditorStore(options: EditorStoreOptions = {}): UseBoundStore<StoreApi<EditorStore>> {
    const registry = options.registry ?? getEditorCommandRegistry();
    const saveTimeline = options.saveTimeline;
    const debounceMs = options.debounceMs ?? EDITOR_SAVE_DEBOUNCE_MS;

    return create<EditorStore>((set, get) => {
        let saveTimer: ReturnType<typeof setTimeout> | null = null;
        // 保存串行链：避免并行保存导致旧快照后落地覆盖新状态
        let saveChain: Promise<void> = Promise.resolve();

        const setSaveError = (err: unknown) =>
            set({ saveError: err instanceof Error ? err.message : String(err) });

        const performSave = (): Promise<void> => {
            const { project } = get();
            if (!project) return Promise.resolve();
            set({ saving: true });
            const chain = saveChain
                .then(() => saveTimeline!(project))
                .then(
                    () => set({ saving: false, isDirty: false, saveError: null, lastSavedAt: Date.now() }),
                    (err: unknown) => set({ saving: false, saveError: err instanceof Error ? err.message : String(err), isDirty: true }),
                );
            saveChain = chain;
            return chain;
        };

        const scheduleSave = () => {
            if (!saveTimeline) return; // 未注入保存层：保持 dirty，由上层决定持久化时机
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                if (get().isDirty) performSave();
            }, debounceMs);
        };

        return {
            project: null,
            history: null,
            inPreview: false,
            isDirty: false,
            saving: false,
            saveError: null,
            lastSavedAt: null,

            load: (project) => {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }
                set({ project, history: createEditorHistory(project), inPreview: false, isDirty: false, saving: false, saveError: null, lastSavedAt: null });
            },

            dispatch: (cmd) => {
                const { project, history, inPreview } = get();
                if (!project || !history) return;
                if (inPreview) {
                    set({ saveError: "cannot dispatch while a gesture preview is active; commit or cancel first" });
                    return;
                }
                let next: TimelineProject;
                try {
                    next = registry.apply(project, cmd);
                } catch (err) {
                    setSaveError(err);
                    return;
                }
                set({ project: next, history: pushEditorHistory(history, next), isDirty: true, saveError: null });
                scheduleSave();
            },

            undo: () => {
                const { project, history, inPreview } = get();
                if (!project || !history || inPreview) return;
                const next = undoEditorHistory(history);
                if (!next) return;
                set({ project: next.current, history: next, isDirty: true });
                scheduleSave();
            },

            redo: () => {
                const { project, history, inPreview } = get();
                if (!project || !history || inPreview) return;
                const next = redoEditorHistory(history);
                if (!next) return;
                set({ project: next.current, history: next, isDirty: true });
                scheduleSave();
            },

            previewGesture: (cmd) => {
                const { project, history } = get();
                if (!project || !history) return;
                // 手势进行中允许基于当前预览态继续应用（拖拽每帧调用）；
                // 预览始终从手势前历史提交，因此预览期间不触碰历史。
                let next: TimelineProject;
                try {
                    next = registry.apply(project, cmd);
                } catch (err) {
                    setSaveError(err);
                    return;
                }
                set({ project: next, inPreview: true });
            },

            commitGesture: () => {
                const { project, history, inPreview } = get();
                if (!project || !history || !inPreview) return;
                set({ project, history: pushEditorHistory(history, project), inPreview: false, isDirty: true, saveError: null });
                scheduleSave();
            },

            cancelGesture: () => {
                const { history, inPreview } = get();
                if (!history || !inPreview) return;
                set({ project: history.current, history, inPreview: false });
            },

            flushSave: async () => {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }
                if (get().isDirty && saveTimeline) await performSave();
            },
        };
    });
}
