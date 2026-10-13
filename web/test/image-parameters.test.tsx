import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageParameterFields, ImageParameterSchemaEditor, ImagePixelMappingEditor } from "../src/components/image-parameter-fields";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { imagePresetForRatio } from "../src/lib/image-size-presets";
import { imageParameterConstraints, imageParameterRequest, initializeImageRatioDefaults, normalizeImageParameters, projectImageParameters, updateImageParameterSchema, updateImageParameterSize, type ImageParameter } from "../src/lib/image-parameters";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectLogicalCapability } from "../src/lib/user-session";
import { capabilitySpecFromChannelModel, mergeCapabilitySpecs, normalizeCapabilitySpecForSources } from "../src/pages/admin/logical-models/model-routing-capabilities";
import { defaultPriceTier, skuSelectorFromForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { defaultConfig, createModelChannel, encodeChannelModel } from "../src/stores/use-config-store";
import type { ChannelModel } from "../src/services/api/wallet";
import { specFromConfig, generationSpecMetadata, synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import type { CanvasNodeData } from "../src/types/canvas";

const parameters: ImageParameter[] = [
    { name: "imageResolution", label: "分辨率", type: "string", values: ["small", "large"], default: "small", pricing: true },
    { name: "creativeAmount", label: "创意程度", type: "integer", min: 0, max: 200, step: 1, default: 0 },
    { name: "rawMode", label: "原始模式", type: "boolean", default: false },
];
function fixture(fields = parameters) {
    const image = projectImageParameters(defaultImageCapabilityConfig(), fields);
    const spec = capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image } } as ChannelModel)!;
    const channel = createModelChannel({
        id: "test",
        models: ["opaque-model"],
        modelCosts: [{ model: "opaque-model", capability: "image", protocol: "opaque-plugin", logicalModelId: "logical", logicalCapabilitySpec: spec, capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "opaque-model");
    return { image, spec, config: { ...defaultConfig, channels: [channel], model, imageModel: model, imageResolution: "large", imageParameters: JSON.stringify({ creativeAmount: 0, rawMode: false, oldParameter: 999 }) } };
}

describe("plugin image parameters across model configuration and generation", () => {
    test("new resolution selects the six preferred ratios without changing existing choices", () => {
        const fields: ImageParameter[] = [
            { name: "size", label: "画幅", type: "string", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1k"], default: "1k" },
        ];
        const { image } = fixture(fields);
        image.size.presets = [];
        const initialized = initializeImageRatioDefaults(image, fields);
        expect(initialized.size.presets?.map((p) => p.ratio)).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"]);
        const cleared = updateImageParameterSize(initialized, { ...initialized.size, values: ["auto"], default: "auto", presets: [] });
        const added = updateImageParameterSchema(
            cleared,
            cleared.parameters!.map((p) => (p.name === "imageResolution" ? { ...p, values: ["1k", "2k"] } : p)),
            fields,
        );
        expect(added.size.presets?.filter((p) => p.tier === "1k")).toHaveLength(0);
        expect(added.size.presets?.filter((p) => p.tier === "2k")).toHaveLength(6);
        const reopened = projectImageParameters(JSON.parse(JSON.stringify(added)), added.parameters!);
        expect(reopened.size.presets).toEqual(added.size.presets);
    });
    test("preferred ratios respect plugin limits and retain exact configured sizes", () => {
        const fields: ImageParameter[] = [
            { name: "size", label: "画幅", type: "string", values: ["1:1", "9:16", "2:3"], default: "1:1", encoding: "ratio" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1k", "2k"], default: "1k" },
        ];
        const { image } = fixture(fields);
        const exact = { tier: "1k", ratio: "1:1", width: 1080, height: 1080, size: "1080x1080" };
        image.size.presets = [exact];
        const initialized = initializeImageRatioDefaults(image, fields);
        expect(initialized.size.presets?.[0]).toEqual(exact);
        expect(initialized.size.presets?.filter((p) => p.tier === "2k").map((p) => p.ratio)).toEqual(["1:1", "9:16"]);
    });
    test("declared resolution keeps the existing grouped ratio editor and exact presets", () => {
        const fields: ImageParameter[] = [
            { name: "size", label: "画幅", type: "string", values: ["16:9", "1:1"], default: "16:9", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["2k"], default: "2k" },
        ];
        const { image } = fixture(fields);
        image.size.presets = [{ ...imagePresetForRatio("2k", "16:9"), width: 2560, height: 1440, size: "2560x1440" }];
        const html = renderToStaticMarkup(<ModelCapabilityEditor capability="image" section="protocol" value={{ version: 1, image }} imageParameters={fields} />);
        expect(html).toContain('aria-label="2K 支持的宽高比"');
        expect(html).toContain("2560");
        expect(html).toContain("1440");
        expect(html).toContain("默认输出");
        expect(html).not.toContain('aria-label="1K 支持的宽高比"');
        expect(html).not.toContain("比例对应的像素尺寸");
    });
    test("ratio-only contract has ratio buttons without invented resolution or pixel inputs", () => {
        const fields: ImageParameter[] = [{ name: "size", label: "画幅", type: "string", values: ["7:5", "5:7"], default: "7:5", encoding: "ratio" }];
        const { image } = fixture(fields);
        const html = renderToStaticMarkup(<ModelCapabilityEditor capability="image" section="protocol" value={{ version: 1, image }} imageParameters={fields} />);
        expect(html).toContain('aria-label="支持的宽高比"');
        expect(html).toContain("7:5");
        expect(html).toContain("默认输出");
        expect(html).not.toContain("1K");
        expect(html).not.toContain("宽度");
        expect(html).not.toContain("像素");
        expect(html).not.toContain("16:9");
        image.size.presets = [imagePresetForRatio("1k", "7:5")];
        const panel = renderToStaticMarkup(<ImageParameterFields profile={image} config={{ ...defaultConfig, size: "7:5" }} onChange={() => {}} />);
        expect(panel).not.toContain("image-size-output");
        expect(panel).not.toContain("未配置独立分辨率");
    });
    test("saving tier ratios preserves the contract and generation only shows the active tier", () => {
        const { image, config } = fixture([
            { name: "size", label: "画幅", type: "string", values: ["1:1", "16:9"], default: "1:1", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1k", "2k"], default: "1k" },
        ]);
        const saved = updateImageParameterSize(image, { ...image.size, presets: [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "16:9")] });
        const reopened = projectImageParameters(saved, saved.parameters!);
        expect(reopened.size.presets).toHaveLength(2);
        const html = renderToStaticMarkup(<ImageParameterFields profile={reopened} config={{ ...config, size: "16:9", imageResolution: "2k" }} onChange={() => {}} />);
        expect(html).toContain("2752 × 1536");
        expect(html).not.toContain("1024 × 1024");
        expect(html).not.toContain("1:1");
        const singleTier = updateImageParameterSize(saved, { ...saved.size, values: ["16:9"], default: "16:9", presets: [imagePresetForRatio("2k", "16:9")] });
        expect(singleTier.resolution.values).toEqual(["1k", "2k"]);
        expect(singleTier.resolution.default).toBe("1k");
    });
    test("size groups follow channel resolutions, not every plugin candidate", () => {
        const { image } = fixture([
            { name: "size", label: "画幅", type: "string", values: ["1:1"], default: "1:1", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["2k"], default: "2k" },
        ]);
        const definitions = image.parameters!.map((p) => (p.name === "imageResolution" ? { ...p, values: ["1k", "2k", "4k"] } : p));
        const html = renderToStaticMarkup(<ModelCapabilityEditor capability="image" section="protocol" value={{ version: 1, image }} imageParameters={definitions} />);
        expect(html).toContain('aria-label="2K 支持的宽高比"');
        expect(html).not.toContain('aria-label="1K 支持的宽高比"');
        expect(html).not.toContain('aria-label="启用 2K 规格"');
    });
    test("disabled resolution uses one ratio group and restores existing tier presets on enabling", () => {
        const { image, config } = fixture([
            { name: "size", label: "画幅", type: "string", values: ["1:1"], default: "1:1", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1k", "2k"], default: "2k", enabled: false },
        ]);
        image.size.presets = [imagePresetForRatio("1k", "1:1"), imagePresetForRatio("2k", "1:1")];
        const html = renderToStaticMarkup(<ModelCapabilityEditor capability="image" section="protocol" value={{ version: 1, image }} imageParameters={image.parameters} />);
        expect(html).toContain('aria-label="支持的宽高比"');
        expect(html).not.toContain('aria-label="1K 支持的宽高比"');
        expect(html).not.toContain('aria-label="2K 支持的宽高比"');
        const panel = renderToStaticMarkup(<ImageParameterFields profile={image} config={{ ...config, size: "1:1" }} onChange={() => {}} />);
        expect(panel).not.toContain("1K");
        expect(panel).not.toContain("2K");
        expect(panel).toContain("2048");
        const reopened = projectImageParameters(
            JSON.parse(JSON.stringify(image)),
            image.parameters!.map((p) => ({ ...p, enabled: true })),
        );
        expect(reopened.size.presets).toEqual(image.size.presets);
        expect(reopened.resolution.values).toEqual(["1k", "2k"]);
    });
    test("generation enums display declared choices directly with ratio previews", () => {
        const { image, config } = fixture([
            { name: "size", label: "画幅", type: "string", values: ["7:5", "5:7"], default: "7:5", encoding: "ratio" },
            { name: "finish", label: "表面", type: "string", values: ["matte", "gloss"], default: "matte" },
        ]);
        const html = renderToStaticMarkup(<ImageParameterFields profile={image} config={{ ...config, size: "5:7" }} onChange={() => {}} />);
        expect(html).toContain('role="group" aria-label="画幅"');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain("image-size-ratio-icon");
        expect(html).toContain("7:5");
        expect(html).toContain("5:7");
        expect(html).toContain("gloss");
        expect(html).not.toContain('role="combobox"');
        expect(html).not.toContain("16:9");
    });
    test("resolution-only contract renders no invented quality or pixel-tier controls", () => {
        const { image, config } = fixture([parameters[0]]);
        const html = renderToStaticMarkup(<ImageParameterFields profile={image} config={config} onChange={() => {}} />);
        expect(html).toContain("分辨率");
        expect(html).not.toContain("图片质量");
        expect(html).not.toContain("像素档位");
        expect(html).not.toContain("1k");
        const editor = renderToStaticMarkup(<ImageParameterSchemaEditor definitions={[parameters[0]]} parameters={[parameters[0]]} onChange={() => {}} />);
        expect(editor).toContain("small");
        expect(editor).toContain("large");
        expect(editor).toContain("可计价");
    });
    test("an arbitrary plugin field crosses channel, logical model and frontend projection", () => {
        const { spec } = fixture();
        const merged = mergeCapabilitySpecs("image", [spec]);
        const image = projectLogicalCapability(merged, {}).image!;
        expect(image.parameters?.map((p) => p.name)).toEqual(parameters.map((p) => p.name));
        expect(image.quality.supported).toBe(false);
        expect(image.resolution.values).toEqual(["small", "large"]);
        expect(imageParameterConstraints(image.parameters!).creativeAmount).toEqual({ min: 0, max: 200, step: 1 });
    });
    test("channel changes remove stale quality; explicit frontend restrictions remain disabled", () => {
        const { spec } = fixture();
        const old = { version: 1 as const, capability: "image" as const, options: { quality: { values: ["2k"] } } };
        const next = normalizeCapabilitySpecForSources(old, [spec])!;
        expect(next.options?.quality).toBeUndefined();
        expect(next.options?.creativeAmount).toBeDefined();
        const disabled = { ...next, options: { imageResolution: next.options!.imageResolution } };
        expect(normalizeCapabilitySpecForSources(disabled, [spec])?.options?.creativeAmount).toBeUndefined();
        const withNew = { ...spec, imageParameters: [...spec.imageParameters!, { name: "newField", label: "New", type: "boolean" as const }], options: { ...spec.options, newField: { values: [false, true] } } };
        expect(normalizeCapabilitySpecForSources(disabled, [withNew])?.options?.newField).toBeDefined();
    });
    test("only pricing declarations can enter price selectors", () => {
        const { image } = fixture();
        const tier = { ...defaultPriceTier("advanced"), imageSelector: { imageResolution: "large", creativeAmount: "100", rawMode: "true", quality: "4k" } };
        expect(skuSelectorFromForm("image", tier, { version: 1, image })).toEqual({ imageResolution: "large" });
    });
    test("zero and false persist while unsupported fields do not cross model switches", () => {
        const { image, config } = fixture();
        expect(imageParameterRequest(image, config)).toEqual({ imageResolution: "large", creativeAmount: 0, rawMode: false });
        expect(normalizeImageParameters([parameters[0]], config.imageParameters)).toEqual({ imageResolution: "small" });
        const spec = specFromConfig("image", "portrait", config);
        const metadata = generationSpecMetadata(spec);
        expect(metadata.imageParameters).toBe(config.imageParameters);
        const node = { id: "node", type: "image", metadata } as CanvasNodeData;
        const changed = synchronizeGenerationSpec(node, { model: encodeChannelModel("other", "model") });
        expect(changed.metadata?.imageParameters).toBeUndefined();
    });
    test("actual task payload includes typed extensions and no stale quality requirement", async () => {
        const { config } = fixture();
        const task = await prepareBackendGenerationTask({ mode: "image", prompt: "portrait", config });
        const input = task.input as Record<string, any>;
        expect(input.capabilityOptions).toEqual({ imageResolution: "large", creativeAmount: 0, rawMode: false });
        expect(input.config.imageParameters).toEqual(input.capabilityOptions);
        expect(input.capabilityOptions.quality).toBeUndefined();
    });
    test("submission rejects explicit invalid fields while display can normalize stored preferences", async () => {
        const { image, config } = fixture();
        const invalid = { ...config, imageParameters: JSON.stringify({ creativeAmount: 201 }) };
        expect(imageParameterRequest(image, invalid)?.creativeAmount).toBe(0);
        expect(() => imageParameterRequest(image, invalid, true)).toThrow("创意程度");
        await expect(prepareBackendGenerationTask({ mode: "image", prompt: "portrait", config: invalid })).rejects.toThrow("创意程度");
        expect(() => imageParameterRequest(image, { ...config, imageParameters: "invalid" }, true)).toThrow("格式无效");
    });
    test("pixel mapping accepts plugin resolution names without inventing dimensions", () => {
        const { image } = fixture([
            { name: "size", label: "画幅", type: "string", values: ["2:1"], default: "2:1", encoding: "pixels" },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["panorama"], default: "panorama" },
        ]);
        const html = renderToStaticMarkup(<ImagePixelMappingEditor profile={image} onChange={() => {}} />);
        expect(html).toContain("PANORAMA");
        expect(html).toContain('placeholder="宽度"');
        expect(html).not.toContain("1024");
        expect(html).not.toContain("补齐");
    });
});
