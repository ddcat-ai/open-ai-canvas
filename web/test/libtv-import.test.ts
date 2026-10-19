import { describe, expect, test } from "bun:test";

import { buildLibTVCanvasNodes, buildLibTVImagePreviewUrl, buildLibTVVideoPreviewUrl, buildLibTVVideoSourceUrl, formatLibTVBatchTime, parseLibTVProjectUUID, summarizeLibTVImportWarnings } from "../src/lib/canvas/libtv-import";
import type { LibTVImportNode, LibTVImportResult } from "../src/services/api/libtv";
import { CanvasNodeType } from "../src/types/canvas";
import { canvasPersistentNodes } from "../src/lib/canvas/canvas-persistent-nodes";

describe("LibTV canvas import helpers", () => {
    test("summarizes a hundred matching issues once without dropping other warnings", () => {
        const message = "连接标识无效、重复或端点未导入";
        const warnings = [
            { id: "node-1", message: "节点包含 2 个结果，已导入第 1 个" },
            ...Array.from({ length: 100 }, (_, index) => ({ id: `edge-${index}`, message })),
            { id: "node-2", message: "部分提示词引用缺少公开参考节点，已保留原始标记" },
        ];
        const original = structuredClone(warnings);
        expect(summarizeLibTVImportWarnings(warnings)).toEqual([
            { message: "节点包含 2 个结果，将保留第 1 个", count: 1 },
            { message, count: 100 },
            { message: "部分提示词引用缺少公开参考节点，已保留原始标记", count: 1 },
        ]);
        expect(warnings).toEqual(original);
    });

    test("ignores empty warnings and groups whitespace variants", () => {
        expect(summarizeLibTVImportWarnings([])).toEqual([]);
        expect(summarizeLibTVImportWarnings([{ message: " " }, { message: "提示" }, { message: " 提示 " }])).toEqual([{ message: "提示", count: 2 }]);
    });

    test("extracts projectId from LibTV share links", () => {
        expect(parseLibTVProjectUUID("https://www.liblib.tv/canvas/share?spaceId=5858202&projectId=dda7684b670b4e57b6027f1334fe6056")).toBe("dda7684b670b4e57b6027f1334fe6056");
    });

    test("accepts direct UUIDs and rejects unrelated links", () => {
        expect(parseLibTVProjectUUID("292A69D540774A9AB9872D8337C9FD0B")).toBe("292a69d540774a9ab9872d8337c9fd0b");
        expect(parseLibTVProjectUUID("https://api.liblib.tv/api/canvas/project/detail?uuid=292a69d540774a9ab9872d8337c9fd0b")).toBe("292a69d540774a9ab9872d8337c9fd0b");
        expect(parseLibTVProjectUUID("https://example.com/not-a-canvas")).toBe("");
    });

    test("formats the readable batch label to local yyyyMMddHHmm", () => {
        const localTime = new Date(2026, 7, 19, 5, 2);
        expect(formatLibTVBatchTime(localTime.toISOString())).toBe("202608190502");
    });

    test("uses a LibTV CDN thumbnail without changing the original media contract", () => {
        const original = "https://libtv-res.liblib.art/path/example.png";
        expect(buildLibTVImagePreviewUrl(original)).toBe("https://libtv-res.liblib.art/path/example.png?x-oss-process=image%2Fresize%2Cw_960");
        expect(buildLibTVImagePreviewUrl("https://example.com/path/example.png")).toBe("https://example.com/path/example.png");
    });

    test("builds a 400px OSS snapshot for LibTV videos only", () => {
        const original = "https://libtv-res.liblib.art/path/example.mp4";
        expect(buildLibTVVideoPreviewUrl(original)).toBe("https://libtv-res.liblib.art/path/example.mp4?x-oss-process=video%2Fsnapshot%2Ct_0%2Cf_jpg%2Cw_400%2Cm_fast%2Car_auto");
        expect(buildLibTVVideoPreviewUrl("https://example.com/path/example.mp4")).toBe("");
        expect(buildLibTVVideoPreviewUrl("not-a-url")).toBe("");
    });

    test("removes a persisted OSS snapshot transform before video playback", () => {
        const snapshot = "https://libtv-res.liblib.art/path/example.mp4?x-oss-process=video%2Fsnapshot%2Ct_0%2Cf_jpg%2Cw_400";
        expect(buildLibTVVideoSourceUrl(snapshot)).toBe("https://libtv-res.liblib.art/path/example.mp4");
        expect(buildLibTVVideoSourceUrl("https://example.com/path/example.mp4?x-oss-process=video%2Fsnapshot")).toBe("https://example.com/path/example.mp4?x-oss-process=video%2Fsnapshot");
    });
});

// 字段与 backend/internal/auth/libtv.go 的 LibTVCanvasNode / LibTVImportMetadata JSON tag 对应；模板节点 x/y 已由后端绝对化。
const TEMPLATE_UUID = "c".repeat(32);
function importNode(id: string, type: LibTVImportNode["type"], x: number, y: number, overrides: Partial<LibTVImportNode> = {}): LibTVImportNode {
    return {
        id,
        type,
        title: id,
        x,
        y,
        width: 100,
        height: 100,
        content: "",
        metadata: { provider: "libtv", projectUuid: "d".repeat(32), templateUuid: TEMPLATE_UUID, snapshotId: 4242, nodeKey: `key-${id}`, batchId: "batch-1", sourceType: type },
        ...overrides,
    };
}

function templateResult(): LibTVImportResult {
    const nodes = [
        importNode("frame", "frame", 1000, 2000, { width: 600, height: 400 }),
        importNode("image", "image", 1040, 2060, { parentId: "frame", content: "https://libtv-res.liblib.art/fixture/a.png", prompt: "主图", model: "libtv-img", aspectRatio: "16:9", naturalWidth: 1920, naturalHeight: 1080, mimeType: "image/png", status: "success" }),
        importNode("video", "video", 1300, 2060, { parentId: "frame", content: "https://libtv-res.liblib.art/fixture/v.mp4?x-oss-process=video%2Fsnapshot%2Ct_0", durationMs: 5000, mimeType: "video/mp4" }),
        importNode("audio", "audio", 1700, 2000, { content: "https://libtv-res.liblib.art/fixture/a.mp3", durationMs: 3000, mimeType: "audio/mpeg" }),
        importNode("text", "text", 1700, 2300, { content: "" }),
    ];
    return {
        batchId: "batch-1",
        batchCreatedAt: "2026-09-01T00:00:00Z",
        projectUuid: "d".repeat(32),
        projectName: "公开模板",
        nodes,
        connections: [
            { id: "c1", fromNodeId: "image", toNodeId: "video" },
            { id: "c2", fromNodeId: "text", toNodeId: "image" },
        ],
        importedNodeCount: nodes.length,
        importedConnectionCount: 2,
        skippedNodes: [],
        skippedConnections: [],
        warnings: [],
        multiResultNodeCount: 0,
        staleNodeCount: 0,
        reusedFailedNodeCount: 0,
        placeholderNodeCount: 0,
        convertedSpecialCount: 3,
    };
}

describe("LibTV template node mapping", () => {
    const viewport = { x: 0, y: 0, k: 1 };
    const viewportSize = { width: 800, height: 600 };

    test("maps frame/image/video/audio/text to canvas node types", () => {
        const nodes = buildLibTVCanvasNodes(templateResult().nodes, viewport, viewportSize);
        expect(nodes.map((node) => [node.id, node.type])).toEqual([
            ["frame", CanvasNodeType.Frame],
            ["image", CanvasNodeType.Image],
            ["video", CanvasNodeType.Video],
            ["audio", CanvasNodeType.Audio],
            ["text", CanvasNodeType.Text],
        ]);
        const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
        expect(byId.frame.metadata?.frame).toEqual({ collapsed: false, expandedWidth: 600, expandedHeight: 400 });
        expect(byId.text.metadata?.content).toBe("");
        expect(byId.audio.metadata).toMatchObject({ content: "https://libtv-res.liblib.art/fixture/a.mp3", durationMs: 3000, mimeType: "audio/mpeg" });
        expect(byId.video.metadata?.content).toBe("https://libtv-res.liblib.art/fixture/v.mp4");
        expect(byId.video.metadata?.previewContent).toContain("x-oss-process=");
        expect(byId.image.metadata).toMatchObject({ content: "https://libtv-res.liblib.art/fixture/a.png", size: "16:9", naturalWidth: 1920, prompt: "主图", model: "libtv-img", status: "success" });
        expect(byId.audio.metadata?.status).toBe("idle");
    });

    test("centers the whole template once and keeps child coordinates absolute", () => {
        const source = templateResult().nodes;
        const nodes = buildLibTVCanvasNodes(source, { x: 100, y: -50, k: 2 }, viewportSize);
        // 包围盒 [1000, 2000] – [1800, 2400]，中心 (1400, 2200)；视口中心世界坐标 ((400-100)/2, (300+50)/2) = (150, 175)。
        const offset = { x: 150 - 1400, y: 175 - 2200 };
        nodes.forEach((node, index) => {
            expect(node.position).toEqual({ x: source[index].x + offset.x, y: source[index].y + offset.y });
        });
        const frame = nodes.find((node) => node.id === "frame")!;
        const child = nodes.find((node) => node.id === "image")!;
        expect(child.parentId).toBe("frame");
        // 子节点相对画框的距离与原模板一致，说明父级偏移没有被二次叠加。
        expect({ x: child.position.x - frame.position.x, y: child.position.y - frame.position.y }).toEqual({ x: 40, y: 60 });
        expect(child.position.x).toBeGreaterThan(frame.position.x);
        expect(child.position.x + child.width).toBeLessThanOrEqual(frame.position.x + frame.width);
    });

    test("keeps node ids, import source metadata and connections intact", () => {
        const result = templateResult();
        const nodes = buildLibTVCanvasNodes(result.nodes, viewport, viewportSize);
        const ids = new Set(nodes.map((node) => node.id));
        expect(result.connections.every((connection) => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId))).toBe(true);
        nodes.forEach((node, index) => {
            expect(node.metadata?.importSource).toEqual(result.nodes[index].metadata);
        });
        expect(nodes[1].metadata?.importSource).toMatchObject({ provider: "libtv", templateUuid: TEMPLATE_UUID, snapshotId: 4242, nodeKey: "key-image" });
    });

    test("returns no nodes for an empty import instead of NaN positions", () => {
        expect(buildLibTVCanvasNodes([], viewport, viewportSize)).toEqual([]);
    });

    test.each(["image", "video", "audio"] as const)("keeps all %s results as durable cards with the original node identity", (type) => {
        const suffix = type === "image" ? "png" : type === "video" ? "mp4" : "mp3";
        const source = importNode("original", type, 10, 20, {
            parentId: "frame",
            prompt: "参考@[node:reference]的公开提示词",
            model: "source-model",
            aspectRatio: "16:9",
            status: "success",
            results: Array.from({ length: 4 }, (_, index) => ({ sourceIndex: index + 1, content: `https://libtv-res.liblib.art/result-${index + 1}.${suffix}`, naturalWidth: 100 * (index + 1), naturalHeight: 50 * (index + 1), durationMs: 1000 * (index + 1) })),
        });
        const original = structuredClone(source);
        const nodes = buildLibTVCanvasNodes([source], viewport, viewportSize);
        const saved = JSON.parse(JSON.stringify(canvasPersistentNodes(nodes))) as typeof nodes;
        const root = saved[0];
        const cards = type === "image" ? saved.slice(1) : saved;
        expect(saved).toHaveLength(type === "image" ? 5 : 4);
        expect(cards).toHaveLength(4);
        expect(new Set(saved.map((node) => node.id)).size).toBe(saved.length);
        expect(root.id).toBe(source.id);
        expect(root.position).toEqual({ x: 350, y: 250 });
        if (type === "image") expect(root.metadata).toMatchObject({ isBatchRoot: true, imageBatchExpanded: false, primaryImageId: cards[0].id });
        else expect(root.metadata?.isBatchRoot).toBeUndefined();
        cards.forEach((card, index) => {
            expect(card.parentId).toBe("frame");
            expect(card.metadata).toMatchObject({ content: source.results![index].content, prompt: source.prompt, model: source.model, size: "16:9", status: "success", importSource: source.metadata });
            if (type === "image") expect(card.metadata?.batchRootId).toBe(root.id);
            else expect(card.metadata?.batchRootId).toBeUndefined();
            if (type !== "audio") expect(card.metadata).toMatchObject({ naturalWidth: 100 * (index + 1), naturalHeight: 50 * (index + 1) });
            if (type === "image") expect(card.metadata?.previewContent).toContain("image%2Fresize");
            if (type === "video") expect(card.metadata?.previewContent).toContain("video%2Fsnapshot");
            if (type !== "image") expect(card.metadata?.durationMs).toBe(1000 * (index + 1));
        });
        expect(cards[3].metadata?.content).toBe(source.results![3].content);
        expect(source).toEqual(original);
    });

    test("does not create a deck for one result and separates cards across import batches", () => {
        const result = { sourceIndex: 0, content: "https://libtv-res.liblib.art/a.png" };
        const source = importNode("source", "image", 0, 0, { results: [result] });
        const single = buildLibTVCanvasNodes([source], viewport, viewportSize);
        expect(single).toHaveLength(1);
        expect(single[0].metadata?.isBatchRoot).toBeUndefined();
        source.results = [result, { ...result, sourceIndex: 1, content: "https://libtv-res.liblib.art/b.png" }];
        const first = buildLibTVCanvasNodes([source], viewport, viewportSize);
        const second = buildLibTVCanvasNodes([{ ...source, id: "new-source", metadata: { ...source.metadata, batchId: "batch-2" } }], viewport, viewportSize);
        expect(first.slice(1).every((card) => second.every((other) => other.id !== card.id))).toBe(true);
    });
});
