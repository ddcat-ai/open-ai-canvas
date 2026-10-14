import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageParameterSizeEditor } from "../src/components/image-parameter-fields";
import { imageParameterRequest, projectImageParameters, resolveImageParameters, updateImageParameterSchema, updateImageParameterSize, type ImageParameter } from "../src/lib/image-parameters";
import { IMAGE_RATIOS, imagePresetForRatio, imageSizeConfigWithPresets } from "../src/lib/image-size-presets";
import { defaultImageCapabilityConfig, type ImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectLogicalCapability } from "../src/lib/user-session";
import { capabilitySpecFromChannelModel } from "../src/pages/admin/logical-models/model-routing-capabilities";
import type { ChannelModel } from "../src/services/api/wallet";

const definitions: ImageParameter[] = [
    { name: "size", label: "画幅", type: "string", encoding: "pixels" },
    { name: "imageResolution", label: "分辨率", type: "string" },
];

function change(profile: ImageCapabilityConfig, name: string, patch: Partial<ImageParameter>, declared = definitions) {
    return updateImageParameterSchema(
        profile,
        profile.parameters!.map((field) => (field.name === name ? { ...field, ...patch } : field)),
        declared,
    );
}

function disabledProfile(encoding: "pixels" | "ratio" = "pixels") {
    return projectImageParameters(defaultImageCapabilityConfig(), [
        { ...definitions[0], encoding, enabled: false, values: [...IMAGE_RATIOS], default: "1:1" },
        { ...definitions[1], enabled: false, values: ["1k", "2k", "4k"], default: "2k" },
    ]);
}

function expectRatios(profile: ImageCapabilityConfig, tier: string, ratios = IMAGE_RATIOS) {
    expect(
        profile.size.presets
            ?.filter((preset) => preset.tier === tier)
            .map((preset) => preset.ratio)
            .sort(),
    ).toEqual([...ratios].sort());
}

describe("图片尺寸与分辨率配置顺序", () => {
    for (const encoding of ["pixels", "ratio"] as const) {
        test(`${encoding}: 两种开关顺序得到相同的完整配置`, () => {
            const initial = disabledProfile(encoding);
            const declared = definitions.map((field) => (field.name === "size" ? { ...field, encoding } : field));
            const enableSize = (profile: ImageCapabilityConfig) => change(profile, "size", { enabled: true }, declared);
            const enableResolution = (profile: ImageCapabilityConfig) => change(profile, "imageResolution", { enabled: true }, declared);
            const sizeFirst = enableResolution(enableSize(initial));
            const resolutionFirst = enableSize(enableResolution(initial));
            expect(resolutionFirst).toEqual(sizeFirst);
            for (const tier of ["1k", "2k", "4k"]) expectRatios(resolutionFirst, tier);
        });
    }

    test("先选全部尺寸再启用分辨率，保留精确尺寸并为其他档位继承全部比例", () => {
        let profile = change(disabledProfile(), "size", { enabled: true });
        const presets = IMAGE_RATIOS.map((ratio) => imagePresetForRatio("2k", ratio));
        presets[0] = { ...presets[0], width: 2000, height: 2000, size: "2000x2000" };
        profile = updateImageParameterSize(profile, { ...imageSizeConfigWithPresets(profile, presets), defaultTier: "2k" });
        const enabled = change(profile, "imageResolution", { enabled: true });
        for (const tier of ["1k", "2k", "4k"]) expectRatios(enabled, tier);
        expect(enabled.size.presets?.find((preset) => preset.tier === "2k" && preset.ratio === "1:1")).toEqual(presets[0]);

        const reopened = resolveImageParameters(JSON.parse(JSON.stringify(enabled)), definitions, "test-model");
        expect(reopened.size.presets).toEqual(enabled.size.presets);
        const spec = capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image: reopened } } as ChannelModel)!;
        const projected = projectLogicalCapability(spec, {}).image!;
        for (const tier of ["1k", "2k", "4k"]) {
            expectRatios(projected, tier);
            for (const ratio of IMAGE_RATIOS) {
                expect(imageParameterRequest(projected, { size: ratio, imageResolution: tier }, true)).toEqual({ size: ratio, imageResolution: tier });
            }
        }
    });

    test("先启用 1K 再添加 2K，比例不会被裁成常用六个", () => {
        let profile = change(disabledProfile(), "size", { enabled: true });
        profile = updateImageParameterSize(
            profile,
            imageSizeConfigWithPresets(
                profile,
                IMAGE_RATIOS.map((ratio) => imagePresetForRatio("2k", ratio)),
            ),
        );
        profile = change(profile, "imageResolution", { enabled: true, values: ["1k"], default: "1k" });
        expectRatios(profile, "1k");
        expect(profile.size.presets?.some((preset) => preset.tier === "2k")).toBe(false);
        profile = change(profile, "imageResolution", { values: ["1k", "2k"] });
        expectRatios(profile, "1k");
        expectRatios(profile, "2k");
    });

    test("像素支持值也能通过已有预设继承比例，保留原始像素", () => {
        const presets = IMAGE_RATIOS.map((ratio) => imagePresetForRatio("1k", ratio));
        let profile = projectImageParameters(defaultImageCapabilityConfig(), [
            { ...definitions[0], values: presets.map((preset) => preset.size), default: presets[0].size },
            { ...definitions[1], values: ["1k"], default: "1k" },
        ]);
        profile = updateImageParameterSize(profile, { ...profile.size, presets });
        const next = change(profile, "imageResolution", { values: ["1k", "2k"] });
        expectRatios(next, "2k");
        expect(next.size.presets?.filter((preset) => preset.tier === "1k")).toEqual(presets);
    });

    test("已有档位的独立比例和手动清空结果不被补齐覆盖", () => {
        let profile = change(change(disabledProfile(), "size", { enabled: true }), "imageResolution", { enabled: true, values: ["1k", "2k"], default: "1k" });
        const exact = { ...imagePresetForRatio("1k", "16:9"), width: 1600, height: 900, size: "1600x900" };
        profile = updateImageParameterSize(profile, imageSizeConfigWithPresets(profile, [exact]));
        const next = change(profile, "imageResolution", { values: ["1k", "2k", "4k"] });
        expect(next.size.presets?.filter((preset) => preset.tier === "1k")).toEqual([exact]);
        expect(next.size.presets?.filter((preset) => preset.tier === "2k")).toEqual([]);
        expectRatios(next, "4k", ["16:9"]);
        expect(change(next, "imageResolution", { default: "4k" }).size.presets).toEqual(next.size.presets);
    });

    test("继承自定义比例但不超出插件声明", () => {
        const declared = [{ ...definitions[0], values: ["1:1", "17:11"] }, definitions[1]];
        let profile = projectImageParameters(defaultImageCapabilityConfig(), [
            { ...definitions[0], values: ["1:1", "17:11", "4:5"], default: "1:1" },
            { ...definitions[1], enabled: false, values: ["2k"], default: "2k" },
        ]);
        profile = change(profile, "imageResolution", { enabled: true }, declared);
        expectRatios(profile, "2k", ["1:1", "17:11"]);
    });

    test("编辑期间关闭再开启尺寸保留精确像素，禁用时不发送尺寸", () => {
        let profile = change(change(disabledProfile(), "size", { enabled: true }), "imageResolution", { enabled: true, values: ["2k"] });
        const exact = { ...imagePresetForRatio("2k", "16:9"), width: 2560, height: 1440, size: "2560x1440" };
        profile = updateImageParameterSize(profile, imageSizeConfigWithPresets(profile, [exact]));
        const disabled = change(profile, "size", { enabled: false });
        expect(imageParameterRequest(disabled, { size: "16:9", imageResolution: "2k" }, true)).toEqual({ imageResolution: "2k" });
        expect(change(disabled, "size", { enabled: true }).size.presets).toEqual([exact]);
    });

    test("没有换算规则的档位保留待填写比例并显示提示", () => {
        let profile = change(disabledProfile(), "size", { enabled: true, values: ["1:1", "17:11"] });
        profile = change(profile, "imageResolution", { enabled: true, values: ["panorama"], default: "panorama" });
        expectRatios(profile, "panorama", ["1:1", "17:11"]);
        expect(profile.size.presets?.every((preset) => preset.width === 0 && preset.height === 0 && preset.size === "")).toBe(true);
        const html = renderToStaticMarkup(<ImageParameterSizeEditor profile={profile} definition={definitions[0]} onChange={() => {}} />);
        expect(html).toContain("请填写所选比例的宽度和高度");
        expect(html).toContain('aria-label="PANORAMA 17:11 宽度像素"');
    });
});
