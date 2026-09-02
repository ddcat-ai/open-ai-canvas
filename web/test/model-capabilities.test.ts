import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { defaultModelCapabilityConfig, normalizeVideoValue } from "../src/lib/model-capabilities.ts";

test("switching to MiniMax H3 replaces an unsupported 720p value with 768P", () => {
    const profile = defaultModelCapabilityConfig("minimax-video", "MiniMax-H3").video!;

    assert.deepEqual(normalizeVideoValue(profile, { seconds: "11", ratio: "16:9", resolution: "720" }), {
        seconds: "11",
        ratio: "16:9",
        resolution: "768P",
    });
});

test("MiniMax H3 routed via a NewAPI relay is pinned to 768p/1080p and defaults to 768p", () => {
    const profile = defaultModelCapabilityConfig("newapi-channel-2", "minimax_h3").video!;

    assert.deepEqual(profile.resolutions, ["768p", "1080p"]);
    assert.equal(profile.defaultResolution, "768p");
    // 15s enum duration keeps longer 768p shots valid (1080p/2K caps at ~8s).
    assert.equal(profile.duration.selection, "enum");
});

test("NewAPI relay defaults to the generic tier list when the model name does not match H3", () => {
    const generic = defaultModelCapabilityConfig("newapi-channel-2").video!;
    assert.deepEqual(generic.resolutions, ["480p", "720p", "1080p", "1440p", "2160p"]);
    assert.equal(generic.defaultResolution, "720p");

    const otherModel = defaultModelCapabilityConfig("newapi-channel-2", "some-other-video-model").video!;
    assert.deepEqual(otherModel.resolutions, ["480p", "720p", "1080p", "1440p", "2160p"]);
});

test("H3 spellings all route to the relay 768p/1080p override", () => {
    for (const name of ["MiniMax-H3", "MiniMax_H3", "hailuo-h3", "hailuo-3", "minimax_h3"]) {
        const profile = defaultModelCapabilityConfig("newapi", name).video!;
        assert.deepEqual(profile.resolutions, ["768p", "1080p"], `expected override for ${name}`);
        assert.equal(profile.defaultResolution, "768p", `expected 768p default for ${name}`);
    }
});
