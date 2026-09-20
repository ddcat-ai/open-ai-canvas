import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePicker } from "../src/components/image-size-picker";
import { IMAGE_RATIOS, imagePresetForRatio, imageSizeConfigWithPresets, imageTierAvailable } from "../src/lib/image-size-presets";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectLogicalCapability } from "../src/lib/user-session";
import { capabilitySpecFromChannelModel, mergeCapabilitySpecs } from "../src/pages/admin/logical-models/model-routing-capabilities";
import type { ChannelModel } from "../src/services/api/wallet";

function channelModelWithPresets(): ChannelModel {
    const profile = defaultImageCapabilityConfig("gemini-image", "test");
    profile.quality = { supported: false, values: [], default: "auto" };
    profile.size = imageSizeConfigWithPresets(profile, IMAGE_RATIOS.flatMap((ratio) => [imagePresetForRatio("1k", ratio), imagePresetForRatio("4k", ratio)]));
    return {
        id: "cm-1",
        channelId: "ch-1",
        modelKey: "nano-banana",
        displayName: "Nano Banana",
        capability: "image",
        protocol: "gemini-image",
        capabilityConfig: { version: 1, image: profile },
    } as ChannelModel;
}

describe("前台模型同步系统模型尺寸档位", () => {
    test("供应线路规格保留 aspect_ratio 与 1K/4K 预设", () => {
        const spec = capabilitySpecFromChannelModel(channelModelWithPresets());
        expect(spec?.imageSize?.parameter).toBe("aspect_ratio");
        expect(spec?.imageSize?.presets?.some((preset) => preset.tier === "1k")).toBe(true);
        expect(spec?.imageSize?.presets?.some((preset) => preset.tier === "4k")).toBe(true);
        expect(spec?.imageSize?.presets?.some((preset) => preset.tier === "2k")).toBe(false);
    });

    test("前台投影不再把多档压成只有 1K", () => {
        const spec = capabilitySpecFromChannelModel(channelModelWithPresets())!;
        const projected = projectLogicalCapability(spec, { size: "16:9" }).image!;
        expect(projected.size.parameter).toBe("aspect_ratio");
        expect(imageTierAvailable(projected, "1k")).toBe(true);
        expect(imageTierAvailable(projected, "4k")).toBe(true);
        expect(imageTierAvailable(projected, "2k")).toBe(false);
        const picker = renderToStaticMarkup(<ImageSizePicker profile={projected} size="16:9" quality="4k" onChange={() => {}} />);
        expect(picker).toMatch(/<button[^>]*>1K/);
        expect(picker).toMatch(/<button[^>]*>4K/);
        expect(picker).not.toMatch(/<button[^>]*>2K/);
        expect(picker).toMatch(/aria-pressed="true"[^>]*>4K/);
    });

    test("合并供应线路时并集 1K/4K 预设", () => {
        const oneK = defaultImageCapabilityConfig("gemini-image", "a");
        oneK.size = imageSizeConfigWithPresets(oneK, [imagePresetForRatio("1k", "16:9")]);
        const fourK = defaultImageCapabilityConfig("gemini-image", "b");
        fourK.quality = { supported: false, values: [], default: "auto" };
        fourK.size = imageSizeConfigWithPresets(fourK, [imagePresetForRatio("4k", "16:9")]);
        const merged = mergeCapabilitySpecs("image", [
            capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image: oneK } } as ChannelModel)!,
            capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image: fourK } } as ChannelModel)!,
        ]);
        expect(merged.imageSize?.parameter).toBe("aspect_ratio");
        expect(merged.imageSize?.presets?.map((preset) => preset.tier).sort()).toEqual(["1k", "4k"]);
    });
});
