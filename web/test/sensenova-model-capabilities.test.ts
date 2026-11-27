import assert from "node:assert/strict";
import test from "node:test";

import { defaultImageCapabilityConfig, defaultModelCapabilityConfig } from "../src/lib/model-capabilities.ts";

test("SenseNova text defaults are exact protocol and model contracts", () => {
    const cases = [
        ["sensenova-6.8-flash", 1_048_576, 131_072, "always", "high", ["minimal", "low", "medium", "high", "max"], 16],
        ["sensenova-6.8-flash-lite", 128_000, 65_536, "levels", "high", ["off", "low", "medium", "high", "max"], 16],
        ["deepseek-flash", 1_048_576, 393_216, "levels", "high", ["off", "low", "high", "max"], 100],
        ["glm-5.3", 1_048_576, 131_072, "always", "max", ["low", "high", "max"], 0],
        ["kimi-k3", 1_048_576, 131_072, "levels", "max", ["off", "low", "medium", "high", "max"], 16],
    ] as const;
    for (const [model, context, output, mode, defaultLevel, levels, images] of cases) {
        const profile = defaultModelCapabilityConfig("sensenova-chat", model).text!;
        assert.equal(profile.streaming, true);
        assert.equal(profile.contextWindowTokens, context);
        assert.equal(profile.maxOutputTokens, output);
        assert.equal(profile.references.maxImages, images);
        assert.equal(profile.references.maxVideos, 0);
        assert.equal(profile.thinking?.mode, mode);
        assert.equal(profile.thinking?.default, defaultLevel);
        assert.deepEqual(profile.thinking?.levels, levels);
        assert.equal(profile.thinking?.switch.kind, "thinking-type");
        assert.equal(profile.thinking?.intensity.field, "reasoning_effort");
        const other = defaultModelCapabilityConfig("deepseek-chat", model).text!;
        assert.equal(other.contextWindowTokens, 128_000);
        assert.equal(other.references.maxImages, 0);
        assert.equal(other.thinking, undefined);
    }
    const unknown = defaultModelCapabilityConfig("sensenova-chat", "sensenova-6.8-flash-unknown").text!;
    assert.equal(unknown.contextWindowTokens, 128_000);
    assert.equal(unknown.references.maxImages, 0);
    assert.equal(unknown.thinking, undefined);
});

test("SenseNova U1.6 defaults expose only supported image controls", () => {
    const image = defaultImageCapabilityConfig("sensenova-image", "sensenova-u1.6-lite");
    assert.equal(image.references.maxImages, 5);
    assert.equal(image.references.maskSupported, false);
    assert.equal(image.maxOutputs, 1);
    assert.equal(image.quality.supported, false);
    assert.equal(image.resolution.supported, false);
    assert.equal(image.transparentBackground.supported, false);
    assert.equal(image.outputFormat.supported, true);
    assert.equal(image.responseFormat.default, "url");
    assert.equal(image.size.default, "2048x2048");
    assert.equal(image.size.allowCustom, true);
    assert.deepEqual(image.size.values, ["auto", "2048x2048", "2720x1536", "1536x2720", "1664x2496", "2496x1664", "4096x4096"]);
    image.size.values[1] = "mutated";
    assert.equal(defaultImageCapabilityConfig("sensenova-image", "sensenova-u1.6-lite").size.values[1], "2048x2048");
    assert.equal(defaultImageCapabilityConfig("openai-image", "sensenova-u1.6-lite").maxOutputs, 15);
});
