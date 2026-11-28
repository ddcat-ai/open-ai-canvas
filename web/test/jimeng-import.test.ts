import { describe, expect, test } from "bun:test";

import { buildJimengCanvasNodes, collectJimengMediaResourceIds, parseJimengProjectId, type StoredJimengMedia } from "../src/lib/canvas/jimeng-import";
import { CanvasNodeType, type CanvasConnection } from "../src/types/canvas";
import type { JimengImportResult } from "../src/services/api/jimeng";

const PROJECT_ID = "8ce884cb-99a5-46d2-b537-cb50d559939d";

function importResult(): JimengImportResult {
    const connections: CanvasConnection[] = [{ id: "jimeng-batch-edge-1", fromNodeId: "jimeng-batch-node-image", toNodeId: "jimeng-batch-node-video" }];
    return {
        batchId: "jimeng-batch",
        batchCreatedAt: "2026-11-28T05:00:00.000Z",
        projectId: PROJECT_ID,
        projectName: "持械入宋",
        nodes: [
            {
                id: "jimeng-batch-node-frame",
                type: "frame",
                title: "片段集合一",
                x: 100,
                y: 200,
                width: 300,
                height: 200,
                metadata: { provider: "jimeng", projectId: PROJECT_ID, nodeId: "node-frame", batchId: "jimeng-batch" },
            },
            {
                id: "jimeng-batch-node-image",
                type: "image",
                title: "陈素新皮肤",
                parentId: "jimeng-batch-node-frame",
                x: 150,
                y: 250,
                width: 100,
                height: 50,
                content: "https://p26-dreamina-sign.byteimg.com/temp.image?x-expires=1900000000",
                previewContent: "https://p26-dreamina-sign.byteimg.com/720.webp?x-expires=1900000000",
                mimeType: "image/png",
                naturalWidth: 2048,
                naturalHeight: 1152,
                status: "success",
                metadata: { provider: "jimeng", projectId: PROJECT_ID, nodeId: "node-image", mediaResourceId: "resource-image", batchId: "jimeng-batch", sourceType: "uploaded", expiresAt: "2030-03-17T17:46:40.000Z" },
            },
            {
                id: "jimeng-batch-node-video",
                type: "video",
                title: "镜头70",
                x: 600,
                y: 200,
                width: 320,
                height: 569,
                content: "https://v26-dreamina-de.jianying.com/abc/6b0a74b4/video/tos/cn/key/",
                previewContent: "https://p9-sign.douyinpic.com/cover.jpeg",
                mimeType: "video/mp4",
                durationMs: 30050,
                status: "success",
                metadata: { provider: "jimeng", projectId: PROJECT_ID, nodeId: "node-video", mediaResourceId: "resource-video", batchId: "jimeng-batch", sourceType: "model_generated" },
            },
            {
                id: "jimeng-batch-node-placeholder",
                type: "image",
                title: "素材已删除",
                x: 1000,
                y: 200,
                width: 320,
                height: 180,
                content: "",
                status: "idle",
                metadata: { provider: "jimeng", projectId: PROJECT_ID, nodeId: "node-placeholder", mediaResourceId: "resource-missing", batchId: "jimeng-batch" },
            },
        ],
        connections,
        importedNodeCount: 4,
        importedConnectionCount: 1,
        skippedNodes: [],
        skippedConnections: [],
        warnings: [],
        multiResultNodeCount: 0,
        placeholderNodeCount: 1,
        frameNodeCount: 1,
        mediaExpiresAt: "2026-11-28T06:56:41.000Z",
    };
}

describe("Jimeng canvas import helpers", () => {
    test("extracts the canvas ID from Jimeng share links", () => {
        expect(parseJimengProjectId(`https://jimeng.jianying.com/ai-tool/ai-canvas/${PROJECT_ID}?enter_from=noew_canvas_shared_link`)).toBe(PROJECT_ID);
        expect(parseJimengProjectId(`https://jimeng.jianying.com/ai-tool/ai-canvas/${PROJECT_ID}/`)).toBe(PROJECT_ID);
        expect(parseJimengProjectId(PROJECT_ID.toUpperCase())).toBe(PROJECT_ID);
        expect(parseJimengProjectId(`  ${PROJECT_ID}  `)).toBe(PROJECT_ID);
    });

    test("rejects other sites, other pages and malformed IDs", () => {
        expect(parseJimengProjectId(`https://dreamina.capcut.com/ai-tool/ai-canvas/${PROJECT_ID}`)).toBe("");
        expect(parseJimengProjectId("https://jimeng.jianying.com/ai-tool/image/generate")).toBe("");
        expect(parseJimengProjectId(`https://jimeng.jianying.com/ai-tool/ai-canvas/${PROJECT_ID}/extra`)).toBe("");
        expect(parseJimengProjectId("not-a-link")).toBe("");
        expect(parseJimengProjectId("")).toBe("");
    });

    test("collects each stored candidate once and skips frames or placeholders", () => {
        expect(collectJimengMediaResourceIds(importResult())).toEqual(["resource-image", "resource-video"]);
    });

    test("maps groups to frames, keeps relative layout and centers the batch in the viewport", () => {
        const [frame, image, video] = buildJimengCanvasNodes(importResult(), { x: 0, y: 0, k: 1 }, { width: 1000, height: 800 });
        expect(frame.type).toBe(CanvasNodeType.Frame);
        expect(frame.metadata.frame).toEqual({ collapsed: false, expandedWidth: 300, expandedHeight: 200 });
        expect(image.type).toBe(CanvasNodeType.Image);
        expect(video.type).toBe(CanvasNodeType.Video);
        // 画布范围是 x 100–1320、y 200–769，居中后整体平移 (-210, -84.5)。
        expect(frame.position).toEqual({ x: -110, y: 115.5 });
        expect(image.position).toEqual({ x: -60, y: 165.5 });
        expect(image.parentId).toBe(frame.id);
        expect(video.parentId).toBeUndefined();
        expect(image.metadata.importSource).toEqual(importResult().nodes[1].metadata);
    });

    test("keeps temporary Jimeng links for media that was not stored", () => {
        const [, image, video] = buildJimengCanvasNodes(importResult(), { x: 0, y: 0, k: 1 }, { width: 1000, height: 800 });
        expect(image.metadata.content).toBe("https://p26-dreamina-sign.byteimg.com/temp.image?x-expires=1900000000");
        expect(image.metadata.previewContent).toBe("https://p26-dreamina-sign.byteimg.com/720.webp?x-expires=1900000000");
        expect(image.metadata.storageKey).toBeUndefined();
        expect(video.metadata.previewContent).toBe("https://p9-sign.douyinpic.com/cover.jpeg");
    });

    test("switches stored media to the hosting canvas resources", () => {
        const stored = new Map<string, StoredJimengMedia>([["resource-video", { url: "/api/resources/res-1/file", storageKey: "resource:res-1", width: 720, height: 1280, durationMs: 30050, mimeType: "video/mp4", bytes: 49050143 }]]);
        const [, image, video] = buildJimengCanvasNodes(importResult(), { x: 0, y: 0, k: 1 }, { width: 1000, height: 800 }, stored);
        expect(video.metadata).toMatchObject({ content: "/api/resources/res-1/file", storageKey: "resource:res-1", naturalWidth: 720, naturalHeight: 1280, durationMs: 30050, mimeType: "video/mp4", bytes: 49050143 });
        // 临时封面会过期，转存后交给影策自己的缩略图。
        expect(video.metadata.previewContent).toBeUndefined();
        expect(video.metadata.importSource?.provider).toBe("jimeng");
        expect(image.metadata.content).toBe("https://p26-dreamina-sign.byteimg.com/temp.image?x-expires=1900000000");
    });
});
