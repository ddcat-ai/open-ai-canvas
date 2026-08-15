import { describe, expect, test } from "bun:test";

import {
    buildImageResolutionOptions,
    formatImageResolutionSize,
    imageResolutionChoices,
    imageResolutionOption,
    imageSizeForResolution,
    supportsImageResolutionPresets,
} from "../src/lib/image-resolution-tiers";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";

const sizes = [
    "1024x1024", "1360x1024", "1024x1360", "1536x1024", "1024x1536", "1024x1280", "1280x1024", "2048x878", "1824x1024", "1024x1824",
    "2048x2048", "2304x1728", "1728x2304", "2496x1664", "1664x2496", "1792x2240", "2240x1792", "3136x1344", "2752x1536", "1536x2752",
    "2880x2880", "3264x2448", "2448x3264", "3504x2336", "2336x3504", "2560x3200", "3200x2560", "3808x1632", "3840x2160", "2160x3840",
];

describe("image resolution tiers", () => {
    test("将 Xiaobaishu 的精确尺寸整理为 1K、2K、4K 各十种比例", () => {
        const options = buildImageResolutionOptions(sizes);

        expect(options.filter((item) => item.tier === "1k")).toHaveLength(10);
        expect(options.filter((item) => item.tier === "2k")).toHaveLength(10);
        expect(options.filter((item) => item.tier === "4k")).toHaveLength(10);
        expect(imageResolutionOption(options, "1536x2752")).toMatchObject({ tier: "2k", ratio: "9:16" });
    });

    test("切换档位时按相同比例还原精确像素并显示比例与档位", () => {
        const options = buildImageResolutionOptions(sizes);

        expect(imageSizeForResolution(options, "4k", "9:16")).toBe("2160x3840");
        expect(formatImageResolutionSize("1536x2752", options)).toBe("9:16 · 2K");
    });

    test("保留自动尺寸并在摘要中显示中文标签", () => {
        const values = ["auto", ...sizes];

        expect(imageResolutionChoices(values)).toEqual(["auto", "1k", "2k", "4k"]);
        expect(buildImageResolutionOptions(values)).toHaveLength(30);
        expect(formatImageResolutionSize("auto", [])).toBe("自动");
    });

    test("允许自定义尺寸时仍保留自动与分辨率预设", () => {
        expect(supportsImageResolutionPresets({ parameter: "size", values: ["auto", ...sizes], allowCustom: true })).toBe(true);
    });

    test("默认图片能力为 OpenAI 兼容模型提供完整 1K、2K、4K 档位", () => {
        const profile = defaultImageCapabilityConfig("openai-image", "gpt-image-2-4K");

        expect(supportsImageResolutionPresets(profile.size)).toBe(true);
        expect(imageResolutionChoices(profile.size.values)).toEqual(["auto", "1k", "2k", "4k"]);
        expect(buildImageResolutionOptions(profile.size.values)).toHaveLength(30);
    });

    test("识别适合全景图的 2:1 自定义尺寸", () => {
        const options = buildImageResolutionOptions(["1440x720", "2048x1024", "3840x1920"]);

        expect(options.map((item) => item.tier)).toEqual(["1k", "2k", "4k"]);
        expect(imageResolutionOption(options, "3840x1920")).toMatchObject({ tier: "4k", ratio: "2:1" });
    });
});
