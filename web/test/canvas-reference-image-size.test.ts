import { describe, expect, test } from "bun:test";

import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-config";
import { applyNodeConfigPatch } from "../src/lib/canvas/canvas-project-domain";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { canvasReferenceImageDimensions, followsReferenceImageSize, referenceImageSizeSelection } from "../src/lib/canvas/canvas-reference-image-size";
import { defaultModelCapabilityConfig, type ImageCapabilityConfig } from "../src/lib/model-capabilities";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../src/types/canvas";

const MODEL = "relay::test-image";

function imageConfig(configure: (image: ImageCapabilityConfig) => void = () => {}): AiConfig {
    const capabilityConfig = defaultModelCapabilityConfig(undefined, "test-image");
    configure(capabilityConfig.image!);
    return {
        ...defaultConfig,
        size: "1:1",
        quality: "auto",
        channels: [
            {
                id: "relay",
                name: "中转渠道",
                baseUrl: "https://api.example.com",
                apiKey: "test-key",
                apiFormat: "openai",
                models: ["test-image"],
                modelCosts: [{ model: "test-image", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1, capabilityConfig }],
            },
        ],
        models: [MODEL],
        imageModels: [MODEL],
        imageModel: MODEL,
        model: MODEL,
    };
}

function aspectRatioConfig() {
    return imageConfig((image) => {
        image.size = { parameter: "aspect_ratio", values: ["1:1", "16:9", "9:16", "4:3", "3:4"], default: "1:1", allowCustom: false };
        image.quality = { supported: true, values: ["1k", "2k", "4k"], default: "1k" };
    });
}

function imageNode(id: string, metadata?: CanvasNodeMetadata, width = 340, height = 240): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width, height, metadata };
}

describe("图生图默认跟随参考图比例", () => {
    test("比例协议按参考图选择比例并保留当前分辨率档", () => {
        const config = aspectRatioConfig();
        expect(referenceImageSizeSelection(config, MODEL, { width: 1920, height: 1080 }, { quality: "1k" })).toEqual({ size: "16:9", quality: "1k" });
        expect(referenceImageSizeSelection(config, MODEL, { width: 1024, height: 1024 }, { quality: "2k" })).toEqual({ size: "1:1", quality: "2k" });
        expect(referenceImageSizeSelection(config, MODEL, { width: 1080, height: 1920 }, { quality: "4k" })).toEqual({ size: "9:16", quality: "4k" });
    });

    test("像素协议的比例值只替换比例，质量仍由请求端换算像素", () => {
        const config = imageConfig();
        expect(referenceImageSizeSelection(config, MODEL, { width: 1920, height: 1080 }, { size: "1:1", quality: "high" })).toEqual({ size: "16:9" });
        // 手机截图 9:19.5 没有同名比例，取同方向最近的 9:16。
        expect(referenceImageSizeSelection(config, MODEL, { width: 1170, height: 2532 }, { size: "1:1" })).toEqual({ size: "9:16" });
    });

    test("比例不标准时取最接近的预设，不留在 auto", () => {
        const config = imageConfig((image) => {
            image.size = { parameter: "size", values: ["auto", "1024x1024", "1536x1024", "1024x1536"], default: "auto", allowCustom: false };
        });
        expect(referenceImageSizeSelection(config, MODEL, { width: 1920, height: 1080 }, { size: "auto" })).toEqual({ size: "1536x1024" });
        expect(referenceImageSizeSelection(config, MODEL, { width: 800, height: 800 }, { size: "auto" })).toEqual({ size: "1024x1024" });
        // 1910×1080 不是标准 16:9，仍取 16:9。
        expect(referenceImageSizeSelection(aspectRatioConfig(), MODEL, { width: 1910, height: 1080 }, { quality: "1k" })).toEqual({ size: "16:9", quality: "1k" });

        // 没有同方向选项时取整体最接近的，而不是保持 auto。
        const squareOnly = imageConfig((image) => {
            image.size = { parameter: "size", values: ["auto", "1024x1024"], default: "auto", allowCustom: false };
        });
        expect(referenceImageSizeSelection(squareOnly, MODEL, { width: 1920, height: 1080 }, { size: "auto" })).toEqual({ size: "1024x1024" });
    });

    test("声明式参数协议同样按参考图选尺寸并带上分辨率档", () => {
        const config = imageConfig((image) => {
            image.size = {
                parameter: "size",
                values: ["auto", "1824x1024", "1024x1824", "1024x1024", "2752x1536", "1536x2752", "2048x2048"],
                default: "auto",
                allowCustom: false,
                presets: [
                    { tier: "1k", ratio: "16:9", width: 1824, height: 1024, size: "1824x1024" },
                    { tier: "1k", ratio: "9:16", width: 1024, height: 1824, size: "1024x1824" },
                    { tier: "1k", ratio: "1:1", width: 1024, height: 1024, size: "1024x1024" },
                    { tier: "2k", ratio: "16:9", width: 2752, height: 1536, size: "2752x1536" },
                    { tier: "2k", ratio: "9:16", width: 1536, height: 2752, size: "1536x2752" },
                    { tier: "2k", ratio: "1:1", width: 2048, height: 2048, size: "2048x2048" },
                ],
            };
            image.resolution = { supported: true, values: ["1k", "2k"], default: "1k" };
            image.parameters = [
                { name: "size", label: "尺寸", type: "string", default: "auto", enabled: true, values: image.size.values },
                { name: "imageResolution", label: "分辨率", type: "string", default: "1k", enabled: true, values: ["1k", "2k"] },
            ];
        });
        expect(referenceImageSizeSelection(config, MODEL, { width: 1080, height: 1920 }, { size: "auto", imageResolution: "2k" })).toEqual({ size: "1536x2752", imageResolution: "2k" });
    });

    test("独立分辨率档的预设模型保留当前档位并同时提交分辨率", () => {
        const seedream = defaultModelCapabilityConfig("km-kemei-seedream", "test-image").image!;
        const config = imageConfig((image) => Object.assign(image, seedream));
        const selection = referenceImageSizeSelection(config, MODEL, { width: 1920, height: 1080 }, { size: "2048x2048", imageResolution: "2k" });
        expect(selection?.imageResolution).toBe("2k");
        const [width, height] = (selection?.size || "").split("x").map(Number);
        expect(Math.abs(width / height - 16 / 9)).toBeLessThan(0.05);
        expect(seedream.size.values).toContain(selection?.size);
    });

    test("无尺寸参数的模型不推断比例", () => {
        const config = imageConfig((image) => {
            image.size = { parameter: "none", values: [], default: "auto", allowCustom: false };
        });
        expect(referenceImageSizeSelection(config, MODEL, { width: 1920, height: 1080 })).toBeUndefined();
    });

    test("未选尺寸、auto、模型默认值或参考图填入的尺寸会跟随参考图", () => {
        expect(followsReferenceImageSize(imageNode("empty"))).toBe(true);
        expect(followsReferenceImageSize(imageNode("legacy-auto", { size: "auto" }))).toBe(true);
        expect(followsReferenceImageSize(imageNode("default", { size: "1:1", imageSizeSource: "default" }))).toBe(true);
        expect(followsReferenceImageSize(imageNode("reference", { size: "16:9", imageSizeSource: "reference" }))).toBe(true);
        expect(followsReferenceImageSize(imageNode("user", { size: "1:1", imageSizeSource: "user" }))).toBe(false);
        expect(followsReferenceImageSize(imageNode("user-auto", { size: "auto", imageSizeSource: "user" }))).toBe(false);
        expect(followsReferenceImageSize(imageNode("legacy", { size: "1:1" }))).toBe(false);
        expect(followsReferenceImageSize({ ...imageNode("video"), type: CanvasNodeType.Video })).toBe(false);
    });

    test("参考图尺寸取第一张有内容的上游图片，不把节点自身当参考", () => {
        const source = imageNode("source", { content: "https://example.com/a.png", naturalWidth: 1920, naturalHeight: 1080 });
        const target = imageNode("target");
        expect(canvasReferenceImageDimensions("target", [source, target], [{ id: "c1", fromNodeId: "source", toNodeId: "target" }])).toEqual({ width: 1920, height: 1080 });
        expect(canvasReferenceImageDimensions("source", [source, target], [])).toBeUndefined();
    });

    test("提示词面板与生成请求得到同一个比例", () => {
        const config = aspectRatioConfig();
        const reference = { width: 1920, height: 1080 };
        const requirements = { capability: "image" as const };
        const fresh = imageNode("fresh");
        expect(buildNodeConfig(config, fresh, "image", requirements, reference).size).toBe("16:9");
        expect(buildGenerationConfig(config, fresh, "image", undefined, false, reference).size).toBe("16:9");

        const userChoice = imageNode("user", { model: MODEL, size: "1:1", imageSizeSource: "user" });
        expect(buildNodeConfig(config, userChoice, "image", requirements, reference).size).toBe("1:1");
        expect(buildGenerationConfig(config, userChoice, "image", undefined, false, reference).size).toBe("1:1");

        const modelDefault = imageNode("default", { model: MODEL, size: "1:1", quality: "2k", imageSizeSource: "default" });
        const generated = buildGenerationConfig(config, modelDefault, "image", undefined, false, reference);
        expect(generated.size).toBe("16:9");
        expect(generated.quality).toBe("2k");
    });

    test("切换模型保留兼容的用户比例，不重新跟随参考图", () => {
        const node = imageNode("node", { model: "relay::old-image", size: "1:1", imageSizeSource: "user" });
        const config = aspectRatioConfig();
        const next = applyNodeConfigPatch(node, { model: MODEL }, config);
        expect(next.metadata?.size).toBe("1:1");
        expect(next.metadata?.imageSizeSource).toBe("user");
        expect(buildNodeConfig(config, next, "image", { capability: "image" }, { width: 1920, height: 1080 }).size).toBe("1:1");
    });

    test("隐式跟随参考图的节点切换、保存重开后仍使用参考比例", () => {
        const config = aspectRatioConfig();
        config.channels[0].models.push("other-image");
        config.channels[0].modelCosts!.push({ ...config.channels[0].modelCosts![0], model: "other-image" });
        const reference = { width: 1080, height: 1920 };
        for (const metadata of [{}, { size: "auto" }, { size: "1:1", imageSizeSource: "default" as const }, { size: "9:16", imageSizeSource: "reference" as const }]) {
            const node = imageNode("implicit", { model: MODEL, ...metadata });
            expect(buildNodeConfig(config, node, "image", { capability: "image" }, reference).size).toBe("9:16");
            const switched = applyNodeConfigPatch(node, { model: "relay::other-image" }, config);
            const reopened: CanvasNodeData = JSON.parse(JSON.stringify(switched));
            expect(followsReferenceImageSize(reopened)).toBe(true);
            expect([reopened.width, reopened.height, reopened.position]).toEqual([node.width, node.height, node.position]);
            expect(buildNodeConfig(config, reopened, "image", { capability: "image" }, reference).size).toBe("9:16");
            expect(buildGenerationConfig(config, reopened, "image", undefined, false, reference).size).toBe("9:16");
            const nextReference = { width: 1920, height: 1080 };
            expect(buildGenerationConfig(config, reopened, "image", undefined, false, nextReference).size).toBe("16:9");
        }
    });
});
