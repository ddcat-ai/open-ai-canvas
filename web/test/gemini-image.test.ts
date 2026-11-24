import { describe, expect, test } from "bun:test";

import { buildGeminiImageGenerationConfig, parseGeminiImageDataUrl } from "../src/lib/gemini-image";

describe("Gemini Images request helpers", () => {
    test("拆分参考图 data URL 时使用真实 MIME 和裸 base64", () => {
        expect(parseGeminiImageDataUrl("data:image/jpeg;base64,aGVsbG8=")).toEqual({ mimeType: "image/jpeg", data: "aGVsbG8=" });
    });

    test("拒绝空图和非图片 data URL，避免把错误参考图发给 Gemini", () => {
        expect(() => parseGeminiImageDataUrl("")).toThrow("未得到有效的 image data URL");
        expect(() => parseGeminiImageDataUrl("data:text/plain;base64,aGVsbG8=")).toThrow("MIME 类型无效");
    });

    test("分辨率优先于质量且与思考等级独立，auto 保留旧质量映射", () => {
        expect(buildGeminiImageGenerationConfig("16:9", "high", "low", "1K")).toEqual({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
            thinkingConfig: { thinkingLevel: "LOW" },
        });
        expect(buildGeminiImageGenerationConfig("auto", "medium", "HIGH", "auto")).toEqual({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { imageSize: "2K" },
            thinkingConfig: { thinkingLevel: "HIGH" },
        });
        expect(buildGeminiImageGenerationConfig("auto", "auto", "auto", "auto")).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
    });

    test("把统一图片选项映射到 Gemini imageConfig", () => {
        expect(buildGeminiImageGenerationConfig("16:9", "high")).toEqual({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
        });
        expect(buildGeminiImageGenerationConfig("auto", "auto")).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
    });
});
