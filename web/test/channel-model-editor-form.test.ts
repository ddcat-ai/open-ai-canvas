import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import {
    changeChannelModelCapability,
    changeChannelModelProtocol,
    duplicateChannelModelValues,
    editorSectionForField,
    initialChannelModelValues,
    updateChannelModelUpstreamCapabilities,
    validateChannelModelPrices,
    validateChannelModelProtocol,
} from "../src/pages/admin/components/channel-model-editor-form";
import { defaultPriceTier, skuSelectorFromForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import type { ChannelModel, ChannelModelPriceTier } from "../src/services/api/wallet";
import { projectImageParameters, resolveImageParameters, type ImageParameter } from "../src/lib/image-parameters";

const definition = (value: string, capability: ModelProtocolDefinition["capability"], enabled = true): ModelProtocolDefinition => ({ value, capability, enabled, label: value, create: "POST /test", contentType: "application/json", media: "url" });

for (const shape of ["nil", "empty", "missing-size", "missing-encoding"] as const) {
    for (const pixelsToRatio of [true, false]) {
        test(`${shape} 参数声明，${pixelsToRatio ? "像素转比例" : "比例转像素"} 按目标端点编码并保留能力和价格`, () => {
            const size = pixelsToRatio ? "2560x1440" : "16:9";
            const encoding = pixelsToRatio ? "ratio" : "pixels";
            const fields: ImageParameter[] = [
                { name: "size", label: "尺寸", type: "string", encoding: pixelsToRatio ? "pixels" : "ratio", values: [size], default: size, pricing: true },
                { name: "imageResolution", label: "分辨率", type: "string", values: ["2k"], default: "2k", pricing: true },
            ];
            const profile = defaultModelCapabilityConfig("openai-image", "fixture");
            profile.image = projectImageParameters(profile.image!, fields);
            profile.image.size.presets = [{ tier: "2k", ratio: "16:9", size: "2560x1440", width: 2560, height: 1440 }];
            profile.image.references.maxImageBytes = 10 * 1024 * 1024;
            const target = {
                ...definition("opaque-target", "image"),
                create: pixelsToRatio ? "POST /v1beta/models/{model}:generateContent" : "POST /v1/images/generations",
                imageParameters: shape === "nil" ? undefined : shape === "empty" ? [] : shape === "missing-encoding" ? [{ ...fields[0], encoding: undefined }, fields[1]] : [fields[1]],
            };
            const values = {
                ...initialChannelModelValues(null, []),
                capability: "image" as const,
                protocol: "source",
                modelKey: "fixture",
                capabilityConfig: profile,
                priceTiers: [{ ...defaultPriceTier("advanced"), unitPrice: 12, imageSelector: { size, imageResolution: "2k" } }],
            };
            const next = changeChannelModelProtocol(values, target.value, [target]);
            expect(next.capabilityConfig!.image!.parameters!.find((p) => p.name === "size")!.encoding).toBe(encoding);
            expect(next.capabilityConfig!.image!.size.values).toEqual([size]);
            expect(next.capabilityConfig!.image!.size.default).toBe(size);
            expect(next.capabilityConfig!.image!.size.presets).toEqual(profile.image.size.presets);
            expect(next.capabilityConfig!.image!.references.maxImageBytes).toBe(10 * 1024 * 1024);
            expect(next.priceTiers).toEqual(values.priceTiers);
            expect(skuSelectorFromForm("image", next.priceTiers[0], next.capabilityConfig)).toEqual(values.priceTiers[0].imageSelector);
            // Repeated component projection must retain the resolved wire encoding.
            expect(resolveImageParameters(next.capabilityConfig!.image!, target.imageParameters || [], "fixture", target.value).parameters!.find((p) => p.name === "size")!.encoding).toBe(encoding);
            const legacy = structuredClone(values);
            delete legacy.capabilityConfig.image!.parameters;
            expect(changeChannelModelProtocol(legacy, target.value, [target]).capabilityConfig!.image!.parameters!.find((p) => p.name === "size")!.encoding).toBe(encoding);
        });
    }
}

test("切换兼容图片协议保留能力、引用限制与价格选择器", async () => {
    const profile = defaultModelCapabilityConfig("openai-image", "fixture-model");
    profile.image = projectImageParameters(profile.image!, [
        { name: "size", label: "尺寸", type: "string", encoding: "pixels", values: ["16:9"], default: "16:9", pricing: true },
        { name: "imageResolution", label: "分辨率", type: "string", values: ["2k"], default: "2k", pricing: true },
        { name: "quality", label: "质量", type: "string", values: ["xhigh"], default: "xhigh", pricing: true },
        { name: "count", label: "张数", type: "integer", min: 1, max: 4, default: 1 },
        { name: "responseFormat", label: "响应格式", type: "string", values: ["url"], default: "url", enabled: false },
    ]);
    profile.image.size.presets = [{ tier: "2k", ratio: "16:9", size: "2752x1536", width: 2752, height: 1536 }];
    const manifest = await Bun.file(new URL("../../plugin-packages/openai-images/manifest.json", import.meta.url)).json();
    profile.image.references.maxImageBytes = 10 * 1024 * 1024;
    profile.image.maxOutputs = 4;
    const values = {
        ...initialChannelModelValues(null, []),
        capability: "image" as const,
        protocol: "custom-source-image",
        modelKey: "fixture-model",
        providerModelKey: "fixture-upstream-model",
        capabilityConfig: profile,
        priceTiers: [{ ...defaultPriceTier("advanced"), unitPrice: 12, imageSelector: { imageResolution: "2k", quality: "xhigh", size: "16:9" } }],
    };
    const next = changeChannelModelProtocol(values, "custom-target-image", [{ ...definition("custom-target-image", "image"), create: "POST /v1/images/generations", imageParameters: manifest.contributes.providers[0].imageParameters }]);
    expect(next.capabilityConfig!.image!.references.maxImageBytes).toBe(10 * 1024 * 1024);
    expect(next.capabilityConfig!.image!.maxOutputs).toBe(4);
    expect(next.capabilityConfig!.image!.size.presets).toEqual(profile.image.size.presets);
    expect(next.capabilityConfig!.image!.parameters!.find((p) => p.name === "quality")!.values).toContain("xhigh");
    expect(next.capabilityConfig!.image!.parameters!.find((p) => p.name === "responseFormat")!.enabled).toBe(false);
    expect(next.priceTiers).toEqual(values.priceTiers);
    expect(skuSelectorFromForm("image", next.priceTiers[0], next.capabilityConfig)).toEqual(values.priceTiers[0].imageSelector);
    const legacy = structuredClone(values);
    delete legacy.capabilityConfig.image!.parameters;
    legacy.priceTiers = [{ ...defaultPriceTier("advanced"), unitPrice: 12, imageResolution: "2k", quality: "xhigh", size: "16:9" }];
    const migrated = changeChannelModelProtocol(legacy, "custom-target-image", [{ ...definition("custom-target-image", "image"), create: "POST /v1/images/generations", imageParameters: manifest.contributes.providers[0].imageParameters }]);
    expect(skuSelectorFromForm("image", migrated.priceTiers[0], migrated.capabilityConfig)).toEqual({ imageResolution: "2k", quality: "xhigh", size: "16:9" });
    const pixel = structuredClone(values);
    Object.assign(
        pixel.capabilityConfig.image!.parameters!.find((p: { name: string }) => p.name === "size")!,
        { values: ["2752x1536"], default: "2752x1536" },
    );
    pixel.priceTiers[0].imageSelector.size = "2752x1536";
    const gemini = await Bun.file(new URL("../../plugin-packages/google-gemini-image/manifest.json", import.meta.url)).json();
    const ratio = changeChannelModelProtocol(pixel, "gemini-image", [{ ...definition("gemini-image", "image"), imageParameters: gemini.contributes.providers[0].imageParameters }]);
    expect(ratio.capabilityConfig!.image!.size.parameter).toBe("size");
    expect(ratio.capabilityConfig!.image!.size.values).toEqual(["2752x1536"]);
    expect(ratio.capabilityConfig!.image!.size.presets).toContainEqual(profile.image.size.presets.find((p: { size: string }) => p.size === "2752x1536"));
    expect(ratio.priceTiers).toEqual(pixel.priceTiers);
    expect(ratio.capabilityConfig!.image!.maxOutputs).toBe(4);
});

test("仅切换视频协议保留显式能力和已有价格", () => {
    const config = defaultModelCapabilityConfig("agnes-video", "agnes-video-2.5");
    config.video!.references.maxImages = 1;
    config.video!.duration.default = 8;
    const values = { ...initialChannelModelValues(null, []), capability: "video" as const, capabilityConfig: config, protocol: "agnes-video" };
    const next = changeChannelModelProtocol(values, "newapi", [definition("newapi", "video")]);
    expect(next.capabilityConfig).toEqual(config);
    expect(next.priceTiers).toEqual(values.priceTiers);
});
const protocols = [definition("disabled-text", "text", false), definition("text", "text"), definition("image", "image"), definition("video", "video")];
const protocolsWithAudio = [...protocols, definition("audio", "audio")];

describe("channel model editor drafts", () => {
    test("new drafts use 未分类 and imported drafts display the upstream ID without overwriting custom names", () => {
        expect(initialChannelModelValues(null, protocols).displayName).toBe("未分类");
        const imported = { modelKey: "product-id", providerModelKey: "upstream-id", displayName: "未分类", channelLabel: "", priceTiers: [] } as unknown as ChannelModel;
        expect(initialChannelModelValues(imported, protocols)).toMatchObject({ displayName: "未分类", channelLabel: "upstream-id" });
        expect(initialChannelModelValues({ ...imported, displayName: "product-id", channelLabel: "手动命名" }, protocols)).toMatchObject({ displayName: "product-id", channelLabel: "手动命名" });
    });
    test("Kemei Seedream selection initializes the image profile and preserves pricing", () => {
        const draft = initialChannelModelValues(null, protocols);
        draft.priceTiers[0].unitPrice = 19;
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "km-kemei-seedream", modelKey: "doubao-seedream-5-0-pro-260628" }, [definition("km-kemei-seedream", "image")]);
        expect(next.capabilityConfig?.image).toMatchObject({ references: { maxImages: 10, maskSupported: false }, maxOutputs: 1, size: { default: "2048x2048" } });
        expect(next.priceTiers[0].unitPrice).toBe(19);
    });
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
    test("duplicate drafts clear model IDs and inherited tier IDs while preserving custom routing and configuration", () => {
        const tier = (id: string, providerModelKey: string, unitPriceMicrocredits: number): ChannelModelPriceTier => ({
            id,
            channelModelId: "source-id",
            selector: {},
            selectorKey: "{}",
            resolution: "*",
            videoSeconds: 0,
            providerModelKey,
            billingMode: "fixed_request",
            unitPriceMicrocredits,
            inputTokenPriceMicrocredits: 0,
            outputTokenPriceMicrocredits: 0,
            cachedTokenPriceMicrocredits: 0,
            priceConfigured: true,
            enabled: true,
            priceVersion: 1,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
        });
        const item: ChannelModel = {
            id: "source-id",
            channelId: "channel-id",
            modelKey: "product-video",
            providerModelKey: "models/vendor-video",
            displayName: "视频模型组",
            channelLabel: "原渠道",
            tags: [{ text: "稳定", color: "green" }],
            description: "视频生成配置",
            icon: "",
            capability: "video",
            protocol: "video",
            billingMode: "fixed_request",
            unitPriceMicrocredits: 1_000_000,
            inputTokenPriceMicrocredits: 0,
            outputTokenPriceMicrocredits: 0,
            cachedTokenPriceMicrocredits: 0,
            priceConfigured: true,
            enabled: false,
            priceVersion: 1,
            priceTiers: [tier("default-tier", "vendor-video", 5_000_000), tier("custom-tier", "vendor-video-hq", 8_000_000)],
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
        };

        const draft = duplicateChannelModelValues(item, protocols);

        expect(draft).toMatchObject({
            modelKey: "",
            providerModelKey: "",
            displayName: "视频模型组",
            channelLabel: "原渠道",
            tags: [{ text: "稳定", color: "green" }],
            description: "视频生成配置",
            capability: "video",
            protocol: "video",
            enabled: false,
            priceTiers: [
                { providerModelKey: "", unitPrice: 5 },
                { providerModelKey: "vendor-video-hq", unitPrice: 8 },
            ],
        });
        expect(draft.tags).not.toBe(item.tags);
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
    test("requires reference video prices only when reference video billing is enabled", () => {
        const video = { ...draft, capability: "video" as const, protocol: "volcengine-ark-video" };
        const perSecond = [{ ...defaultPriceTier(), billingMode: "per_second" as const, unitPrice: 1 }];
        const token = [{ ...defaultPriceTier(), billingMode: "token" as const, outputTokenPrice: 16 }];
        expect(draft.referenceVideoBilling).toBe(false);
        expect(() => validateChannelModelPrices({ ...video, priceTiers: perSecond })).not.toThrow();
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: perSecond })).toThrow("带参考视频");
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: token })).toThrow("带参考视频");
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: [{ ...perSecond[0], referenceVideoUnitPrice: 2 }] })).not.toThrow();
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: [{ ...token[0], referenceVideoOutputTokenPrice: 32 }] })).not.toThrow();
        // 配置了成本价的档也要填写带参考视频成本价；未配置成本时不要求。
        const pricedPerSecond = { ...perSecond[0], referenceVideoUnitPrice: 2, costConfigured: true, costUnitPrice: 0.5 };
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: [pricedPerSecond] })).toThrow("带参考视频的成本价");
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: [{ ...pricedPerSecond, costReferenceVideoUnitPrice: 0.8 }] })).not.toThrow();
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: false, priceTiers: [pricedPerSecond] })).not.toThrow();
        // 免费档和非视频模型不要求带参考视频价格。
        expect(() => validateChannelModelPrices({ ...video, referenceVideoBilling: true, priceTiers: [{ ...defaultPriceTier(), billingMode: "per_second" as const }] })).not.toThrow();
        expect(() => validateChannelModelPrices({ ...draft, capability: "audio", referenceVideoBilling: true, priceTiers: perSecond })).not.toThrow();
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
