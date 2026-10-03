import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { DEFAULT_VIDEO_PROMPT_MAX_CHARS, defaultModelCapabilityConfig, normalizeImageValue, normalizeVideoValue } from "../src/lib/model-capabilities.ts";
import { imageTierAvailable } from "../src/lib/image-size-presets.ts";

test("text multimodal capability is not guessed from a model name", () => {
    for (const model of ["gpt-4o", "gemini-2.5-pro", "doubao-seed"]) {
        const text = defaultModelCapabilityConfig(undefined, model).text!;
        assert.equal(text.references.maxImages, 0);
        assert.equal(text.references.maxVideos, 0);
    }
});

test("switching to MiniMax H3 replaces an unsupported 720p value with 768P", () => {
    const profile = defaultModelCapabilityConfig("minimax-video", "MiniMax-H3").video!;

    assert.deepEqual(normalizeVideoValue(profile, { seconds: "11", ratio: "16:9", resolution: "720" }), {
        seconds: "11",
        ratio: "16:9",
        resolution: "768P",
    });
});

// 视频提示词由「输入框文本 + 连线内容 + 技能上下文」合成，技能上下文预算为 32000，
// 合成结果远长于用户手输内容。默认上限过小会把正常可用的画布工作流拦在本地预检。
// 这里锁定默认值本身，避免被改回偏小值（前端放行/后端拒绝的判定必须同源）。
test("video prompt default allows a composed canvas prompt", () => {
    assert.equal(DEFAULT_VIDEO_PROMPT_MAX_CHARS, 8000);
    for (const protocol of [undefined, "seedance-videos-compatible", "agnes-video", "volcengine-ark-video"]) {
        const profile = defaultModelCapabilityConfig(protocol, "test-model");
        assert.equal(profile.video!.references.promptMaxChars, DEFAULT_VIDEO_PROMPT_MAX_CHARS);
    }
});

test("raising the video default leaves text and image limits untouched", () => {
    // 只放宽视频默认值，避免顺带改变其它能力的判定口径。
    const profile = defaultModelCapabilityConfig("seedance-videos-compatible", "sd-2.5");
    assert.equal(profile.text!.references.promptMaxChars, 32000);
    assert.equal(profile.image!.references.promptMaxChars, 32000);
});

test("Midjourney protocol defaults expose only supported controls and one submission", () => {
    for (const [protocol, model, tier, maxImages, mask, promptMaxChars, ratios] of [
        ["cangyuan-midjourney-v7", "midjourney-v7", "1k", 5, false, 4000, 10],
        ["cangyuan-midjourney-v82", "midjourney-1k", "1k", 1, true, 32000, 15],
        ["cangyuan-midjourney-v82", "midjourney-2k", "2k", 1, true, 32000, 15],
        ["cangyuan-midjourney-v82", "", "1k", 1, true, 32000, 15],
    ] as const) {
        const image = defaultModelCapabilityConfig(protocol, model).image!;
        assert.equal(image.references.maxImages, maxImages);
        assert.equal(image.references.maskSupported, mask);
        assert.equal(image.references.promptMaxChars, promptMaxChars);
        assert.equal(image.maxOutputs, 1);
        assert.equal(image.quality.supported, false);
        assert.equal(image.transparentBackground.supported, false);
        assert.equal(image.responseFormat.supported, false);
        assert.equal(image.outputFormat.supported, false);
        assert.equal(image.size.parameter, "aspect_ratio");
        assert.equal(image.size.default, "auto");
        assert.equal(image.size.allowCustom, false);
        assert.equal(image.size.presets!.length, ratios);
        assert.equal(image.size.values.length, ratios + 1);
        assert.equal(imageTierAvailable(image, tier), true);
        assert.equal(imageTierAvailable(image, tier === "1k" ? "2k" : "1k"), false);
        assert.equal(imageTierAvailable(image, "4k"), false);
        assert.deepEqual(normalizeImageValue(image, { size: "16:9", quality: "high", transparentBackground: "true", count: "4" }), { size: "16:9", quality: tier, transparentBackground: "false", count: "1" });
    }
});

test("Kacang protocol selection uses the supplier ratio and reference contracts", () => {
    for (const [protocol, ratio, maxImages, presets, auto] of [
        ["kacang-midjourney-special", "16:9", 1, 10, false],
        ["kacang-midjourney-v7", "16:9", 1, 11, true],
        ["kacang-midjourney", "9:16", 5, 11, true],
    ] as const) {
        const image = defaultModelCapabilityConfig(protocol).image!;
        assert.equal(image.references.maxImages, maxImages);
        assert.equal(image.references.maskSupported, false);
        assert.equal(image.size.default, ratio);
        assert.equal(image.size.values.includes("auto"), auto);
        assert.equal(image.size.presets!.length, presets);
        for (const preset of image.size.presets!) assert.ok(image.size.values.includes(preset.ratio), `${protocol}: preset ${preset.ratio} must be an upstream-supported value`);
        if (auto) assert.ok(image.size.presets!.some((preset) => preset.ratio === "9:21"));
        assert.equal(image.maxOutputs, 1);
        assert.equal(image.size.allowCustom, false);
        assert.equal(image.quality.supported, false);
        assert.equal(image.responseFormat.supported, false);
        assert.equal(image.transparentBackground.supported, false);
        assert.equal(image.outputFormat.supported, false);
        assert.equal(imageTierAvailable(image, "1k"), true);
        assert.equal(imageTierAvailable(image, "2k"), false);
        assert.equal(imageTierAvailable(image, "4k"), false);
        assert.deepEqual(normalizeImageValue(image, { size: "bad", quality: "high", transparentBackground: "true", count: "4" }), { size: ratio, quality: "1k", transparentBackground: "false", count: "1" });
    }
});
