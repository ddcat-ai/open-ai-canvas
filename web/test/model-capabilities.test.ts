import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeVideoValue } from "../src/lib/model-capabilities.ts";

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

test("modelCapabilityConfigFor falls back to the channel interfaceType when a model has no per-model protocol", () => {
    // A relay channel declares newapi-channel-2 at the channel level; the H3 model
    // entry carries no per-model protocol. The effective protocol must still come
    // from the channel interfaceType so 768p/1080p is offered in the resolution picker.
    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "relay",
                    models: ["minimax_h3"],
                    interfaceType: "newapi-channel-2",
                    modelCosts: [{ model: "minimax_h3", capability: "video" }],
                },
            ],
        },
        "relay::minimax_h3",
    ).video!;

    assert.deepEqual(profile.resolutions, ["768p", "1080p"]);
    assert.equal(profile.defaultResolution, "768p");
});

test("modelCapabilityConfigFor reconciles a stale saved generic resolutions list for H3 via relay", () => {
    // A model previously saved through the model manager carried a full generic
    // capabilityConfig (480p..2160p, default 720p). H3 cannot actually serve those
    // tiers, so the merge must reconcile them back to the authoritative 768p/1080p
    // instead of letting the stale array hide 768p in the generation dropdown.
    const genericVideo = defaultModelCapabilityConfig("newapi-channel-2").video!;
    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "relay",
                    models: ["minimax_h3"],
                    interfaceType: "newapi-channel-2",
                    modelCosts: [{ model: "minimax_h3", capability: "video", protocol: "newapi-channel-2", capabilityConfig: { version: 1, video: { ...genericVideo } } }],
                },
            ],
        },
        "relay::minimax_h3",
    ).video!;

    assert.deepEqual(profile.resolutions, ["768p", "1080p"]);
    assert.equal(profile.defaultResolution, "768p");
});

test("modelCapabilityConfigFor preserves a deliberately narrowed H3 relay resolution set", () => {
    // A user who intentionally kept only 768p for an H3 model must keep that choice;
    // reconciliation only resets stale *generic* tiers, not deliberate subsets.
    const genericVideo = defaultModelCapabilityConfig("newapi-channel-2").video!;
    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "relay",
                    models: ["minimax_h3"],
                    interfaceType: "newapi-channel-2",
                    modelCosts: [
                        {
                            model: "minimax_h3",
                            capability: "video",
                            protocol: "newapi-channel-2",
                            capabilityConfig: { version: 1, video: { ...genericVideo, resolutions: ["768p"], defaultResolution: "768p" } },
                        },
                    ],
                },
            ],
        },
        "relay::minimax_h3",
    ).video!;

    assert.deepEqual(profile.resolutions, ["768p"]);
    assert.equal(profile.defaultResolution, "768p");
});

test("modelCapabilityConfigFor leaves non-H3 relay models on their saved generic tiers", () => {
    // A plain relay model that genuinely supports the generic tiers must not be
    // reconciled to 768p just because its channel is a relay.
    const genericVideo = defaultModelCapabilityConfig("newapi-channel-2").video!;
    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "relay",
                    models: ["some-video-model"],
                    interfaceType: "newapi-channel-2",
                    modelCosts: [{ model: "some-video-model", capability: "video", protocol: "newapi-channel-2", capabilityConfig: { version: 1, video: { ...genericVideo } } }],
                },
            ],
        },
        "relay::some-video-model",
    ).video!;

    assert.deepEqual(profile.resolutions, ["480p", "720p", "1080p", "1440p", "2160p"]);
    assert.equal(profile.defaultResolution, "720p");
});

test("minimax_h3 with no protocol at all still offers 768p/1080p", () => {
    // Regression: a custom channel that never picked a Provider (no interfaceType)
    // and never tagged a per-model protocol/cost must not fall through to the generic
    // 480p..2160p list. The H3 model name itself implies 768p/1080p only.
    const profile = defaultModelCapabilityConfig(undefined, "minimax_h3").video!;

    assert.deepEqual(profile.resolutions, ["768p", "1080p"]);
    assert.equal(profile.defaultResolution, "768p");
});

test("modelCapabilityConfigFor surfaces 768p/1080p for an untagged minimax_h3 channel", () => {
    // The exact user scenario: channel has models but no interfaceType and no modelCosts.
    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "mm",
                    models: ["minimax_h3"],
                    // no interfaceType, no modelCosts
                },
            ],
        },
        "mm::minimax_h3",
    ).video!;

    assert.deepEqual(profile.resolutions, ["768p", "1080p"]);
    assert.equal(profile.defaultResolution, "768p");
});

test("MiniMax H3 raises the prompt limit to the official 2000 chars", () => {
    // Hailuo H3's official prompt cap is 2000 characters; the generic video default
    // (1000) is too low and wrongly rejects long auto-generated storyboard prompts.
    // A storyboard workflow prompt of ~1006 chars must no longer be blocked.
    const profile = defaultModelCapabilityConfig("newapi-channel-2", "minimax_h3").video!;
    assert.equal(profile.references.promptMaxChars, 2000);
});

test("modelCapabilityConfigFor raises a stale saved 1000-char prompt limit to 2000 for H3", () => {
    // A channel previously persisted the generic video promptMaxChars=1000 into its
    // capabilityConfig. The merge must still raise it to the official 2000 so the
    // 1006-char storyboard prompt is not rejected on regeneration.
    const genericVideo = defaultModelCapabilityConfig("newapi-channel-2").video!;
    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "relay",
                    models: ["minimax_h3"],
                    interfaceType: "newapi-channel-2",
                    modelCosts: [{ model: "minimax_h3", capability: "video", protocol: "newapi-channel-2", capabilityConfig: { version: 1, video: { ...genericVideo } } }],
                },
            ],
        },
        "relay::minimax_h3",
    ).video!;

    assert.equal(profile.references.promptMaxChars, 2000);
});

test("non-H3 relay models keep the generic 1000-char prompt limit", () => {
    // The 2000-char bump is H3-specific and must not leak onto other video models.
    const genericVideo = defaultModelCapabilityConfig("newapi-channel-2").video!;
    assert.equal(genericVideo.references.promptMaxChars, 1000);

    const profile = modelCapabilityConfigFor(
        {
            channels: [
                {
                    id: "relay",
                    models: ["some-video-model"],
                    interfaceType: "newapi-channel-2",
                    modelCosts: [{ model: "some-video-model", capability: "video", protocol: "newapi-channel-2", capabilityConfig: { version: 1, video: { ...genericVideo } } }],
                },
            ],
        },
        "relay::some-video-model",
    ).video!;

    assert.equal(profile.references.promptMaxChars, 1000);
});
