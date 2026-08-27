import { describe, expect, test } from "bun:test";

import { buildNodeMentionReferences, canvasResourceMentionToken, collectUpstreamVideoNodes } from "../src/lib/canvas/canvas-resource-references";
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
