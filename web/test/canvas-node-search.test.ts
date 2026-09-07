import { describe, expect, test } from "bun:test";

import { canvasNodeMaterialSummary, canvasNodeSearchCategory, canvasNodeSearchContext, canvasNodeSearchTimes, searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { normalizeCanvasNodeTimestamps, stampCanvasNodeChanges, updateCanvasNodes } from "@/lib/canvas/canvas-node-timestamps";
import { registerNodeDefinitions, unregisterNodeDefinitions } from "@/lib/canvas/node-registry";
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

    test("batches media metadata updates while preserving untouched node references", () => {
        const first = node("first");
        const second = node("second");
        const nodes = [first, second];
        const next = updateCanvasNodes(nodes, new Map([
            ["first", (current) => ({ ...current, metadata: { ...current.metadata, naturalWidth: 1920 } })],
            ["second", (current) => ({ ...current, metadata: { ...current.metadata, naturalHeight: 1080 } })],
        ]), "2026-08-28T03:00:00.000Z");
        expect(next).not.toBe(nodes);
        expect(next[0]).not.toBe(first);
        expect(next[1]).not.toBe(second);
        expect(next[0].metadata?.naturalWidth).toBe(1920);
        expect(next[1].metadata?.naturalHeight).toBe(1080);
    });
});

describe("canvas node search", () => {
    test("maps built-in nodes to the seven search categories", () => {
        const cases: Array<[CanvasNodeType, "image" | "video" | "text" | "audio" | "panorama" | "group"]> = [
            [CanvasNodeType.Image, "image"],
            [CanvasNodeType.Drawing, "image"],
            [CanvasNodeType.Compare, "image"],
            [CanvasNodeType.ColorGrade, "image"],
            [CanvasNodeType.Video, "video"],
            [CanvasNodeType.Text, "text"],
            [CanvasNodeType.Markdown, "text"],
            [CanvasNodeType.Script, "text"],
            [CanvasNodeType.Skill, "text"],
            [CanvasNodeType.Svg, "text"],
            [CanvasNodeType.Html, "text"],
            [CanvasNodeType.Chart, "text"],
            [CanvasNodeType.Audio, "audio"],
            [CanvasNodeType.Panorama, "panorama"],
            [CanvasNodeType.Frame, "group"],
        ];

        for (const [type, category] of cases) {
            expect(canvasNodeSearchCategory(node(type, { type }))).toBe(category);
        }
        expect(canvasNodeSearchCategory(node("config", { type: CanvasNodeType.Config }))).toBeNull();
        expect(canvasNodeSearchCategory(node("unknown", { type: "plugin.unknown" as CanvasNodeType }))).toBeNull();
    });

    test("combines keyword and category filtering", () => {
        const image = node("image", { type: CanvasNodeType.Image, title: "夜景图片" });
        const video = node("video", { type: CanvasNodeType.Video, title: "夜景视频" });
        const text = node("text", { type: CanvasNodeType.Text, title: "夜景文案" });
        const audio = node("audio", { type: CanvasNodeType.Audio, title: "白噪音" });

        expect(searchCanvasNodes([image, video, text, audio], "夜景", 80, "image").map((item) => item.id)).toEqual(["image"]);
        expect(searchCanvasNodes([image, video, text, audio], "夜景", 80, "video").map((item) => item.id)).toEqual(["video"]);
        expect(searchCanvasNodes([image, video, text, audio], "夜景", 80, "text").map((item) => item.id)).toEqual(["text"]);
        expect(searchCanvasNodes([image, video, text, audio], "夜景", 80, "audio")).toEqual([]);
    });

    test("keeps config and unknown plugin nodes discoverable in all results", () => {
        const config = node("config", { type: CanvasNodeType.Config, title: "项目配置", updatedAt: "2026-08-28T02:00:00.000Z" });
        const unknown = node("unknown", { type: "plugin.unknown" as CanvasNodeType, title: "未知插件", updatedAt: "2026-08-28T01:00:00.000Z" });

        expect(searchCanvasNodes([config, unknown], "", 80, "all").map((item) => item.id)).toEqual(["config", "unknown"]);
        expect(searchCanvasNodes([config, unknown], "", 80, "image")).toEqual([]);
    });

    test("uses a registered plugin input kind when the node is not built in", () => {
        const pluginType = "plugin.image-input" as CanvasNodeType;
        registerNodeDefinitions([{
            type: pluginType,
            label: "插件图片",
            icon: null,
            defaultTitle: "插件图片",
            defaultSize: { width: 320, height: 180 },
            minSize: { width: 220, height: 160 },
            showInCreateMenu: true,
            inputKind: "image",
        }], "canvas-node-search-test");
        try {
            expect(canvasNodeSearchCategory(node("plugin", { type: pluginType }))).toBe("image");
        } finally {
            unregisterNodeDefinitions("canvas-node-search-test");
        }
    });

    test("search modal exposes compact category controls without time columns", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-node-search-modal.tsx", import.meta.url)).text();
        expect(source).toContain('placeholder="搜索节点..."');
        expect(source).toContain("aria-pressed={category === item.id}");
        expect(source).toContain("canvas-node-search-result-context");
        expect(source).not.toContain("Clock3");
        expect(source).not.toContain("canvasNodeSearchTimes");
    });

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
