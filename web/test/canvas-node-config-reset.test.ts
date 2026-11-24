import { describe, expect, test } from "bun:test";
import { applyNodeConfigPatch } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function imageNode(metadata: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id: "image-1",
        type: CanvasNodeType.Image,
        title: "图片",
        position: { x: 0, y: 0 },
        width: 400,
        height: 400,
        metadata: metadata as CanvasNodeData["metadata"],
    };
}

describe("applyNodeConfigPatch 模型切换保留媒体参数", () => {
    test("切换图片模型保留已选参数，由新模型校验兼容性", () => {
        const node = imageNode({
            model: "default::gpt-image-2",
            size: "1:1",
            quality: "high",
            count: 2,
            transparentBackground: "true",
        });
        const next = applyNodeConfigPatch(node, { model: "default::grok-imagine-video" });
        expect(next.metadata?.model).toBe("default::grok-imagine-video");
        expect(next.metadata?.size).toBe("1:1");
        expect(next.metadata?.quality).toBe("high");
        expect(next.metadata?.count).toBe(2);
        expect(next.metadata?.transparentBackground).toBe("true");
    });

    test("视频参数随模型切换保留", () => {
        const node = imageNode({
            model: "default::seedance-video",
            seconds: "10",
            vquality: "1080p",
            generateAudio: "true",
            watermark: "false",
        });
        node.type = CanvasNodeType.Video;
        const next = applyNodeConfigPatch(node, { model: "default::veo-3" });
        expect(next.metadata?.seconds).toBe("10");
        expect(next.metadata?.vquality).toBe("1080p");
        expect(next.metadata?.generateAudio).toBe("true");
        expect(next.metadata?.watermark).toBe("false");
    });

    test("音频参数随模型切换一并清理", () => {
        const node = imageNode({
            model: "default::tts-1",
            audioVoice: "alloy",
            audioFormat: "mp3",
            audioSpeed: "1.25",
            audioInstructions: "温暖、自然",
        });
        node.type = CanvasNodeType.Audio;
        const next = applyNodeConfigPatch(node, { model: "default::gpt-4o-mini-tts" });
        expect(next.metadata?.audioVoice).toBeUndefined();
        expect(next.metadata?.audioFormat).toBeUndefined();
        expect(next.metadata?.audioSpeed).toBeUndefined();
        expect(next.metadata?.audioInstructions).toBeUndefined();
    });

    test("同一模型标识的参数调整不受影响", () => {
        const node = imageNode({ model: "default::gpt-image-2", size: "1:1", quality: "high" });
        const next = applyNodeConfigPatch(node, { model: "default::gpt-image-2", quality: "medium" });
        expect(next.metadata?.model).toBe("default::gpt-image-2");
        expect(next.metadata?.quality).toBe("medium");
        expect(next.metadata?.size).toBe("1:1");
    });

    test("非模型 patch（仅调整参数）不触发清理", () => {
        const node = imageNode({ model: "default::gpt-image-2", size: "1:1" });
        const next = applyNodeConfigPatch(node, { size: "16:9" });
        expect(next.metadata?.size).toBe("16:9");
        expect(next.metadata?.model).toBe("default::gpt-image-2");
    });

    test("模型切换时同批显式参数仍优先于清理", () => {
        const node = imageNode({ model: "default::gpt-image-2", size: "1:1", quality: "high" });
        const next = applyNodeConfigPatch(node, { model: "default::grok-imagine-video", size: "16:9" });
        expect(next.metadata?.model).toBe("default::grok-imagine-video");
        expect(next.metadata?.size).toBe("16:9");
        expect(next.metadata?.quality).toBe("high");
    });

    test("内容型字段不随模型切换清理", () => {
        const node = imageNode({ model: "default::gpt-image-2", prompt: "一只猫", composerContent: "生成一只猫" });
        const next = applyNodeConfigPatch(node, { model: "default::grok-imagine-video" });
        expect(next.metadata?.prompt).toBe("一只猫");
        expect(next.metadata?.composerContent).toBe("生成一只猫");
    });
});
