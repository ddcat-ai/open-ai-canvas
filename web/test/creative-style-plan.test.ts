import { describe, expect, test } from "bun:test";

import { compileCreativeStylePrompt, creativeBatchRefs, normalizeCreativeStyleBible } from "@/lib/creation/creative-style-plan";

describe("creative style plan", () => {
    test("normalizes a style bible and returns a stable fingerprint", () => {
        const first = normalizeCreativeStyleBible({
            summary: "温暖自然的北欧家居商业摄影",
            globalPrompt: "温暖自然的北欧家居商业摄影，柔和侧光，真实材质",
            negativePrompt: "不要改变商品结构，不要水印",
            palette: ["米白", "木色", "低饱和蓝"],
            lighting: "柔和侧光",
            camera: "轻微俯拍",
            composition: "主体完整可见，背景低干扰",
            material: "保留真实布料纹理",
            preserve: ["商品轮廓", "商品颜色"],
            avoid: ["多余配件", "错误文字"],
            anchorRef: "hero",
        });
        const second = normalizeCreativeStyleBible({
            summary: "温暖自然的北欧家居商业摄影",
            globalPrompt: "温暖自然的北欧家居商业摄影，柔和侧光，真实材质",
            negativePrompt: "不要改变商品结构，不要水印",
            palette: ["米白", "木色", "低饱和蓝"],
            lighting: "柔和侧光",
            camera: "轻微俯拍",
            composition: "主体完整可见，背景低干扰",
            material: "保留真实布料纹理",
            preserve: ["商品轮廓", "商品颜色"],
            avoid: ["多余配件", "错误文字"],
            anchorRef: "hero",
        });

        expect(first).toBeDefined();
        expect(first?.fingerprint).toBe(second?.fingerprint);
        expect(first?.version).toBe(1);
        expect(first?.preserve).toEqual(["商品轮廓", "商品颜色"]);
    });

    test("compiles every shot with the same locked style prefix", () => {
        const style = normalizeCreativeStyleBible({
            summary: "统一商业摄影风格",
            globalPrompt: "统一商业摄影风格，柔和侧光，低饱和色彩",
            negativePrompt: "不要改变商品颜色",
            palette: ["米白", "木色"],
            lighting: "柔和侧光",
            camera: "轻微俯拍",
            composition: "主体完整可见",
            material: "真实材质",
            preserve: ["商品结构"],
            avoid: ["水印"],
        });
        if (!style) throw new Error("expected normalized style");

        const hero = compileCreativeStylePrompt(style, "白底主图，突出商品轮廓");
        const detail = compileCreativeStylePrompt(style, "材质细节特写，展示纹理");
        const prefix = `风格锁定（${style.fingerprint}）：`;

        expect(hero.startsWith(prefix)).toBe(true);
        expect(detail.startsWith(prefix)).toBe(true);
        expect(hero).toContain("不要改变商品颜色");
        expect(detail).toContain("不要改变商品颜色");
        expect(hero).toContain("白底主图，突出商品轮廓");
        expect(detail).toContain("材质细节特写，展示纹理");
    });

    test("rejects a style bible without a global prompt", () => {
        expect(normalizeCreativeStyleBible({ summary: "缺少统一风格" })).toBeUndefined();
    });

    test("holds the rest of the batch until the style anchor is ready", () => {
        const style = normalizeCreativeStyleBible({ globalPrompt: "统一商业摄影风格", anchorRef: "hero" });
        if (!style) throw new Error("expected normalized style");

        expect(creativeBatchRefs(style, ["hero", "scene", "detail"], new Set())).toEqual(["hero"]);
        expect(creativeBatchRefs(style, ["hero", "scene", "detail"], new Set(["hero"]))).toEqual(["hero", "scene", "detail"]);
    });
});
