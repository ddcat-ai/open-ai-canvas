import { describe, expect, test } from "bun:test";

import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { findPendingMediaConversionInput } from "../src/components/canvas/canvas-node-generation";
import { getNodeAcceptedInputKinds, getNodeMaxInputCount, getNodeResourceKind } from "../src/lib/canvas/node-registry";
import { mediaConversionSourceFingerprint } from "../src/lib/media-conversion/contracts";
import { convertImageLocally, LocalImageConversionError, transformPixels } from "../src/lib/media-conversion/local-converter";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import type { AiConfig } from "../src/stores/use-config-store";

function node(type: CanvasNodeType, id: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 380, height: 440, metadata };
}

const config = {} as AiConfig;

describe("本地转换节点注册", () => {
    test("只允许一个图片或视频输入，完成后才作为图片素材", () => {
        expect(getNodeAcceptedInputKinds(CanvasNodeType.MediaConversion)).toEqual(["image", "video"]);
        expect(getNodeMaxInputCount(CanvasNodeType.MediaConversion)).toBe(1);
        expect(getNodeResourceKind(node(CanvasNodeType.MediaConversion, "conversion"))).toBeNull();
        expect(getNodeResourceKind(node(CanvasNodeType.MediaConversion, "conversion", {
            mediaConversion: { schemaVersion: 1, operation: "grayscale", status: "completed", resultStorageKey: "image:scope:result" },
        }))).toBe("image");
        expect(getNodeResourceKind(node(CanvasNodeType.MediaConversion, "conversion", {
            mediaConversion: { schemaVersion: 1, operation: "pose", status: "skipped", detectedPeople: 0 },
        }))).toBeNull();
    });

    test("连接规则接受图片和视频，拒绝没有可读媒体的节点及第二个输入", () => {
        const image = node(CanvasNodeType.Image, "image");
        const video = node(CanvasNodeType.Video, "video");
        const text = node(CanvasNodeType.Text, "text");
        const conversion = node(CanvasNodeType.MediaConversion, "conversion");
        const nodes = [image, video, text, conversion];
        const candidate = (fromNodeId: string): CanvasConnection => ({ id: `candidate-${fromNodeId}`, fromNodeId, toNodeId: conversion.id });

        expect(canvasConnectionError(config, nodes, [], candidate(image.id))).toBe("");
        expect(canvasConnectionError(config, nodes, [], candidate(video.id))).toBe("");
        expect(canvasConnectionError(config, nodes, [], candidate(text.id))).toContain("转换节点只接受图片或视频输入");
        expect(canvasConnectionError(config, nodes, [{ id: "existing", fromNodeId: image.id, toNodeId: conversion.id }], candidate(video.id))).toContain("转换节点最多连接 1 个输入");
    });

    test("下游生成会阻止未完成或待更新的转换结果", () => {
        const conversion = node(CanvasNodeType.MediaConversion, "conversion", {
            mediaConversion: { schemaVersion: 1, operation: "depth", status: "unavailable" },
        });
        const input = node(CanvasNodeType.Image, "input", { content: "data:image/png;base64,source" });
        const target = node(CanvasNodeType.Image, "target");
        const connections: CanvasConnection[] = [
            { id: "input-conversion", fromNodeId: input.id, toNodeId: conversion.id },
            { id: "conversion-target", fromNodeId: conversion.id, toNodeId: target.id },
        ];
        expect(findPendingMediaConversionInput(target.id, [input, conversion, target], connections)?.id).toBe(conversion.id);
        conversion.metadata = { mediaConversion: { schemaVersion: 1, operation: "grayscale", status: "completed", sourceNodeId: input.id, sourceFingerprint: "v1-unknown", resultStorageKey: "image:scope:result" } };
        expect(findPendingMediaConversionInput(target.id, [input, conversion, target], connections)?.id).toBe(conversion.id);
        conversion.metadata.mediaConversion.sourceFingerprint = mediaConversionSourceFingerprint(input);
        expect(findPendingMediaConversionInput(target.id, [input, conversion, target], connections)).toBeNull();
    });

    test("完成后的转换结果可作为生成参考图", async () => {
        const { nodeReferenceImage } = await import("../src/lib/canvas/canvas-project-generation");
        expect(nodeReferenceImage(node(CanvasNodeType.MediaConversion, "conversion", {
            storageKey: "image:scope:result",
            mimeType: "image/png",
            mediaConversion: {
                schemaVersion: 1,
                operation: "grayscale",
                status: "completed",
                resultStorageKey: "image:scope:result",
            },
        }))).toMatchObject({
            id: "conversion",
            storageKey: "image:scope:result",
            type: "image/png",
        });
        expect(nodeReferenceImage(node(CanvasNodeType.MediaConversion, "conversion", {
            mediaConversion: { schemaVersion: 1, operation: "grayscale", status: "processing" },
        }))).toBeNull();
    });
});

describe("图片本地转换算法", () => {
    test("灰度转换保留 alpha 并使用感知亮度", () => {
        const pixels = new Uint8ClampedArray([255, 0, 0, 200, 0, 255, 0, 100]);
        const output = transformPixels(pixels, 2, 1, "grayscale");
        expect(Array.from(output)).toEqual([76, 76, 76, 200, 150, 150, 150, 100]);
    });

    test("Canny 转换输出黑白边缘图并保留 alpha", () => {
        const pixels = new Uint8ClampedArray([
            0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
            0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
            0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
        ]);
        const output = transformPixels(pixels, 3, 3, "edge-canny");
        for (let index = 0; index < output.length; index += 4) {
            expect([0, 255]).toContain(output[index]);
            expect(output[index]).toBe(output[index + 1]);
            expect(output[index]).toBe(output[index + 2]);
            expect(output[index + 3]).toBe(255);
        }
    });

    test("浏览器算法转换把模型操作交给本机 Runtime", async () => {
        await expect(convertImageLocally("", "depth")).rejects.toMatchObject<LocalImageConversionError>({ code: "model_missing" });
    });
});
