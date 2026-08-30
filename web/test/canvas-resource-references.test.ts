import { describe, expect, test } from "bun:test";

import { buildAssetMentionReferences, buildNodeMentionReferences, buildOrderedCanvasResourceReferences, canvasResourceMentionToken, collectUpstreamVideoNodes } from "../src/lib/canvas/canvas-resource-references";
import { canvasNodeToAsset } from "../src/lib/canvas/canvas-node-asset";
import { buildNodeGenerationInputs } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function videoNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content: `data:video/mp4;base64,${id}` },
    };
}

function textNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 60,
        metadata: { content: id },
    };
}

function imageNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content: `data:image/png;base64,${id}` },
    };
}

function audioNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Audio,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 60,
        metadata: { content: `data:audio/mpeg;base64,${id}` },
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `conn-${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

describe("collectUpstreamVideoNodes", () => {
    test("下游视频节点能回溯到上游视频源", () => {
        const source = videoNode("source-video");
        const segment = videoNode("segment-video");
        const target = videoNode("target-video");
        const text = textNode("script");
        const nodes = [target, segment, source, text];
        const connections = [connection("source-video", "segment-video"), connection("segment-video", "target-video"), connection("script", "segment-video")];
        expect(collectUpstreamVideoNodes("target-video", nodes, connections).map((node) => node.id)).toEqual(["target-video", "segment-video", "source-video"]);
    });

    test("存在环时不会死循环", () => {
        const a = videoNode("a");
        const b = videoNode("b");
        const nodes = [a, b];
        const connections = [connection("a", "b"), connection("b", "a")];
        expect(collectUpstreamVideoNodes("a", nodes, connections).length).toBe(2);
    });
});

describe("canvas resource mention slots", () => {
    test("素材库视频优先使用封面，没有封面时保留首帧视频回退源", () => {
        const poster = buildAssetMentionReferences([{
            id: "video-with-poster",
            kind: "video",
            title: "带封面视频",
            coverUrl: "https://cdn.example.com/poster.jpg",
            tags: [],
            createdAt: "2026-08-31T00:00:00.000Z",
            updatedAt: "2026-08-31T00:00:00.000Z",
            data: { url: "https://cdn.example.com/video.mp4", storageKey: "resource:video", width: 1280, height: 720, bytes: 1, mimeType: "video/mp4" },
        }])[0];
        expect(poster?.previewUrl).toBe("https://cdn.example.com/poster.jpg");
        expect(poster?.mediaUrl).toBeUndefined();

        const legacy = buildAssetMentionReferences([{
            id: "legacy-video",
            kind: "video",
            title: "旧视频",
            coverUrl: "https://cdn.example.com/video.mp4",
            tags: [],
            createdAt: "2026-08-31T00:00:00.000Z",
            updatedAt: "2026-08-31T00:00:00.000Z",
            data: { url: "https://cdn.example.com/video.mp4", storageKey: "resource:legacy-video", width: 1280, height: 720, bytes: 1, mimeType: "video/mp4" },
        }])[0];
        expect(legacy?.previewUrl).toBe("");
        expect(legacy?.mediaUrl).toBe("https://cdn.example.com/video.mp4");
    });

    test("保存画布视频资产时保留节点已有的静态首帧", () => {
        const node = videoNode("video-with-poster");
        node.metadata = {
            content: "https://cdn.example.com/video.mp4",
            videoPreview: { content: "https://cdn.example.com/poster.jpg", storageKey: "resource:poster" },
        };
        const asset = canvasNodeToAsset(node, { canvasId: "canvas", source: "canvas-upload" });
        expect(asset?.kind).toBe("video");
        expect(asset && "coverUrl" in asset ? asset.coverUrl : "").toBe("https://cdn.example.com/poster.jpg");
    });

    test("上传视频作为生成设置引用时携带首帧预览，而不是播放器地址", () => {
        const source = videoNode("uploaded-video");
        source.metadata = {
            content: "https://cdn.example.com/video.mp4",
            storageKey: "video:user:uploaded",
            videoPreview: { content: "blob:poster", storageKey: "image:user:poster", width: 400, height: 225 },
        };
        const config: CanvasNodeData = {
            id: "config",
            type: CanvasNodeType.Config,
            title: "生成设置",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: {},
        };
        const inputs = buildNodeGenerationInputs(config.id, [source, config], [connection(source.id, config.id)]);
        expect(inputs).toHaveLength(1);
        expect(inputs[0]?.type).toBe("video");
        expect(inputs[0]?.previewUrl).toBe("blob:poster");
        expect(inputs[0]?.previewUrl).not.toBe(source.metadata.content);
    });

    test("视频引用只暴露静态首帧，不把原视频当缩略图", () => {
        const genericVideo = videoNode("generic-video");
        genericVideo.metadata = { content: "https://example.com/video.mp4" };
        const libtvVideo = videoNode("libtv-video");
        libtvVideo.metadata = { content: "https://libtv-res.liblib.art/path/video.mp4" };

        const references = buildOrderedCanvasResourceReferences([genericVideo, libtvVideo]);
        expect(references[0]?.previewUrl).toBe("");
        expect(references[1]?.previewUrl).toContain("video%2Fsnapshot");

        const uploaded = videoNode("uploaded-video");
        uploaded.metadata = {
            content: "https://cdn.example.com/video.mp4",
            storageKey: "video:user:source",
            videoPreview: { content: "https://cdn.example.com/poster.jpg", storageKey: "image:user:poster" },
        };
        const [uploadedReference] = buildOrderedCanvasResourceReferences([uploaded]);
        expect(uploadedReference?.previewStorageKey).toBe("image:user:poster");
        expect(uploadedReference?.storageKey).toBe("video:user:source");
    });

    test("画布节点引用只保存类型位置，不保存节点 ID", () => {
        const target = videoNode("target");
        const image = imageNode("image-a");
        const [reference] = buildNodeMentionReferences(target, [image, target], [connection(image.id, target.id)]);

        expect(reference.label).toBe("图片1");
        expect(canvasResourceMentionToken(reference)).toBe("@图片1");
        expect(canvasResourceMentionToken(reference)).not.toContain(image.id);
    });

    test("图片、音频和文本分别按各自类型顺序编号", () => {
        const target = videoNode("target");
        const nodes = [imageNode("image-a"), audioNode("audio-a"), imageNode("image-b"), textNode("text-a"), target];
        const connections = nodes.slice(0, -1).map((node) => connection(node.id, target.id));

        expect(buildNodeMentionReferences(target, nodes, connections).map((reference) => reference.label)).toEqual(["图片1", "音频1", "图片2", "文本1"]);
    });

    test("素材库身份 token 保持稳定", () => {
        expect(canvasResourceMentionToken({
            id: "asset:asset-a",
            nodeId: "",
            assetId: "asset-a",
            kind: "image",
            label: "场景图",
            title: "场景图",
            active: false,
        })).toBe("@[asset:asset-a]");
    });
});
