import { describe, expect, test } from "bun:test";

import { canvasNodeMaterialSummary, canvasNodeSearchContext, canvasNodeSearchTimes, searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { normalizeCanvasNodeTimestamps, stampCanvasNodeChanges } from "@/lib/canvas/canvas-node-timestamps";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(id: string, patch: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {},
        ...patch,
    };
}

describe("canvas node timestamps", () => {
    test("legacy nodes receive the project timestamp baseline", () => {
        const normalized = normalizeCanvasNodeTimestamps([node("legacy")], {
            createdAt: "2026-08-01T01:00:00.000Z",
            updatedAt: "2026-08-20T02:00:00.000Z",
        });
        expect(normalized[0]?.createdAt).toBe("2026-08-01T01:00:00.000Z");
        expect(normalized[0]?.updatedAt).toBe("2026-08-20T02:00:00.000Z");
    });

    test("new nodes and meaningful edits receive timestamps without touching unchanged nodes", () => {
        const created = stampCanvasNodeChanges([], [node("new")], "2026-08-28T01:00:00.000Z");
        expect(created[0]).toMatchObject({ createdAt: "2026-08-28T01:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z" });

        const unchanged = created[0]!;
        const edited = { ...unchanged, title: "新标题" };
        const updated = stampCanvasNodeChanges(created, [edited], "2026-08-28T02:00:00.000Z");
        expect(updated[0]?.createdAt).toBe("2026-08-28T01:00:00.000Z");
        expect(updated[0]?.updatedAt).toBe("2026-08-28T02:00:00.000Z");
    });

    test("media hydration does not pretend to be a user edit", () => {
        const previous = node("image", {
            createdAt: "2026-08-28T01:00:00.000Z",
            updatedAt: "2026-08-28T01:00:00.000Z",
            metadata: { storageKey: "resource:1", content: "resource:1" },
        });
        const hydrated = { ...previous, metadata: { ...previous.metadata, content: "blob:preview", naturalWidth: 1920, naturalHeight: 1080 } };
        const updated = stampCanvasNodeChanges([previous], [hydrated], "2026-08-28T02:00:00.000Z");
        expect(updated[0]?.updatedAt).toBe("2026-08-28T01:00:00.000Z");
    });
});

describe("canvas node search", () => {
    test("defaults to recently edited order and searches model or tags", () => {
        const older = node("older", { updatedAt: "2026-08-20T01:00:00.000Z", metadata: { model: "wan-video", assetTags: ["夜景"] } });
        const newer = node("newer", { updatedAt: "2026-08-28T01:00:00.000Z", metadata: { model: "seedance" } });
        expect(searchCanvasNodes([older, newer], "").map((item) => item.id)).toEqual(["newer", "older"]);
        expect(searchCanvasNodes([older, newer], "夜景").map((item) => item.id)).toEqual(["older"]);
        expect(searchCanvasNodes([older, newer], "seedance").map((item) => item.id)).toEqual(["newer"]);
    });

    test("summaries expose useful media metadata without leaking data URLs into context", () => {
        const image = node("image", {
            createdAt: "2026-08-28T01:00:00.000Z",
            updatedAt: "2026-08-28T02:00:00.000Z",
            metadata: { content: "data:image/png;base64,AAAA", naturalWidth: 1920, naturalHeight: 1080, bytes: 2 * 1024 * 1024, model: "image-model" },
        });
        expect(canvasNodeMaterialSummary(image)).toContain("1920×1080");
        expect(canvasNodeSearchContext(image)).toBe("图片节点");
        expect(canvasNodeSearchTimes(image)).toMatchObject({ createdAt: image.createdAt, updatedAt: image.updatedAt });
    });
});
