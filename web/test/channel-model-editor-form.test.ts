import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { changeChannelModelCapability, editorSectionForField, initialChannelModelValues, validateChannelModelPrices, validateChannelModelProtocol } from "../src/pages/admin/components/channel-model-editor-form";
import { defaultPriceTier } from "../src/pages/admin/components/channel-model-price-tier-form";

const definition = (value: string, capability: ModelProtocolDefinition["capability"], enabled = true): ModelProtocolDefinition => ({ value, capability, enabled, label: value, create: "POST /test", contentType: "application/json", media: "url" });
const protocols = [definition("disabled-text", "text", false), definition("text", "text"), definition("image", "image"), definition("video", "video")];

describe("channel model editor drafts", () => {
    test("new drafts select an enabled protocol and never share price state", () => {
        const first = initialChannelModelValues(null, protocols);
        first.priceTiers[0].unitPrice = 42;
        const second = initialChannelModelValues(null, protocols);
        expect(second.protocol).toBe("text");
        expect(second.priceTiers[0].unitPrice).toBe(0);
        expect(second.modelKey).toBe("");
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
        const tier = { ...defaultPriceTier("advanced"), billingMode: "per_second" as const, unitPrice: 2.5, operation: "text_to_video", resolution: "1080p", videoSeconds: 5, imageCount: 2 };
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "video", providerModelKey: "gpt-image-2", priceTiers: [tier] }, protocols);
        expect(next.protocol).toBe("image");
        expect(next.capabilityConfig).toEqual(defaultModelCapabilityConfig("image", "gpt-image-2"));
        expect(next.priceTiers[0]).toMatchObject({ unitPrice: 2.5, billingMode: "per_second", operation: "*", resolution: "*", videoSeconds: 0, imageCount: 0 });
        expect(tier.operation).toBe("text_to_video");
        expect(() => validateChannelModelPrices(next)).toThrow("按秒");
    });
    test("audio does not retain image/video configuration", () => {
        const draft = initialChannelModelValues(null, protocols);
        expect(changeChannelModelCapability({ ...draft, capability: "audio" }, protocols).capabilityConfig).toBeUndefined();
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
    test("a new protocol cannot silently convert Token pricing to per request", () => {
        expect(() => validateChannelModelPrices({ ...draft, capability: "video", protocol: "video", priceTiers: [{ ...defaultPriceTier(), billingMode: "token", outputTokenPrice: 8 }] })).toThrow("不支持 Token");
    });
    test("validates all text Token prices and the video Token minimum", () => {
        expect(() => validateChannelModelPrices({ ...draft, priceTiers: [{ ...defaultPriceTier(), billingMode: "token", inputTokenPrice: NaN }] })).toThrow();
        const video = { ...draft, capability: "video" as const, protocol: "volcengine-ark-video", priceTiers: [{ ...defaultPriceTier(), billingMode: "token" as const }] };
        expect(() => validateChannelModelPrices(video)).toThrow("至少为");
        video.priceTiers[0].outputTokenPrice = 0.000001;
        expect(() => validateChannelModelPrices(video)).not.toThrow();
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
