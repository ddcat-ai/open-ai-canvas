// 时间线快照撤销（ADR-0002）：有界 200 层 undo/redo 栈。
// 纯函数式结构，便于 zustand 以 set(createEditorHistory(...)) 直接换新引用。
// 快照依赖命令层不可变更新：历史中保存的是结构共享的全量对象，不做深拷贝。

import type { TimelineProject } from "@/types/timeline";

export const HISTORY_LIMIT = 200;

export type EditorHistory = {
    /** 栈底为最旧，栈顶（末尾）为最近一次历史。 */
    undoStack: TimelineProject[];
    redoStack: TimelineProject[];
    current: TimelineProject;
};

export function createEditorHistory(initial: TimelineProject): EditorHistory {
    return { undoStack: [], redoStack: [], current: initial };
}

/**
 * 提交一次新状态：旧 current 入 undo 栈，清空 redo（新分支），
 * 超过 HISTORY_LIMIT 时丢弃最旧快照。
 */
export function pushEditorHistory(history: EditorHistory, next: TimelineProject): EditorHistory {
    const undoStack = [...history.undoStack, history.current];
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    return { undoStack, redoStack: [], current: next };
}

/** 无可撤销时返回 null（调用方保持当前状态不变）。 */
export function undoEditorHistory(history: EditorHistory): EditorHistory | null {
    const prev = history.undoStack.at(-1);
    if (prev === undefined) return null;
    return {
        undoStack: history.undoStack.slice(0, -1),
        redoStack: [...history.redoStack, history.current],
        current: prev,
    };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory | null {
    const next = history.redoStack.at(-1);
    if (next === undefined) return null;
    return {
        undoStack: [...history.undoStack, history.current],
        redoStack: history.redoStack.slice(0, -1),
        current: next,
    };
}

export function canUndo(history: EditorHistory): boolean {
    return history.undoStack.length > 0;
}

export function canRedo(history: EditorHistory): boolean {
    return history.redoStack.length > 0;
}
