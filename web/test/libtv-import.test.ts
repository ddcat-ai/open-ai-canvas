import { describe, expect, test } from "bun:test";

import { buildLibTVCanvasNodes, buildLibTVImagePreviewUrl, buildLibTVVideoPreviewUrl, buildLibTVVideoSourceUrl, formatLibTVBatchTime, parseLibTVProjectUUID } from "../src/lib/canvas/libtv-import";
import { isCanvasImageSourceNode } from "../src/lib/canvas/canvas-image-source";
import { nodeGenerationPrompt } from "../src/lib/canvas/generation-contract";
import type { LibTVImportNode } from "../src/services/api/libtv";

function importNode(patch: Partial<LibTVImportNode> = {}): LibTVImportNode {
    return {
        id: "libtv-batch-image",
        type: "image",
        title: "Imported image",
        x: 20,
        y: 30,
        width: 480,
        height: 300,
        content: "https://libtv-res.liblib.art/image.png",
        prompt: "Original generation prompt",
        model: "source-model",
        status: "success",
        metadata: { provider: "libtv", projectUuid: "project", nodeKey: "image", batchId: "batch", sourceType: "image" },
        ...patch,
    };
}

function convertNodes(nodes: LibTVImportNode[]) {
    return buildLibTVCanvasNodes({ nodes }, { x: 0, y: 0, k: 1 }, { width: 1200, height: 720 });
}

describe("LibTV canvas import helpers", () => {
    test("generated image imports expose prompt controls after serialization", () => {
        const source = importNode({ prompt: "  Original generation prompt\nSecond line  " });
        const before = structuredClone(source);
        const [node] = convertNodes([source]);
        const restored = JSON.parse(JSON.stringify(node));
        expect(isCanvasImageSourceNode(restored)).toBe(false);
        expect(restored.metadata.generationType).toBe("generation");
        expect(nodeGenerationPrompt(restored)).toBe(source.prompt!);
        expect(restored.metadata.content).toBe(source.content);
        expect(restored.metadata.model).toBe(source.model);
        expect(restored.metadata.importSource).toEqual(source.metadata);
        expect(source).toEqual(before);
    });

    test("images without prompts and style references remain input assets", () => {
        for (const prompt of [undefined, "", " \n\t "]) {
            const [node] = convertNodes([importNode({ prompt })]);
            expect(isCanvasImageSourceNode(node)).toBe(true);
            expect(node.metadata?.generationType).toBeUndefined();
        }
        const source = importNode();
        const [style] = convertNodes([{ ...source, metadata: { ...source.metadata, sourceType: "material-style" } }]);
        expect(isCanvasImageSourceNode(style)).toBe(true);
        expect(style.metadata?.generationType).toBeUndefined();
        expect(style.metadata?.prompt).toBe(source.prompt);
    });

    test("video conversion and relative layout remain unchanged", () => {
        const image = importNode();
        const video = importNode({ id: "video", type: "video", x: 620, content: "https://libtv-res.liblib.art/video.mp4", durationMs: 5000 });
        const [imageNode, videoNode] = convertNodes([image, video]);
        expect(videoNode.type).toBe("video");
        expect(videoNode.metadata?.generationType).toBeUndefined();
        expect(nodeGenerationPrompt(videoNode)).toBe(video.prompt!);
        expect(videoNode.metadata?.content).toBe(video.content);
        expect(videoNode.metadata?.previewContent).toContain("video%2Fsnapshot");
        expect(videoNode.metadata?.durationMs).toBe(5000);
        expect(videoNode.position.x - imageNode.position.x).toBe(video.x - image.x);
        expect(videoNode.position.y - imageNode.position.y).toBe(video.y - image.y);
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
