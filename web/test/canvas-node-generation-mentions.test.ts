import { describe, expect, test } from "bun:test";

import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, type: CanvasNodeType, content: string): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content },
    };
}

function targetNode(): CanvasNodeData {
    return {
        id: "target",
        type: CanvasNodeType.Video,
        title: "target",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { composerContent: "让 @图片1 进入画面" },
    };
}

function connection(fromNodeId: string): CanvasConnection {
    return { id: `connection-${fromNodeId}`, fromNodeId, toNodeId: "target" };
}

describe("canvas node generation position mentions", () => {
    test("已有图片节点显式引用自身时作为图生图参考图提交", () => {
        const source = node("image-self", CanvasNodeType.Image, "data:image/png;base64,a");
        source.metadata.composerContent = "将 @图片1 图片变清晰";

        const context = buildNodeGenerationContext(source.id, [source], [], source.metadata.composerContent, []);

        expect(context.referenceImages.map((image) => image.id)).toEqual([source.id]);
        expect(context.imageCount).toBe(1);
        expect(context.prompt).toBe("将 @图片1 图片变清晰");
    });

    test("已有图片节点未显式引用自身时不自动退化为图生图", () => {
        const source = node("image-self", CanvasNodeType.Image, "data:image/png;base64,a");
        const context = buildNodeGenerationContext(source.id, [source], [], "生成一个新的构图", []);

        expect(context.referenceImages).toEqual([]);
        expect(context.imageCount).toBe(0);
        expect(context.prompt).toBe("生成一个新的构图");
    });

    test("无法解析的画布引用会阻止静默降级为文生图", () => {
        const target = targetNode();
        expect(() => buildNodeGenerationContext(target.id, [target], [], "将 @图片1 图片变清晰", [])).toThrow("@图片1 没有对应的画布资源");
    });

    test("同一个 @图片1 在换线后自动指向新的第一张图片", () => {
        const target = targetNode();
        const imageA = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const imageB = node("image-b", CanvasNodeType.Image, "data:image/png;base64,b");

        const before = buildNodeGenerationContext(target.id, [imageA, target], [connection(imageA.id)], "让 @图片1 进入画面", []);
        const after = buildNodeGenerationContext(target.id, [imageB, target], [connection(imageB.id)], "让 @图片1 进入画面", []);

        expect(before.referenceImages.map((image) => image.id)).toEqual(["image-a"]);
        expect(after.referenceImages.map((image) => image.id)).toEqual(["image-b"]);
        expect(before.prompt).toBe("让 @图片1 进入画面");
        expect(after.prompt).toBe("让 @图片1 进入画面");
    });

    test("按类型位置选择资源，提示词出现顺序不会改变槽位含义", () => {
        const target = targetNode();
        const imageA = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const audioA = node("audio-a", CanvasNodeType.Audio, "data:audio/mpeg;base64,a");
        const imageB = node("image-b", CanvasNodeType.Image, "data:image/png;base64,b");
        const connections = [connection(imageA.id), connection(audioA.id), connection(imageB.id)];
        const context = buildNodeGenerationContext(target.id, [imageA, audioA, imageB, target], connections, "让 @图片2 配合 @音频1", []);

        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-b"]);
        expect(context.referenceAudios.map((audio) => audio.id)).toEqual(["audio-a"]);
        expect(context.prompt).toBe("让 @图片1 配合 @音频1");
    });

    test("旧节点 token 只做读取迁移，不再进入生成提示词", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const context = buildNodeGenerationContext(target.id, [image, target], [connection(image.id)], "让 @[node:image-a] 进入画面", []);

        expect(context.referenceImages.map((item) => item.id)).toEqual(["image-a"]);
        expect(context.prompt).toBe("让 @图片1 进入画面");
        expect(context.prompt).not.toContain("@[node:");
    });

    test("取消引用后的提示词不再因为悬挂 @图片1 阻断生成", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const { applyCanvasConnectionPromptSync } = require("../src/lib/canvas/canvas-resource-references") as typeof import("../src/lib/canvas/canvas-resource-references");
        const [nextTarget] = applyCanvasConnectionPromptSync([image, target], [connection(image.id)], [image, target], []).filter((item: typeof target) => item.id === target.id);
        const context = buildNodeGenerationContext(nextTarget.id, [image, nextTarget], [], nextTarget.metadata?.composerContent || "", []);

        expect(nextTarget.metadata?.composerContent).toBe("让 进入画面");
        expect(context.referenceImages).toEqual([]);
        expect(context.prompt).toBe("让 进入画面");
    });
});

describe("canvas node generation video text references", () => {
    test("视频 promptOnly 下显式 @文本 引用仍内联真实内容，图片保持结构化引用", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const note = node("note", CanvasNodeType.Text, "角色设定：禾禾\n光影氛围：暗调");
        const context = buildNodeGenerationContext(target.id, [image, note, target], [connection(image.id), connection(note.id)], "参考图：@图片1\n任务要求：@文本1", [], true);

        expect(context.prompt).toBe("参考图：@图片1\n任务要求：【文本1】\n\n【文本1】\n角色设定：禾禾\n光影氛围：暗调");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["image-a"]);
        expect(context.textCount).toBe(1);
        expect(context.imageCount).toBe(1);
    });

    test("视频 promptOnly 下未显式引用的连线文本不会自动拼进提示词", () => {
        const target = targetNode();
        const image = node("image-a", CanvasNodeType.Image, "data:image/png;base64,a");
        const note = node("note", CanvasNodeType.Text, "角色设定：禾禾");
        const context = buildNodeGenerationContext(target.id, [image, note, target], [connection(image.id), connection(note.id)], "生成一段暗调舞蹈视频", [], true);

        expect(context.prompt).toBe("生成一段暗调舞蹈视频");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["image-a"]);
        expect(context.textCount).toBe(0);
    });

    test("视频 promptOnly 非显式引用路径仍丢弃上游文本，关闭后恢复自动拼接", () => {
        const target = targetNode();
        const note = node("note", CanvasNodeType.Text, "角色设定：禾禾");
        const nodes = [note, target];
        const connections = [connection(note.id)];

        expect(buildNodeGenerationContext(target.id, nodes, connections, "跳舞", [], true).prompt).toBe("跳舞");
        expect(buildNodeGenerationContext(target.id, nodes, connections, "跳舞", [], false).prompt).toBe("跳舞\n\n角色设定：禾禾");
    });
});
