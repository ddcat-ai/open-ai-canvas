import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePicker } from "../src/components/image-size-picker";
import { applyImageSizeSelection } from "../src/components/image-settings-panel";
import { ImageSizePresetsEditor } from "../src/components/image-size-presets-editor";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultImageCapabilityConfig, normalizeImageValue, normalizeModelCapabilityConfig } from "../src/lib/model-capabilities";
import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, imagePresetForRatio, imagePresetValue, imageQualityForSelection, imageQualityForTier, imageSizeConfigWithPresets, imageSizePresets, imageTierAvailable } from "../src/lib/image-size-presets";
import { buildImageResolutionOptions } from "../src/lib/image-resolution-tiers";
import { resolveImageRequestSize, validateImageSize } from "../src/services/api/image-validation";
import { buildGeminiImageGenerationConfig } from "../src/lib/gemini-image";

describe("统一图片分辨率与宽高比", () => {
    test("默认 Gemini 质量枚举不能把未启用的 1K 显示出来", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "nano-banana-pro-4k");
        profile.size = imageSizeConfigWithPresets(profile, IMAGE_RATIOS.map((ratio) => imagePresetForRatio("4k", ratio)));
        expect(profile.quality.supported).toBe(true);
        expect(imageTierAvailable(profile, "4k")).toBe(true);
        expect(imageTierAvailable(profile, "1k")).toBe(false);
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" quality="high" onChange={() => {}} />);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>1K/);
    });

    test("无质量参数的固定 4K 模型保留管理员档位，重开及自定义比例不回退 1K", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "nano-banana-pro-4k");
        profile.quality = { supported: false, values: [], default: "auto" };
        profile.size = imageSizeConfigWithPresets(profile, IMAGE_RATIOS.map((ratio) => imagePresetForRatio("4k", ratio)));
        expect(imageTierAvailable(profile, "4k")).toBe(true);
        expect(imageTierAvailable(profile, "1k")).toBe(false);
        expect(imageQualityForTier(profile, "4k")).toBeUndefined();
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" onChange={() => {}} />);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>[12]K/);
        expect(picker).toContain("3840 × 2160 px");
        expect(normalizeImageValue(profile, { size: "16:9", quality: "auto" }).quality).toBe("4k");
        expect(resolveImageRequestSize(profile, undefined, "16:9")).toEqual({ parameter: "aspect_ratio", value: "16:9" });
        profile.size.allowCustom = true;
        const custom = renderToStaticMarkup(<ImageSizePicker profile={profile} size="17:11" onChange={() => {}} />);
        expect(custom).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(custom).toContain("17:11 ·");
    });

    test("无质量参数时管理员启用的 1K 和 4K 都对用户开放，未启用的 2K 仍隐藏", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "test");
        profile.quality = { supported: false, values: [], default: "auto" };
        profile.size = imageSizeConfigWithPresets(profile, [...IMAGE_RATIOS.flatMap((ratio) => [imagePresetForRatio("1k", ratio), imagePresetForRatio("4k", ratio)])]);
        expect(imageTierAvailable(profile, "1k")).toBe(true);
        expect(imageTierAvailable(profile, "4k")).toBe(true);
        expect(imageTierAvailable(profile, "2k")).toBe(false);
        expect(imageQualityForSelection(profile, "4k")).toBe("4k");
        expect(normalizeImageValue(profile, { size: "16:9", quality: "4k" }).quality).toBe("4k");
        expect(buildGeminiImageGenerationConfig("16:9", "4k").imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "4K" });
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" onChange={() => {}} />);
        expect(picker).toMatch(/<button[^>]*>1K/);
        expect(picker).toMatch(/<button[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>2K/);
        expect(picker).not.toContain("当前协议未配置独立分辨率");
        const selected = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" quality="4k" onChange={() => {}} />);
        expect(selected).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(selected).not.toMatch(/aria-pressed="true"[^>]*>1K/);
        expect(selected).toContain("3840 × 2160 px");
        const editor = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} onChange={() => {}} />);
        expect(editor).not.toContain("需先配置此档位对应的质量值，用户端才会开放。");
    });

    test("真实图片质量字段不被分辨率预设推断覆盖", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "test");
        profile.quality = { supported: true, values: ["auto", "low", "medium", "high"], default: "auto" };
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("2k", "16:9"), imagePresetForRatio("4k", "16:9")]);
        expect(normalizeImageValue(profile, { size: "16:9", quality: "auto" }).quality).toBe("auto");
        expect(normalizeImageValue(profile, { size: "16:9", quality: "high" }).quality).toBe("high");
    });

    test("比例协议切换 4K 时同时提交尺寸和真实质量档位", () => {
        const changes: Array<[string, string]> = [];
        applyImageSizeSelection((key, value) => changes.push([key, value]), "16:9", "high");
        expect(changes).toEqual([["size", "16:9"], ["quality", "high"]]);
    });

    test("像素协议从旧比例配置切换 4K 后发送真实像素，不回退到 1K", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = { parameter: "size", values: ["16:9"], default: "16:9", allowCustom: true };
        const value = imagePresetValue(profile, imagePresetForRatio("4k", "16:9"));
        expect(value).toBe("3840x2160");
        expect(resolveImageRequestSize(profile, "auto", value)).toEqual({ parameter: "size", value: "3840x2160" });
        const legacy = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" onChange={() => {}} />);
        expect(legacy).toContain("1824 × 1024 px");
        const reopened = renderToStaticMarkup(<ImageSizePicker profile={profile} size="3840x1920" onChange={() => {}} />);
        expect(reopened).not.toMatch(/<button[^>]*>4K/);
        expect(reopened).toContain("2:1 · 3840 × 1920 px");
    });

    test("常用比例保持明确尺寸，等价比例归一", () => {
        expect(imagePresetForRatio("1k", "16:9").size).toBe("1824x1024");
        expect(imagePresetForRatio("4k", "9:16").size).toBe("2160x3840");
        expect(imagePresetForRatio("1k", "32：18")).toEqual(imagePresetForRatio("1k", "16:9"));
        expect(imagePresetForRatio("2k", "7:3").ratio).toBe("21:9");
        expect(imagePresetForRatio("2k", "34:22").ratio).toBe("17:11");
    });

    test("三档预设与任意合理比例都满足像素范围", () => {
        for (const tier of IMAGE_RESOLUTIONS)
            for (const ratio of [...IMAGE_RATIOS, "17:11", "3:1", "1:3", "99999:99998"]) {
                const preset = imagePresetForRatio(tier, ratio);
                expect(() => validateImageSize(preset.width, preset.height, false)).not.toThrow();
            }
        for (const ratio of ["0:9", "4:1", "1:4", "NaN:1", "1.5:1", "999999999:1"]) {
            expect(() => imagePresetForRatio("1k", ratio)).toThrow();
        }
    });

    test("固定比例编辑器包含 4:5 和 5:4 三档尺寸", () => {
        expect(IMAGE_RATIOS).toContain("4:5");
        expect(IMAGE_RATIOS).toContain("5:4");
        expect(imagePresetForRatio("1k", "4:5").size).toBe("1024x1280");
        expect(imagePresetForRatio("2k", "4:5").size).toBe("1792x2240");
        expect(imagePresetForRatio("4k", "4:5").size).toBe("2560x3200");
        expect(imagePresetForRatio("1k", "5:4").size).toBe("1280x1024");
        expect(imagePresetForRatio("2k", "5:4").size).toBe("2240x1792");
        expect(imagePresetForRatio("4k", "5:4").size).toBe("3200x2560");
    });

    test("管理员设置同步支持值、默认值，并保持精确尺寸", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = { parameter: "size", values: ["1920x1080"], default: "1920x1080", allowCustom: false };
        const existing = imageSizePresets(profile);
        const added = imagePresetForRatio("1k", "17:11");
        profile.size = imageSizeConfigWithPresets(profile, [...existing, added]);
        expect(profile.size.values).toEqual(["1920x1080", added.size]);
        expect(profile.size.default).toBe("1920x1080");
        expect(resolveImageRequestSize(profile, undefined, "1920x1080")?.value).toBe("1920x1080");
        expect(normalizeModelCapabilityConfig({ version: 1, image: profile }).image?.size.presets).toEqual(profile.size.presets);
        expect(imageSizeConfigWithPresets(profile, [added]).default).toBe(added.size);
    });

    test("非标准精确像素不会从选项中消失", () => {
        expect(buildImageResolutionOptions(["1360x880"])[0]).toMatchObject({ size: "1360x880", ratio: "17:11" });
        expect(buildImageResolutionOptions(["0x1024", "1024x0"])).toEqual([]);
    });

    test("比例协议分别发送比例和分辨率，不把自定义权限当作 4K 能力", () => {
        const grok = defaultImageCapabilityConfig("grok-image", "grok-imagine-image");
        grok.size.allowCustom = true;
        expect(imageTierAvailable(grok, "4k")).toBe(false);
        expect(imageSizePresets(grok).some((preset) => preset.tier === "4k")).toBe(false);
        const gemini = defaultImageCapabilityConfig("gemini-image", "test");
        const preset = imagePresetForRatio("4k", "16:9");
        expect(buildGeminiImageGenerationConfig(imagePresetValue(gemini, preset), imageQualityForTier(gemini, "4k")).imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "4K" });
        gemini.size.allowCustom = true;
        const reopened = renderToStaticMarkup(<ImageSizePicker profile={gemini} size="17:11" quality="high" onChange={() => {}} />);
        expect(reopened).toMatch(/aria-pressed="true"[^>]*>4K/);
        expect(reopened).toContain("17:11");
    });

    test("比例与档位的组合必须在该档位配置中，允许自定义则放开比例", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", "test");
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "16:9")]);
        expect(() => resolveImageRequestSize(profile, "medium", "1:1")).toThrow("当前分辨率");
        expect(resolveImageRequestSize(profile, "medium", "16:9")).toEqual({ parameter: "aspect_ratio", value: "16:9" });
        profile.size.allowCustom = true;
        expect(resolveImageRequestSize(profile, "medium", "1:1")?.value).toBe("1:1");
    });

    test("管理员固定显示三档，用户端隐藏未支持档位，不发送尺寸时隐藏", () => {
        const profile = defaultImageCapabilityConfig("grok-image", "grok-imagine-image");
        profile.size.allowCustom = true;
        const editor = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} onChange={() => {}} />);
        for (const label of ["1K", "2K", "4K"]) expect(editor).toMatch(new RegExp(`<strong[^>]*>${label}</strong>`));
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" quality="2k" onChange={() => {}} />);
        expect(picker).not.toMatch(/<button[^>]*>4K/);
        expect(picker).toContain("换算参考");
        profile.size.parameter = "none";
        expect(renderToStaticMarkup(<ImageSizePicker profile={profile} size="auto" onChange={() => {}} />)).toBe("");
    });

    test("空档位始终隐藏，允许自定义也不显示；旧尺寸不导致比例区域为空", () => {
        for (const protocol of ["openai-image", "gemini-image"]) {
            const profile = defaultImageCapabilityConfig(protocol, "test");
            profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("4k", "16:9")]);
            for (const allowCustom of [false, true]) {
                profile.size.allowCustom = allowCustom;
                const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size={profile.size.parameter === "aspect_ratio" ? "16:9" : "2752x1536"} quality="medium" onChange={() => {}} />);
                expect(picker).toMatch(/<button[^>]*>1K/);
                expect(picker).toMatch(/<button[^>]*>4K/);
                expect(picker).not.toMatch(/<button[^>]*>2K/);
                expect(picker).not.toContain("未配置比例");
                expect(picker).toContain('title="1:1 · 1024 × 1024"');
                expect(picker).not.toMatch(/aria-pressed="true"[^>]*>1K/);
            }
        }
    });

    test("仅配置一档时只显示该档；全空时保留自动尺寸与自定义入口", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("4k", "16:9")]);
        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="3840x2160" onChange={() => {}} />);
        expect(picker).not.toMatch(/<button[^>]*>[12]K/);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
        profile.size = imageSizeConfigWithPresets(profile, []);
        profile.size.allowCustom = true;
        const empty = renderToStaticMarkup(<ImageSizePicker profile={profile} size="auto" onChange={() => {}} />);
        expect(empty).not.toContain('class="image-size-tiers"');
        expect(empty).not.toContain('class="image-size-label"');
        expect(empty).toContain("自动尺寸");
        expect(empty).toContain("自定义比例或尺寸");
    });

    test("管理员比例直接点选和输入，默认输出不再使用下拉框", () => {
        const profile = defaultImageCapabilityConfig();
        profile.size = imageSizeConfigWithPresets(profile, [imagePresetForRatio("1k", "16:9")]);
        const editor = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} onChange={() => {}} />);
        expect(editor).not.toContain('role="combobox"');
        expect(editor).not.toContain("ant-select");
        for (const tier of ["1K", "2K", "4K"]) {
            expect(editor).toContain(`aria-label="${tier} 自定义比例"`);
            expect(editor).toContain(`aria-label="添加 ${tier} 比例"`);
            expect(editor).toContain(`aria-label="${tier} 16:9"`);
        }
        expect(editor).toContain('aria-label="默认输出"');
        expect(editor).not.toContain("全不选");
        expect(editor).not.toContain("全选");
        expect(editor).toContain('aria-label="启用 1K 规格"');
        expect(editor).toContain('aria-label="启用 2K 规格"');
        expect(editor).toContain('aria-label="启用 4K 规格"');
        const readOnly = renderToStaticMarkup(<ImageSizePresetsEditor profile={profile} disabled onChange={() => {}} />);
        const buttons = [...readOnly.matchAll(/<button\b[^>]*>/g)];
        expect(buttons.length).toBeGreaterThan(24);
        expect(buttons.every(([button]) => button.includes('disabled=""'))).toBe(true);
    });

    test("图片协议尺寸独占整行且先于辅助参数，视频布局不受影响", () => {
        const image = renderToStaticMarkup(<ModelCapabilityEditor capability="image" section="protocol" />);
        expect(image).toContain("admin-image-protocol-grid");
        expect(image).toContain("admin-image-size-card");
        expect(image.indexOf("尺寸参数")).toBeLessThan(image.indexOf("输出数量"));
        const video = renderToStaticMarkup(<ModelCapabilityEditor capability="video" section="protocol" />);
        expect(video).not.toContain("admin-image-protocol-grid");
    });
});
