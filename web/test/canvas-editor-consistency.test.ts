import { describe, expect, test } from "bun:test";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { commitCanvasGenerationResult } from "@/lib/canvas/canvas-generation-result";
import { selectCanvasVisibleNodes } from "@/lib/canvas/canvas-node-visibility";
import { buildCanvasSpatialIndex, canvasNodeBounds } from "@/lib/canvas/canvas-spatial-index";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { markCanvasTaskRecoveryUnconfirmed, resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";

const image = (id: string, x = 0): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x, y: 0 }, width: 20, height: 20, metadata: { taskId: `task-${id}`, status: "loading" } });

describe("canvas synchronous editor state", () => {
    test("commands see previous commands without waiting for React, and execute once", () => {
        const ref = { current: [] as string[] };
        const snapshots: string[][] = [];
        const write = createCanvasStateWriter(ref, (value) => snapshots.push(value));
        let calls = 0;
        write((current) => {
            calls++;
            return [...current, "first"];
        });
        write((current) => {
            calls++;
            return [...current, "second"];
        });
        expect(calls).toBe(2);
        expect(ref.current).toEqual(["first", "second"]);
        expect(snapshots).toEqual([["first"], ["first", "second"]]);
    });

    test("explicit ref writes must still publish to React", () => {
        const ref = { current: [] as string[] };
        const snapshots: string[][] = [];
        const write = createCanvasStateWriter(ref, (value) => snapshots.push(value));
        ref.current = ["restored"];
        write(ref.current);
        expect(snapshots).toEqual([["restored"]]);
    });
});

describe("canvas generation node commits", () => {
    test("task lookup errors preserve unknown state and cannot undo success or a new binding", () => {
        const pending = image("a");
        expect(markCanvasTaskRecoveryUnconfirmed(pending, "task-a", "network unavailable").metadata).toMatchObject({ status: "loading", taskId: "task-a", errorDetails: "network unavailable" });
        expect(markCanvasTaskRecoveryUnconfirmed(pending, "old-task", "missing")).toBe(pending);
        const success: CanvasNodeData = { ...pending, metadata: { ...pending.metadata, status: "success", storageKey: "resource:a" } };
        expect(markCanvasTaskRecoveryUnconfirmed(success, "task-a", "missing")).toBe(success);
        expect(resetGenerationTaskMetadata({ ...success.metadata, taskStatus: "failed" }, "loading")).toMatchObject({ storageKey: "resource:a", status: "loading" });
        expect(resetGenerationTaskMetadata(success.metadata).taskId).toBeUndefined();
    });
    test("five concurrent results preserve two successes, three failures, and unrelated edits", async () => {
        const before = Array.from({ length: 5 }, (_, i) => image(String(i)));
        const ref = { current: [...before, image("new")] };
        const write = createCanvasStateWriter(ref, () => {});
        await Promise.all(
            before.map(async (node, i) => {
                await Promise.resolve();
                const result: CanvasNodeData = { ...node, metadata: { ...node.metadata, status: i < 2 ? "success" : "error", storageKey: i < 2 ? `resource:${i}` : undefined } };
                write((current) => commitCanvasGenerationResult(current, node, result, `task-${i}`));
            }),
        );
        expect(ref.current.filter((node) => node.metadata?.status === "success")).toHaveLength(2);
        expect(ref.current.filter((node) => node.metadata?.status === "error")).toHaveLength(3);
        expect(ref.current.at(-1)?.id).toBe("new");
    });

    test("keeps movement, manual resize, rename and other node deletion during materialization", () => {
        const before = image("a");
        const live = { ...before, title: "renamed", position: { x: 300, y: 400 }, width: 600 };
        const result: CanvasNodeData = { ...before, width: 100, title: "generated", metadata: { ...before.metadata, status: "success", storageKey: "resource:a" } };
        const committed = commitCanvasGenerationResult([live], before, result, "task-a");
        expect(committed).toHaveLength(1);
        expect(committed[0]).toMatchObject({ title: "renamed", position: live.position, width: 600, metadata: { storageKey: "resource:a" } });
    });

    test("does not resurrect deleted nodes or overwrite a reset/new task", () => {
        const before = image("a");
        expect(() => commitCanvasGenerationResult([], before, before, "task-a")).toThrow();
        expect(() => commitCanvasGenerationResult([{ ...before, metadata: { taskId: "new" } }], before, before, "task-a")).toThrow();
        expect(() => commitCanvasGenerationResult([{ ...before, metadata: {} }], before, before, "task-a")).toThrow();
    });
});

describe("canvas viewport selection", () => {
    test("hidden and overscan nodes cannot consume the viewport budget", () => {
        const nodes = [...Array.from({ length: 400 }, (_, i) => image(`hidden-${i}`)), ...Array.from({ length: 400 }, (_, i) => image(`buffer-${i}`, -100)), ...Array.from({ length: 1000 }, (_, i) => image(`visible-${i}`)), image("forced", 2000)];
        const index = buildCanvasSpatialIndex(nodes.map((node) => ({ id: node.id, value: node.id, bounds: canvasNodeBounds(node) })));
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const view = { left: 0, top: 0, right: 100, bottom: 100 };
        const retain = { ...view, left: -200, right: 200 };
        const selected = selectCanvasVisibleNodes({
            index,
            nodeById,
            view,
            enter: retain,
            retain,
            hiddenIds: new Set(nodes.filter((node) => node.id.startsWith("hidden")).map((node) => node.id)),
            retainedIds: new Set(),
            forcedIds: new Set(["forced"]),
            budget: 280,
        });
        expect(selected).toHaveLength(1001);
        expect(selected.filter((node) => node.id.startsWith("visible"))).toHaveLength(1000);
        expect(selected.at(-1)?.id).toBe("forced");
        expect(nodes).toHaveLength(1801);
    });
});
