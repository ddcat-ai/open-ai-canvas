import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { changeChannelModelCapability, editorSectionForField, initialChannelModelValues, updateChannelModelUpstreamCapabilities, validateChannelModelPrices, validateChannelModelProtocol } from "../src/pages/admin/components/channel-model-editor-form";
import { defaultPriceTier } from "../src/pages/admin/components/channel-model-price-tier-form";

const definition = (value: string, capability: ModelProtocolDefinition["capability"], enabled = true): ModelProtocolDefinition => ({ value, capability, enabled, label: value, create: "POST /test", contentType: "application/json", media: "url" });
const protocols = [definition("disabled-text", "text", false), definition("text", "text"), definition("image", "image"), definition("video", "video")];
const protocolsWithAudio = [...protocols, definition("audio", "audio")];

describe("channel model editor drafts", () => {
    test("new drafts select an enabled protocol and never share price state", () => {
        const first = initialChannelModelValues(null, protocols);
        first.priceTiers[0].unitPrice = 42;
        first.tags.push({ text: "限时特价", color: "purple" });
        const second = initialChannelModelValues(null, protocols);
        expect(second.protocol).toBe("text");
        expect(second.priceTiers[0].unitPrice).toBe(0);
        expect(second.modelKey).toBe("");
        expect(second.tags).toEqual([]);
    });
    test("missing catalogs do not invent a protocol", () => {
        expect(initialChannelModelValues(null, []).protocol).toBeUndefined();
        expect(() => validateChannelModelProtocol("text", "text", [])).toThrow("已启用");
    });
    test("rejects disabled, missing and capability-mismatched protocols", () => {
        for (const protocol of [undefined, "missing", "disabled-text", "image"]) {
            expect(() => validateChannelModelProtocol("text", protocol, protocols)).toThrow();
        }
        expect(() => validateChannelModelProtocol("text", "text", protocols)).not.toThrow();
    });
    test("capability changes clear old selectors but preserve money and billing units", () => {
        const draft = initialChannelModelValues(null, protocols);
        const tier = { ...defaultPriceTier("advanced"), billingMode: "per_second" as const, unitPrice: 2.5, operation: "text_to_video", resolution: "1080p", videoSeconds: 5, videoGenerateAudio: "false", imageCount: 2 };
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "video", providerModelKey: "gpt-image-2", priceTiers: [tier] }, protocols);
        expect(next.protocol).toBe("image");
        expect(next.capabilityConfig).toEqual(defaultModelCapabilityConfig("image", "gpt-image-2"));
        expect(next.priceTiers[0]).toMatchObject({ unitPrice: 2.5, billingMode: "per_second", operation: "*", resolution: "*", videoSeconds: 0, videoGenerateAudio: "*", imageCount: 0 });
        expect(tier.operation).toBe("text_to_video");
        expect(() => validateChannelModelPrices(next)).toThrow("按秒");
    });
    test("audio does not retain image/video configuration", () => {
        const draft = initialChannelModelValues(null, protocols);
        expect(changeChannelModelCapability({ ...draft, capability: "audio" }, protocols).capabilityConfig).toBeUndefined();
    });
    test("switching capability to a Midjourney protocol uses its image defaults without changing prices", () => {
        const draft = initialChannelModelValues(null, protocols);
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "cangyuan-midjourney-v7", modelKey: "midjourney-v7" }, [...protocols, definition("cangyuan-midjourney-v7", "image")]);
        expect(next.capabilityConfig?.image).toMatchObject({ references: { promptMaxChars: 4000, maxImages: 5, maskSupported: false }, maxOutputs: 1 });
        expect(next.priceTiers[0].unitPrice).toBe(0);
    });
    test("Kacang image protocol selection fills capabilities without changing prices", () => {
        for (const protocol of ["kacang-midjourney-special", "kacang-midjourney-v7", "kacang-midjourney"]) {
            const draft = initialChannelModelValues(null, protocols);
            draft.priceTiers[0].unitPrice = 12;
            const next = changeChannelModelCapability({ ...draft, capability: "image", protocol }, [definition(protocol, "image")]);
            expect(next.protocol).toBe(protocol);
            expect(next.capabilityConfig?.image?.maxOutputs).toBe(1);
            expect(next.capabilityConfig?.image?.references.maxImages).toBe(protocol === "kacang-midjourney" ? 5 : 1);
            expect(next.priceTiers[0].unitPrice).toBe(12);
            expect(updateChannelModelUpstreamCapabilities(next)).toBe(next);
        }
    });
    test("V8.2 upstream changes only retier presets and preserve administrator settings", () => {
        const draft = initialChannelModelValues(null, protocols);
        const capabilityConfig = defaultModelCapabilityConfig("cangyuan-midjourney-v82", "midjourney-1k");
        capabilityConfig.image!.references.promptMaxChars = 12000;
        capabilityConfig.image!.size.default = "6:11";
        const next = updateChannelModelUpstreamCapabilities({ ...draft, capability: "image", protocol: "cangyuan-midjourney-v82", modelKey: "midjourney-1k", providerModelKey: "midjourney-2k", capabilityConfig });
        expect(new Set(next.capabilityConfig!.image!.size.presets!.map((preset) => preset.tier))).toEqual(new Set(["2k"]));
        expect(next.capabilityConfig!.image!.size.values).toEqual(capabilityConfig.image!.size.values);
        expect(next.capabilityConfig!.image!.size.default).toBe("6:11");
        expect(next.capabilityConfig!.image!.references.promptMaxChars).toBe(12000);
        expect(next.priceTiers).toBe(draft.priceTiers);
        expect(capabilityConfig.image!.size.presets![0].tier).toBe("1k");
        expect(updateChannelModelUpstreamCapabilities(next)).toBe(next);
        const back = updateChannelModelUpstreamCapabilities({ ...next, providerModelKey: "midjourney-1k" });
        expect(back.capabilityConfig!.image!.size.presets![0].tier).toBe("1k");
    });
    test("existing model profiles retain saved custom capabilities on reopening", () => {
        const capabilityConfig = defaultModelCapabilityConfig("cangyuan-midjourney-v7", "midjourney-v7");
        capabilityConfig.image!.references.maxImages = 2;
        const item = { modelKey: "midjourney-v7", providerModelKey: "midjourney-v7", capability: "image" as const, protocol: "cangyuan-midjourney-v7", capabilityConfig, enabled: true };
        const reopened = initialChannelModelValues(item as Parameters<typeof initialChannelModelValues>[0], [definition("cangyuan-midjourney-v7", "image")]);
        expect(reopened.capabilityConfig?.image?.references.maxImages).toBe(2);
        expect(updateChannelModelUpstreamCapabilities(reopened)).toBe(reopened);
    });
    test("validation errors map to their mounted tab", () => {
        expect(editorSectionForField(["priceTiers", 2, "unitPrice"])).toBe("pricing");
        expect(editorSectionForField(["capabilityConfig"])).toBe("capabilities");
        expect(editorSectionForField(["protocol"])).toBe("identity");
    });
});

describe("pricing write validation", () => {
    const draft = initialChannelModelValues(null, protocols);
    test("accepts an explicit free/default price", () => expect(() => validateChannelModelPrices(draft)).not.toThrow());
    test("accepts audio per-second pricing", () => {
        const audioDraft = {
            ...initialChannelModelValues(null, protocolsWithAudio),
            capability: "audio" as const,
            protocol: "audio",
            priceTiers: [{ ...defaultPriceTier(), billingMode: "per_second" as const, unitPrice: 1 }],
        };
        expect(() => validateChannelModelPrices(audioDraft)).not.toThrow();
    });
    test("requires prices and exactly one or zero fallback tiers", () => {
        expect(() => validateChannelModelPrices({ ...draft, priceTiers: [] })).toThrow("至少");
        expect(() => validateChannelModelPrices({ ...draft, priceTiers: [defaultPriceTier(), defaultPriceTier()] })).toThrow("只能");
    });
    test("rejects empty or stale advanced selectors", () => {
        expect(() => validateChannelModelPrices({ ...draft, priceTiers: [defaultPriceTier("advanced")] })).toThrow("匹配条件");
        expect(() => validateChannelModelPrices({ ...draft, priceTiers: [{ ...defaultPriceTier("advanced"), operation: "text_to_video" }] })).toThrow("不匹配");
    });
    test("rejects invalid active prices rather than silently sending zero", () => {
        for (const unitPrice of [NaN, Infinity, -1, 1000001, null, undefined]) {
            expect(() => validateChannelModelPrices({ ...draft, priceTiers: [{ ...defaultPriceTier(), unitPrice: unitPrice as number }] })).toThrow("有效数值");
        }
    });
    test("saves video Token prices with newapi-channel-2 and other video protocols without changing billing units", () => {
        for (const protocol of ["newapi-channel-2", "volcengine-jimeng-video", "video"]) {
            const priceTiers = [{ ...defaultPriceTier(), billingMode: "token" as const, outputTokenPrice: 8 }];
            expect(() => validateChannelModelPrices({ ...draft, capability: "video", protocol, priceTiers })).not.toThrow();
            expect(priceTiers[0].billingMode).toBe("token");
            expect(priceTiers[0].outputTokenPrice).toBe(8);
        }
    });
    test("rejects Token pricing after switching to image or audio", () => {
        for (const capability of ["image", "audio"] as const) {
            expect(() => validateChannelModelPrices({ ...draft, capability, priceTiers: [{ ...defaultPriceTier(), billingMode: "token", outputTokenPrice: 8 }] })).toThrow("不支持 Token");
        }
    });
    test("validates all text Token prices and accepts free video Token pricing", () => {
        expect(() => validateChannelModelPrices({ ...draft, priceTiers: [{ ...defaultPriceTier(), billingMode: "token", inputTokenPrice: NaN }] })).toThrow();
        const video = { ...draft, capability: "video" as const, protocol: "volcengine-ark-video", priceTiers: [{ ...defaultPriceTier(), billingMode: "token" as const }] };
        expect(() => validateChannelModelPrices(video)).not.toThrow();
        video.priceTiers[0].outputTokenPrice = 0.000001;
        expect(() => validateChannelModelPrices(video)).not.toThrow();
    });
    test("rejects removed video conditions and accepts visible operation or resolution matches", () => {
        for (const hiddenCondition of [{ videoGenerateAudio: "false" }, { videoSeconds: 5 }, { imageCount: 2 }]) {
            expect(() => validateChannelModelPrices({ ...draft, capability: "video", protocol: "volcengine-ark-video", priceTiers: [{ ...defaultPriceTier("advanced"), billingMode: "token", ...hiddenCondition }] })).toThrow("匹配条件");
        }
        expect(() => validateChannelModelPrices({ ...draft, capability: "video", protocol: "volcengine-ark-video", priceTiers: [{ ...defaultPriceTier("advanced"), operation: "image_to_video" }] })).not.toThrow();
        expect(() => validateChannelModelPrices({ ...draft, capability: "video", protocol: "volcengine-ark-video", priceTiers: [{ ...defaultPriceTier("advanced"), resolution: "1080p" }] })).not.toThrow();
    });
});

test("admin lazy routes share a persistent boundary instead of replaying page loaders", async () => {
    const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
    const shell = await Bun.file(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url)).text();
    const pages = await Bun.file(new URL("../src/pages/admin/admin-route-pages.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text();
    const admin = router.slice(router.indexOf('path: "/admin"'), router.indexOf('{ path: "*"'));
    expect(admin.match(/deferred\(/g)).toHaveLength(1);
    expect(shell).toMatch(/<Suspense[^]*?<Outlet \/>\s*<\/Suspense>/);
    expect(pages).not.toContain("<Suspense");
    expect(css).not.toContain("admin-page-enter");
});
