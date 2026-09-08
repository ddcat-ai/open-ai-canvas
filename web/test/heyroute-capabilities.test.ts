import assert from "node:assert/strict";
import test from "node:test";
import { defaultImageCapabilityConfig, defaultModelCapabilityConfig, normalizeVideoValue } from "../src/lib/model-capabilities.ts";

test("Heyroute image defaults expose only effective upstream parameters", () => {
    const gpt = defaultImageCapabilityConfig("heyroute-image", "gpt-image-2");
    assert.equal(gpt.maxOutputs, 1);
    assert.equal(gpt.size.default, "1024x1024");
    assert.equal(gpt.transparentBackground.supported, false);
    const gemini = defaultImageCapabilityConfig("heyroute-image", "nano-banana-2");
    assert.equal(gemini.size.parameter, "none");
    assert.equal(gemini.quality.supported, false);
    assert.equal(defaultImageCapabilityConfig("heyroute-image", "grok-imagine-image").maxOutputs, 10);
});

test("Heyroute video presets enforce the provider-specific duration and output", () => {
    const seedance = defaultModelCapabilityConfig("heyroute-video", "seedance-2.0").video!;
    assert.deepEqual(seedance.duration.values, [15]);
    assert.equal(normalizeVideoValue(seedance, { seconds: "8" }).seconds, "15");
    const grok = defaultModelCapabilityConfig("heyroute-video", "grok-video").video!;
    assert.deepEqual(grok.duration.values, [6, 10, 15]);
    assert.deepEqual(grok.resolutions, ["720x405"]);
    assert.equal(grok.references.maxImages, 0);
});

test("Heyroute sequential protocol requires images and isolates defaults", () => {
    const first = defaultModelCapabilityConfig("heyroute-video-sequential", "seedance-2.5").video!;
    assert.equal(first.references.minImages, 1);
    assert.equal(first.references.maxVideos, 0);
    first.references.maxImages = 999;
    assert.equal(defaultModelCapabilityConfig("heyroute-video-sequential", "seedance-2.5").video!.references.maxImages, 30);
});
