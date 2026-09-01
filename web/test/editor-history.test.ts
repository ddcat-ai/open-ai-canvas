import { describe, expect, test } from "bun:test";

import {
    canRedo,
    canUndo,
    createEditorHistory,
    HISTORY_LIMIT,
    pushEditorHistory,
    redoEditorHistory,
    undoEditorHistory,
} from "../src/lib/timeline/editor-history";
import type { TimelineProject } from "../src/types/timeline";

function project(version: number): TimelineProject {
    return { version, tracks: [], clips: [], durationMs: 0 };
}

describe("editor history", () => {
    test("starts with empty stacks; undo/redo return null", () => {
        const h = createEditorHistory(project(1));
        expect(canUndo(h)).toBe(false);
        expect(canRedo(h)).toBe(false);
        expect(undoEditorHistory(h)).toBeNull();
        expect(redoEditorHistory(h)).toBeNull();
        expect(h.current.version).toBe(1);
    });

    test("undo walks back through pushed snapshots, then null at bottom", () => {
        let h = createEditorHistory(project(1));
        h = pushEditorHistory(h, project(2));
        h = pushEditorHistory(h, project(3));
        expect(canUndo(h)).toBe(true);

        h = undoEditorHistory(h)!;
        expect(h.current.version).toBe(2);
        expect(canRedo(h)).toBe(true);
        h = undoEditorHistory(h)!;
        expect(h.current.version).toBe(1);
        expect(canUndo(h)).toBe(false);
        expect(undoEditorHistory(h)).toBeNull();
    });

    test("redo re-applies undone snapshots, then null at top", () => {
        let h = createEditorHistory(project(1));
        h = pushEditorHistory(h, project(2));
        h = pushEditorHistory(h, project(3));
        h = undoEditorHistory(h)!;
        h = undoEditorHistory(h)!;
        expect(h.current.version).toBe(1);

        h = redoEditorHistory(h)!;
        expect(h.current.version).toBe(2);
        h = redoEditorHistory(h)!;
        expect(h.current.version).toBe(3);
        expect(canRedo(h)).toBe(false);
        expect(redoEditorHistory(h)).toBeNull();
    });

    test("pushing after undo clears the redo branch", () => {
        let h = createEditorHistory(project(1));
        h = pushEditorHistory(h, project(2));
        h = pushEditorHistory(h, project(3));
        h = undoEditorHistory(h)!;
        expect(canRedo(h)).toBe(true);

        h = pushEditorHistory(h, project(99));
        expect(canRedo(h)).toBe(false);
        expect(redoEditorHistory(h)).toBeNull();
        expect(h.current.version).toBe(99);
        expect(h.undoStack.map((s) => s.version)).toEqual([1, 2]);
    });

    test("keeps at most HISTORY_LIMIT snapshots, dropping the oldest", () => {
        let h = createEditorHistory(project(0));
        for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
            h = pushEditorHistory(h, project(i));
        }
        expect(h.undoStack).toHaveLength(HISTORY_LIMIT);
        // 最旧 5 个被丢弃：栈底应为 5，栈顶为 204
        expect(h.undoStack[0].version).toBe(5);
        expect(h.undoStack.at(-1)!.version).toBe(HISTORY_LIMIT + 4);
        expect(h.current.version).toBe(HISTORY_LIMIT + 5);

        // 仍可连续撤销 200 次回到栈底
        let steps = 0;
        while (canUndo(h)) {
            h = undoEditorHistory(h)!;
            steps++;
        }
        expect(steps).toBe(HISTORY_LIMIT);
        expect(h.current.version).toBe(5);
    });

    test("snapshots are structure-shared: push/undo/redo hand the exact object references", () => {
        // 历史不做深拷贝：current 与 undo/redo 栈共享同一对象引用（不可变更新契约由命令层保证）
        const first = project(1);
        let h = createEditorHistory(first);
        const second = project(2);
        h = pushEditorHistory(h, second);
        expect(h.current).toBe(second);
        expect(h.undoStack[0]).toBe(first);

        h = undoEditorHistory(h)!;
        expect(h.current).toBe(first);
        expect(h.redoStack[0]).toBe(second);

        h = redoEditorHistory(h)!;
        expect(h.current).toBe(second);
        expect(h.undoStack[0]).toBe(first);
    });
});
