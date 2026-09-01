import { describe, expect, test } from "bun:test";

import { createEditorStore } from "../src/stores/editor/editor-store";
import type { SaveTimeline } from "../src/stores/editor/editor-store";
import type { TimelineProject } from "../src/types/timeline";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeProject(): TimelineProject {
    return {
        version: 2,
        tracks: [
            { id: "video-1", kind: "video", label: "视频 1", order: 0 },
            { id: "subtitle-1", kind: "subtitle", label: "字幕 1", order: 1 },
        ],
        clips: [
            { id: "clip-a", kind: "video", nodeId: "node-a", trackId: "video-1", startMs: 0, durationMs: 5000, sourceStartMs: 0, sourceDurationMs: 10000 },
            { id: "sub-1", kind: "subtitle", nodeId: "node-a", trackId: "subtitle-1", startMs: 500, durationMs: 2000, subtitleEntryIndex: 0, text: "你好" },
        ],
        durationMs: 5000,
    };
}

describe("editor store (command dispatch)", () => {
    test("load initializes project and history without saving", async () => {
        const saves: TimelineProject[] = [];
        const store = createEditorStore({ saveTimeline: async (p) => void saves.push(p) });
        store.getState().load(makeProject());
        expect(store.getState().project?.durationMs).toBe(5000);
        expect(store.getState().isDirty).toBe(false);
        expect(store.getState().history?.undoStack).toHaveLength(0);
        await sleep(10);
        expect(saves).toHaveLength(0);
    });

    test("dispatch applies the command, marks dirty, and debounce-saves the latest state", async () => {
        const saves: TimelineProject[] = [];
        const store = createEditorStore({ saveTimeline: async (p) => void saves.push(p), debounceMs: 0 });
        store.getState().load(makeProject());

        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        expect(store.getState().isDirty).toBe(true);
        expect(store.getState().history?.undoStack).toHaveLength(1);

        await sleep(10);
        expect(saves).toHaveLength(1);
        expect(saves[0].clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        expect(store.getState().isDirty).toBe(false);
        expect(store.getState().saveError).toBeNull();
    });

    test("rejected command keeps state and history, surfaces saveError", async () => {
        const store = createEditorStore({ saveTimeline: async () => undefined, debounceMs: 0 });
        store.getState().load(makeProject());
        const before = store.getState().project;

        store.getState().dispatch({ op: "unknownOp", payload: {} });
        expect(store.getState().project).toBe(before);
        expect(store.getState().history?.undoStack).toHaveLength(0);
        expect(store.getState().saveError).toMatch(/unknown edit command op "unknownOp"/);
        expect(store.getState().isDirty).toBe(false);
    });

    test("undo/redo walk the history and each trigger a save", async () => {
        const saves: TimelineProject[] = [];
        const store = createEditorStore({ saveTimeline: async (p) => void saves.push(p), debounceMs: 0 });
        store.getState().load(makeProject());
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 3000 } });
        await sleep(10);

        store.getState().undo();
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        store.getState().undo();
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(0);
        store.getState().undo(); // 栈底，无操作
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(0);

        store.getState().redo();
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        await sleep(10);
        // 两次 dispatch 合并 1 次保存；undo/undo/redo 同步执行合并 1 次保存
        expect(saves).toHaveLength(2);
        expect(saves.at(-1)?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
    });

    test("multiple dispatches within debounce window collapse into one save", async () => {
        const saves: TimelineProject[] = [];
        const store = createEditorStore({ saveTimeline: async (p) => void saves.push(p), debounceMs: 60 });
        store.getState().load(makeProject());

        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 1000 } });
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 3000 } });
        expect(saves).toHaveLength(0); // 防抖窗口内不保存

        await sleep(120);
        expect(saves).toHaveLength(1);
        expect(saves[0].clips.find((c) => c.id === "clip-a")?.startMs).toBe(3000);

        // 新一轮变更再次触发一次保存
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 4000 } });
        await sleep(120);
        expect(saves).toHaveLength(2);
        expect(saves[1].clips.find((c) => c.id === "clip-a")?.startMs).toBe(4000);
    });

    test("save failure marks saveError and keeps dirty; next successful save clears it", async () => {
        let fail = true;
        const store = createEditorStore({
            saveTimeline: async () => {
                if (fail) throw new Error("backend unreachable");
            },
            debounceMs: 0,
        });
        store.getState().load(makeProject());
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 1000 } });
        await sleep(10);
        expect(store.getState().saveError).toBe("backend unreachable");
        expect(store.getState().isDirty).toBe(true);

        fail = false;
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        await sleep(10);
        expect(store.getState().saveError).toBeNull();
        expect(store.getState().isDirty).toBe(false);
    });

    test("flushSave persists immediately and clears pending debounce", async () => {
        const saves: TimelineProject[] = [];
        const store = createEditorStore({ saveTimeline: async (p) => void saves.push(p), debounceMs: 10_000 });
        store.getState().load(makeProject());
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 1000 } });

        await store.getState().flushSave();
        expect(saves).toHaveLength(1);
        expect(store.getState().isDirty).toBe(false);
        // 防抖 timer 已清：再等也不会有第二次
        await sleep(20);
        expect(saves).toHaveLength(1);
    });

    test("load resets history and dirty state", async () => {
        const store = createEditorStore({ saveTimeline: async () => undefined, debounceMs: 0 });
        store.getState().load(makeProject());
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 1000 } });
        expect(store.getState().history?.undoStack).toHaveLength(1);

        store.getState().load(makeProject());
        expect(store.getState().history?.undoStack).toHaveLength(0);
        expect(store.getState().isDirty).toBe(false);
    });
});

describe("editor store (gesture preview)", () => {
    test("preview applies without history; commit pushes once; cancel restores", async () => {
        const store = createEditorStore({ saveTimeline: async () => undefined, debounceMs: 0 });
        store.getState().load(makeProject());
        const committed = store.getState().project;

        // 预览：连续两次手势调用（模拟拖拽中），不入历史
        store.getState().previewGesture({ op: "moveClip", payload: { id: "clip-a", startMs: 1000 } });
        store.getState().previewGesture({ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } });
        expect(store.getState().inPreview).toBe(true);
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        expect(store.getState().history?.undoStack).toHaveLength(0);

        // 预览期间 dispatch 被拒绝
        store.getState().dispatch({ op: "moveClip", payload: { id: "clip-a", startMs: 5000 } });
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(2000);
        expect(store.getState().saveError).toMatch(/gesture preview/);

        // 提交：一次性入历史，可一次 undo 回到手势前
        store.getState().commitGesture();
        expect(store.getState().inPreview).toBe(false);
        expect(store.getState().history?.undoStack).toHaveLength(1);
        store.getState().undo();
        expect(store.getState().project).toBe(committed);
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(0);
    });

    test("cancel discards preview changes", async () => {
        const store = createEditorStore({ saveTimeline: async () => undefined, debounceMs: 0 });
        store.getState().load(makeProject());
        const committed = store.getState().project;

        store.getState().previewGesture({ op: "moveClip", payload: { id: "clip-a", startMs: 1000 } });
        expect(store.getState().project?.clips.find((c) => c.id === "clip-a")?.startMs).toBe(1000);
        store.getState().cancelGesture();
        expect(store.getState().inPreview).toBe(false);
        expect(store.getState().project).toBe(committed);
        expect(store.getState().history?.undoStack).toHaveLength(0);
    });

    test("rejected preview command does not enter preview", async () => {
        const store = createEditorStore({ saveTimeline: async () => undefined, debounceMs: 0 });
        store.getState().load(makeProject());
        const before = store.getState().project;

        store.getState().previewGesture({ op: "unknownOp", payload: {} });
        expect(store.getState().inPreview).toBe(false);
        expect(store.getState().project).toBe(before);
        expect(store.getState().saveError).toMatch(/unknown edit command op/);
    });
});
