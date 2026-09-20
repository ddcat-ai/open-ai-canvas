import { describe, expect, test } from "bun:test";

import { autoMentionCanvasResourceReferences, findCanvasResourceAutoLinkMatch, type CanvasResourceReference, applyCanvasConnectionPromptSync, buildAssetMentionReferences, buildCanvasNodeMentionReferenceMap, buildNodeMentionReferences, buildOrderedCanvasResourceReferences, canvasResourceMentionToken, collectUpstreamVideoNodes, imageGenerationReferenceConnections, reorderCanvasResourceConnections, replaceCanvasMentionToken, replaceCanvasReferenceMentions } from "../src/lib/canvas/canvas-resource-references";
import { canvasNodeToAsset } from "../src/lib/canvas/canvas-node-asset";
import { buildNodeGenerationInputs } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const smartReferences: CanvasResourceReference[] = [
    { id: "image-6", nodeId: "image-6", kind: "image", label: "图片6", title: "宫门全景", active: true },
    { id: "character", nodeId: "character", kind: "character", label: "角色1", title: "唐妙菱", active: true },
];

describe("canvas smart references", () => {
    test("converts repeated names and aliases without rewriting existing mentions", () => {
        expect(autoMentionCanvasResourceReferences("图片6在前景，图6退后；宫门全景可见。唐妙菱看向图片60。", smartReferences))
            .toBe("@图片6 在前景，@图片6 退后；@图片6 可见。@角色1 看向图片60。");
        const existing = "已有 @图片6 和 @[node:image-6]、@[asset:宫门全景]。";
        expect(autoMentionCanvasResourceReferences(existing, smartReferences)).toBe(existing);
        expect(autoMentionCanvasResourceReferences("请使用 2。不要改约2秒。", smartReferences)).toBe("请使用 @角色1。不要改约2秒。");
    });

    test("returns exact replacement offsets for names and shelf orders", () => {
        for (const alias of ["唐妙菱", "角色1", "2", "image2", "image 2"]) {
            const prompt = `请使用 ${alias}，然后继续`;
            expect(findCanvasResourceAutoLinkMatch(prompt, 4 + alias.length, smartReferences))
                .toEqual({ reference: smartReferences[1], start: 4, end: 4 + alias.length, query: alias });
        }
    });

    test("skips inactive, library and skill references and ambiguous names", () => {
        const excluded: CanvasResourceReference[] = [
            { ...smartReferences[0], active: false },
            { ...smartReferences[1], assetId: "library" },
            { ...smartReferences[1], kind: "skill" },
        ];
        expect(autoMentionCanvasResourceReferences("宫门全景 唐妙菱 1", excluded)).toBe("宫门全景 唐妙菱 1");
        expect(findCanvasResourceAutoLinkMatch("唐妙菱", 3, excluded)).toBeNull();
        const ambiguous = [smartReferences[0], { ...smartReferences[1], title: "宫门全景" }];
        expect(autoMentionCanvasResourceReferences("宫门全景", ambiguous)).toBe("宫门全景");
        expect(findCanvasResourceAutoLinkMatch("宫门全景", 4, ambiguous)).toBeNull();
    });

    test("does not complete partial identifiers, existing tokens or ordinary numbers", () => {
        for (const [prompt, cursor] of [
            ["@图片6", 4], ["@[node:宫门全景", 10], ["@前缀宫门全景", 7],
            ["myimage2", 8], ["图片60", 3], ["2秒", 1], ["约2", 2], ["20", 1],
            ["", 0], ["2", 5],
        ] as const) {
            expect(findCanvasResourceAutoLinkMatch(prompt, cursor, smartReferences)).toBeNull();
        }
    });

    test("escapes regular expression characters and preserves explicit mention tokens", () => {
        const reference = { ...smartReferences[0], title: "场景(夜)+", mentionToken: "@[node:image-6]" };
        expect(autoMentionCanvasResourceReferences("场景(夜)+出现", [reference])).toBe("@[node:image-6] 出现");
        expect(findCanvasResourceAutoLinkMatch(reference.title, reference.title.length, [reference])?.reference).toBe(reference);
    });
});

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

    test("仅有持久资源键的媒体节点仍可恢复为素材且不伪造临时地址", () => {
        const node = videoNode("storage-key-only-video");
        node.metadata = {
            storageKey: "  video:user:durable  ",
            mimeType: "video/mp4",
        };

        const asset = canvasNodeToAsset(node, { canvasId: "canvas", source: "canvas-upload" });

        expect(asset?.kind).toBe("video");
        expect(asset?.kind === "video" ? asset.data.url : "not-video").toBe("");
        expect(asset?.kind === "video" ? asset.data.storageKey : undefined).toBe("video:user:durable");
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

    test("绘图引用保留本地预览定位信息", () => {
        const drawing: CanvasNodeData = {
            id: "drawing-a",
            type: CanvasNodeType.Drawing,
            title: "草图 A",
            position: { x: 0, y: 0 },
            width: 100,
            height: 100,
            metadata: { drawingId: "drawing-document-a", drawingRevision: 3 },
        };
        const target = videoNode("target");
        const [reference] = buildNodeMentionReferences(target, [drawing, target], [connection(drawing.id, target.id)]);
        expect(reference).toMatchObject({ kind: "image", label: "绘图1", drawingId: "drawing-document-a", drawingRevision: 3 });
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

    test("批量索引保持直接引用和配置节点引用语义", () => {
        const image = imageNode("image-a");
        const audio = audioNode("audio-a");
        const target = videoNode("target");
        const config: CanvasNodeData = { id: "config", type: CanvasNodeType.Config, title: "config", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} };
        const nodes = [image, audio, target, config];
        const connections = [connection(image.id, target.id), connection(target.id, config.id), connection(audio.id, config.id)];
        const references = buildCanvasNodeMentionReferenceMap(nodes, connections);

        expect(references.get(target.id)?.map((reference) => reference.nodeId)).toEqual([audio.id]);
        expect(references.get(config.id)?.map((reference) => reference.nodeId)).toEqual([target.id, audio.id]);
        expect(references.get(image.id)?.map((reference) => reference.nodeId)).toEqual([]);
        expect(buildNodeMentionReferences(image, nodes, connections).map((reference) => reference.nodeId)).toEqual([image.id]);
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

describe("remove canvas resource mention tokens", () => {
    test("断开首图时同步紧邻中文、连续引用及两位数编号", () => {
        const images = Array.from({ length: 10 }, (_, index) => imageNode(`image-${index}`));
        const target = {
            ...videoNode("target"),
            metadata: { composerContent: "@图片1@图片2的人物参考@图片10，@[node:image-1]保持一致" },
        };
        const nodes = [...images, target];
        const connections = images.map((image) => connection(image.id, target.id));
        const result = applyCanvasConnectionPromptSync(nodes, connections, nodes, connections.slice(1));
        expect(result.find((node) => node.id === target.id)?.metadata?.composerContent)
            .toBe("@图片1的人物参考@图片9，@图片1保持一致");
    });

    test("取消引用后会清掉对应的 @图片N", () => {
        const image = imageNode("image-a");
        const target = {
            ...videoNode("target"),
            metadata: { composerContent: "@图片1 生成角色设定图：保持同一角色身份。" },
        };
        const previousConnections = [connection(image.id, target.id)];
        const [nextTarget] = applyCanvasConnectionPromptSync([image, target], previousConnections, [image, target], []).filter((node) => node.id === target.id);

        expect(nextTarget.metadata?.composerContent).toBe("生成角色设定图：保持同一角色身份。");
        expect(nextTarget.metadata?.composerContent).not.toContain("@图片1");
    });

    test("同时存在节点 token 时一并清掉", () => {
        const image = imageNode("image-a");
        const target = {
            ...videoNode("target"),
            metadata: { composerContent: "让 @图片1 和 @[node:image-a] 一起进入画面" },
        };
        const [nextTarget] = applyCanvasConnectionPromptSync([image, target], [connection(image.id, target.id)], [image, target], []).filter((node) => node.id === target.id);
        expect(nextTarget.metadata?.composerContent).toBe("让 和 一起进入画面");
        expect(nextTarget.metadata?.composerContent).not.toContain("@图片1");
        expect(nextTarget.metadata?.composerContent).not.toContain("@[node:image-a]");
    });

    test("多图时只清被移除的那张，并把剩余引用重新编号", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const target = {
            ...videoNode("target"),
            metadata: { composerContent: "比较 @图片1 和 @图片2" },
        };
        const previousConnections = [connection(imageA.id, target.id), connection(imageB.id, target.id)];
        const nextConnections = [connection(imageB.id, target.id)];
        const [nextTarget] = applyCanvasConnectionPromptSync([imageA, imageB, target], previousConnections, [imageA, imageB, target], nextConnections).filter((node) => node.id === target.id);

        expect(nextTarget.metadata?.composerContent).toBe("比较 和 @图片1");
    });
});

describe("image generation reference connections", () => {
    test("把源节点的参考图连线复制到新结果，避免提示词图片丢失", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const source = textNode("prompt");
        const nodes = [imageA, imageB, source];
        const connections = [connection(imageA.id, source.id), connection(imageB.id, source.id)];
        const copied = imageGenerationReferenceConnections(source.id, "result", nodes, connections, () => "new-id");
        expect(copied.map((item) => item.fromNodeId)).toEqual(["image-a", "image-b"]);
        expect(copied.every((item) => item.toNodeId === "result")).toBe(true);
    });
});

describe("reorder canvas resource connections", () => {
    test("直接引用按指定顺序换位并同步编号提示词", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const target = { ...videoNode("target"), metadata: { composerContent: "比较 @图片1 和 @图片2" } };
        const nodes = [imageA, imageB, target];
        const previousConnections = [connection(imageA.id, target.id), connection(imageB.id, target.id)];
        const nextConnections = reorderCanvasResourceConnections(target.id, [imageB.id, imageA.id], nodes, previousConnections);
        expect(nextConnections.map((item) => item.fromNodeId)).toEqual([imageB.id, imageA.id]);
        const nextNodes = applyCanvasConnectionPromptSync(nodes, previousConnections, nodes, nextConnections);
        expect(nextNodes.find((node) => node.id === target.id)?.metadata?.composerContent).toBe("比较 @图片2 和 @图片1");
    });

    test("配置节点承接的引用可排序且不改变主链和无关连线", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const target = videoNode("target");
        const config: CanvasNodeData = { id: "config", type: CanvasNodeType.Config, title: "config", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} };
        const other = videoNode("other");
        const main = connection(target.id, config.id);
        const unrelated = connection(imageA.id, other.id);
        const previousConnections = [main, connection(imageA.id, config.id), unrelated, connection(imageB.id, config.id)];
        const nextConnections = reorderCanvasResourceConnections(target.id, [imageB.id, imageA.id], [imageA, imageB, target, config, other], previousConnections);
        expect(nextConnections).toEqual([main, connection(imageB.id, config.id), unrelated, connection(imageA.id, config.id)]);
        expect(nextConnections[0]).toBe(main);
        expect(nextConnections[2]).toBe(unrelated);
    });
});

describe("replace canvas reference mentions", () => {
    test("替换参考图时将提示词内所有提及同张图片的标记全部替换", () => {
        const oldRef: CanvasResourceReference = {
            id: "node-old",
            nodeId: "node-old",
            kind: "image",
            label: "图片1",
            title: "卡通可爱动画风画册",
            active: true,
        };
        const prompt = "@图片1 参考 @图片2 生成，保持 @图片1 的色调与 @卡通可爱动画风画册 的画风";
        const replaced = replaceCanvasReferenceMentions(prompt, oldRef, "@图片3", "未来赛博超跑");
        expect(replaced).toBe("@图片3 参考 @图片2 生成，保持 @图片3 的色调与 @未来赛博超跑 的画风");
    });

    test("不会误替换较长数字或无关标记", () => {
        const oldRef: CanvasResourceReference = {
            id: "node-old",
            nodeId: "node-old",
            kind: "image",
            label: "图片1",
            title: "画册",
            active: true,
        };
        const prompt = "@图片1 和 @图片10 及 @图片11，不要改动 @图片10";
        const replaced = replaceCanvasReferenceMentions(prompt, oldRef, "@图片9");
        expect(replaced).toBe("@图片9 和 @图片10 及 @图片11，不要改动 @图片10");
    });

    test("自动规范化带有或缺失@前缀的参数", () => {
        const oldRef: CanvasResourceReference = {
            id: "node-old",
            nodeId: "node-old",
            kind: "image",
            label: "@图片1",
            title: "@画册",
            active: true,
        };
        const prompt = "@图片1 的画风结合 @画册 的色调";
        const replaced = replaceCanvasReferenceMentions(prompt, oldRef, "图片2", "新封面");
        expect(replaced).toBe("@图片2 的画风结合 @新封面 的色调");
    });
});
