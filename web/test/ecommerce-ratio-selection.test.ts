import { describe, expect, test } from "bun:test";
import { commerceAutoRatio, displayImageSizeChoices, imageSizeLabel, resolveAutoImageSize, supportedImageSize } from "../src/pages/ecommerce/catalog";
import { automaticMarketingSelections, parseMarketingSelections } from "../src/pages/ecommerce/marketing-materials";
import { emptyEcommerceDraft } from "../src/services/api/ecommerce";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { commerceImageParameters } from "../src/pages/ecommerce/workflow";

describe("ecommerce ratio selection", () => {
    test("selected ratios reach generation unchanged, including 9:16 alongside 2:3", () => {
        const profile = defaultModelCapabilityConfig().image!;
        profile.size.values = ["1024x1824", "1024x1536", "1824x1024", "1024x1024"];
        profile.parameters = undefined;
        for (const size of profile.size.values) {
            const request = commerceImageParameters(profile, size, "1k");
            expect(request.size).toBe(size);
            // The workbench task API rejects unknown parameter keys.
            expect(Object.keys(request).sort()).toEqual(["count", "imageResolution", "quality", "size"]);
        }
        profile.size.values = ["9:16", "2:3", "16:9", "1:1"];
        for (const size of profile.size.values) expect(commerceImageParameters(profile, size, "1k").size).toBe(size);
    });
    test("shows only aspect ratios for model dimensions", () => {
        expect(imageSizeLabel("1024x1024")).toBe("1:1");
        expect(imageSizeLabel("1024x1824")).toBe("9:16");
        expect(imageSizeLabel("2048x878")).toBe("21:9");
        expect(imageSizeLabel("16:9")).toBe("16:9");
    });

    test("deduplicates visible choices while preserving a supported model value", () => {
        const values = ["1024x1024", "2048x2048", "1024x1824", "1536x2752"];
        expect(displayImageSizeChoices(values, "2048x2048")).toEqual([
            { label: "1:1", value: "2048x2048" },
            { label: "9:16", value: "1536x2752" },
        ]);
        expect(supportedImageSize("3:4", values)).toBe("1024x1024");
    });

    test("uses each material's preferred ratio and a real supported size", () => {
        const values = ["1024x1024", "1024x1824", "1824x1024"];
        expect(
            automaticMarketingSelections(
                [
                    { id: "market-long", count: 2, ratio: "1024x1024" },
                    { id: "market-kv", count: 1, ratio: "1024x1024" },
                ],
                values,
                "1024x1024",
            ),
        ).toEqual([
            { id: "market-long", count: 2, ratio: "1024x1824" },
            { id: "market-kv", count: 1, ratio: "1824x1024" },
        ]);
    });

    test("keeps selections within one material category and starts a new draft at one image", () => {
        const draft = emptyEcommerceDraft();
        expect(draft.count).toBe(1);
        draft.typeOptions = {
            materialPlan: JSON.stringify([
                { id: "market-poster", count: 2, ratio: "3:4" },
                { id: "social-post", count: 1, ratio: "3:4" },
                { id: "market-long", count: 1, ratio: "9:16" },
            ]),
        };
        expect(parseMarketingSelections(draft).map(({ id }) => id)).toEqual(["market-poster", "market-long"]);
    });

    test("shows every distinct ratio supported by the selected model", () => {
        const gptSizes = ["auto", "1024x1024", "1360x1024", "1024x1360", "1824x1024", "1024x1824", "2048x878", "1536x1024", "1024x1536", "1024x1280", "1280x1024", "2048x2048"];
        expect(displayImageSizeChoices(gptSizes).map(({ label }) => label)).toEqual(["自动", "1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "4:5", "5:4"]);
        expect(displayImageSizeChoices(["1:1", "4:3", "9:16"]).map(({ label }) => label)).toEqual(["1:1", "4:3", "9:16"]);
    });

    test("自动 stands for the platform and type recommendation", () => {
        for (const platform of ["xiaohongshu", "douyin", "kuaishou"]) for (const type of ["main", "set", "detail", "scene", "white"]) expect(commerceAutoRatio(platform, type)).toBe("3:4");
        for (const platform of ["taobao", "tmall", "jd", "pdd", "1688"]) {
            for (const type of ["main", "set", "single", "white", "sku"]) expect(commerceAutoRatio(platform, type)).toBe("1:1");
            expect(commerceAutoRatio(platform, "detail")).toBe("3:4");
            expect(commerceAutoRatio(platform, "scene")).toBeUndefined();
        }
        for (const platform of ["amazon", "ebay", "walmart", "aliexpress"]) {
            for (const type of ["main", "set", "secondary", "white", "sku", "scene"]) expect(commerceAutoRatio(platform, type)).toBe("1:1");
            expect(commerceAutoRatio(platform, "amazon-a-plus")).toBeUndefined();
            expect(commerceAutoRatio(platform, "detail")).toBeUndefined();
        }
        // Marketing keeps its material slots, banners and unlisted platforms keep the model's own choice.
        expect(commerceAutoRatio("xiaohongshu", "marketing")).toBeUndefined();
        expect(commerceAutoRatio("taobao", "single", "Banner")).toBeUndefined();
        expect(commerceAutoRatio("temu", "main")).toBeUndefined();
        expect(commerceAutoRatio("shopify", "detail")).toBeUndefined();
    });

    test("自动 resolves only to a size the selected model supports", () => {
        const gptSizes = ["auto", "1024x1024", "1360x1024", "1024x1360", "1824x1024", "1024x1824", "1536x1024", "1024x1536", "2048x2048"];
        expect(resolveAutoImageSize("auto", gptSizes, "taobao", "main")).toBe("1024x1024");
        expect(resolveAutoImageSize("auto", gptSizes, "taobao", "detail")).toBe("1024x1360");
        expect(resolveAutoImageSize("auto", gptSizes, "xiaohongshu", "set")).toBe("1024x1360");
        expect(resolveAutoImageSize("auto", gptSizes, "douyin", "detail")).toBe("1024x1360");
        expect(resolveAutoImageSize("auto", gptSizes, "amazon", "set")).toBe("1024x1024");
        expect(resolveAutoImageSize("auto", ["auto", "1:1", "3:4", "9:16"], "pdd", "detail")).toBe("3:4");
        // No recommendation, or no supported size with that exact ratio: the model keeps choosing as before.
        expect(resolveAutoImageSize("auto", gptSizes, "amazon", "detail")).toBe("auto");
        expect(resolveAutoImageSize("auto", gptSizes, "temu", "main")).toBe("auto");
        expect(resolveAutoImageSize("auto", ["auto", "1024x1024", "1536x1024"], "xiaohongshu", "main")).toBe("auto");
        expect(resolveAutoImageSize("auto", ["auto"], "taobao", "main")).toBe("auto");
        // An explicit choice is never changed.
        expect(resolveAutoImageSize("1024x1536", gptSizes, "taobao", "main")).toBe("1024x1536");
        expect(resolveAutoImageSize("16:9", ["16:9", "1:1"], "xiaohongshu", "main")).toBe("16:9");
    });
});
