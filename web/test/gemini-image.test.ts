import { describe, expect, test } from "bun:test";

import { buildGeminiImageGenerationConfig, parseGeminiImageDataUrl } from "../src/lib/gemini-image";

describe("Gemini Images request helpers", () => {
    test("拆分参考图 data URL 时使用真实 MIME 和裸 base64", () => {
        expect(parseGeminiImageDataUrl("data:image/jpeg;base64,aGVsbG8=")).toEqual({ mimeType: "image/jpeg", data: "aGVsbG8=" });
    });

    test("拒绝空图和非图片 data URL，避免把错误参考图发给 Gemini", () => {
        // i18n 迁移后测试环境 t() 返回 key 字符串，锚定稳定 key 前缀
        expect(() => parseGeminiImageDataUrl("")).toThrow(/lib:failed-to-read-the-reference-image/);
        expect(() => parseGeminiImageDataUrl("data:text/plain;base64,aGVsbG8=")).toThrow(/lib:invalid-reference-image-mime-type/);
    });

    test("把统一图片选项映射到 Gemini imageConfig", () => {
        expect(buildGeminiImageGenerationConfig("16:9", "high")).toEqual({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
        });
        expect(buildGeminiImageGenerationConfig("auto", "auto")).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
    });
});
