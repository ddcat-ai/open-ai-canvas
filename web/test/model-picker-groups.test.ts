import { expect, test } from "bun:test";
import { groupModelsForPicker, modelChannelLabel } from "../src/lib/model-picker-groups";
import { groupModelsByDisplayName, modelCompatibilityError, modelGroupReferenceLimits, resolveCompatibleModel } from "../src/lib/model-selection";
import { modelQuoteRequest, priceTiersForCurrentSelection, priceTierSummaryLabel } from "../src/lib/model-pricing";
import { systemChannelModelChannels } from "../src/lib/user-session";
import type { PublicChannelCatalog, PublicChannelModel } from "../src/services/api/logical-models";
import { defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability } from "../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { CanvasNodeType } from "../src/types/canvas";

function model(label = "", price = 300000, modelKey = "seedance-2.0", displayName = modelKey === "seedance-2.0" ? "Seedance 2.0" : modelKey): PublicChannelModel {
    return {
        id: `${modelKey}-${label || "default"}`, modelKey, displayName, channelLabel: label,
        description: label ? `${label}的使用说明` : "",
        icon: "ByteDance", capability: "video", protocol: "seedance", available: true,
        pricingMode: "provider", priceLabel: "",
        capabilityConfig: defaultModelCapabilityConfig("seedance", "seedance-2.0"),
        priceTiers: [{ id: "tier", selector: {}, resolution: "*", videoSeconds: 0, billingMode: "per_second", unitPriceMicrocredits: price, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 }],
    };
}

function fixture() {
    const channels: PublicChannelCatalog[] = [
        { id: "a", name: "正常渠道", displayName: "正常渠道", models: [model()] },
        { id: "b", name: "渠道 B", displayName: "渠道 B", models: [model("优惠渠道-993")] },
        { id: "c", name: "渠道 C", displayName: "渠道 C", models: [model("特惠渠道-730", 200000)] },
    ];
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: systemChannelModelChannels(channels), model: "b::seedance-2.0", videoModel: "b::seedance-2.0" } }).config;
}

test("same model display name groups all channels and preserves their prices", () => {
    const config = fixture();
    const groups = groupModelsForPicker(config, selectableModelsByCapability(config, "video"));
    expect(groups).toHaveLength(1);
    expect(config.channels.map((channel) => channel.modelCosts![0].description)).toEqual(["", "优惠渠道-993的使用说明", "特惠渠道-730的使用说明"]);
    expect(groups.map((group) => [group.label, group.kind, group.models.map((item) => [item.label, item.models])])).toEqual([
        ["Seedance 2.0", "product", [["正常渠道", ["a::seedance-2.0"]], ["优惠渠道-993", ["b::seedance-2.0"]], ["特惠渠道-730", ["c::seedance-2.0"]]]],
    ]);
    expect(config.channels.map((channel) => priceTierSummaryLabel(priceTiersForCurrentSelection(channel.modelCosts![0].logicalPriceTiers!, "video", config)))).toEqual(["0.3 积分/秒", "0.3 积分/秒", "0.2 积分/秒"]);
});

test("grouping uses display name even when model keys differ, without merging channel options", () => {
    const channels = systemChannelModelChannels([
        { id: "mita", name: "秘塔", displayName: "秘塔", models: [model("秘塔（满血渠道）", 90_000, "MiniMax H3", "MiniMax H3")] },
        { id: "other", name: "其他供应商", displayName: "其他供应商", models: [model("秘塔（满血渠道）", 80_000, "minimax-h3-alt", "MiniMax H3")] },
    ]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    const groups = groupModelsForPicker(config, selectableModelsByCapability(config, "video"));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("MiniMax H3");
    expect(groups[0].models.map((item) => item.models)).toEqual([["mita::MiniMax H3"], ["other::minimax-h3-alt"]]);
    expect(groups[0].models.map((item) => item.label)).toEqual(["秘塔（满血渠道）", "秘塔（满血渠道）"]);
});

test("catalog projection keeps promotional tags scoped to each channel model", () => {
    const channels = systemChannelModelChannels([
        { id: "a", name: "A", displayName: "A", models: [{ ...model("A", 100_000), tags: [{ text: "限时特价", color: "purple" }] }] },
        { id: "b", name: "B", displayName: "B", models: [{ ...model("B", 200_000), tags: [{ text: "官方1折", color: "gold" }] }] },
    ]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels } }).config;
    expect(config.channels[0].modelCosts![0].tags).toEqual([{ text: "限时特价", color: "purple" }]);
    expect(config.channels[1].modelCosts![0].tags).toEqual([{ text: "官方1折", color: "gold" }]);
});

test("selection and quote keep the chosen channel even when another channel is cheaper", () => {
    const config = fixture();
    const value = "b::seedance-2.0";
    expect(resolveCompatibleModel(config, value, { capability: "video" })).toBe(value);
    expect(resolveModelRequestConfig(config, value)).toMatchObject({ channelId: "b", model: "seedance-2.0" });
    expect(modelQuoteRequest(config, value, "video")).toMatchObject({ channelId: "b", modelKey: "seedance-2.0" });
    config.channels[1].modelCosts![0].channelLabel = "新展示名";
    expect(modelChannelLabel(config, value)).toBe("新展示名");
    expect(resolveModelRequestConfig(config, value)).toMatchObject({ channelId: "b", model: "seedance-2.0" });
});

function sameChannelVariants() {
    const channels = systemChannelModelChannels([{ id: "comfy", name: "Comfy", displayName: "Comfy", models: [
        model("高速版", 100_000, "h3-fast", "MiniMax H3"),
        model("多图一致性", 200_000, "h3-multi", "MiniMax H3"),
    ] }]);
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels, model: "comfy::h3-multi", videoModel: "comfy::h3-multi" } }).config;
}

test("same-channel system variants retain explicit model identity through selection, generation and quote", () => {
    const config = sameChannelVariants();
    const options = selectableModelsByCapability(config, "video");
    expect(groupModelsForPicker(config, options)[0].models).toHaveLength(2);
    expect(groupModelsByDisplayName(config, options).map((group) => group.models)).toEqual(options.map((value) => [value]));
    for (const value of options) {
        expect(resolveCompatibleModel(config, value, { capability: "video" })).toBe(value);
        const generation = buildGenerationConfig(config, {
            id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 100, height: 100,
            metadata: { model: value, generationMode: "video" },
        }, "video");
        expect(generation.model).toBe(value);
        expect(resolveModelRequestConfig(generation, generation.model)).toMatchObject({ channelId: "comfy", model: value.split("::")[1] });
        expect(modelQuoteRequest(config, value, "video")).toMatchObject({ channelId: "comfy", modelKey: value.split("::")[1] });
    }
});

test("same-channel system variants do not borrow capabilities or reroute incompatible selections", () => {
    const config = sameChannelVariants();
    config.channels[0].modelCosts![0].capabilityConfig!.video!.references.maxImages = 0;
    config.channels[0].modelCosts![1].capabilityConfig!.video!.references.maxImages = 2;
    const requirements = { capability: "video" as const, input: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } };
    expect(modelGroupReferenceLimits(config, "comfy::h3-fast", "video")?.maxImages).toBe(0);
    expect(modelCompatibilityError(config, "comfy::h3-fast", requirements)).not.toBe("");
    expect(resolveCompatibleModel(config, "comfy::h3-fast", requirements)).toBe("");
    expect(resolveCompatibleModel(config, "comfy::h3-multi", requirements)).toBe("comfy::h3-multi");
});

test("different display names in one channel create distinct first-level groups", () => {
    const config = fixture();
    const extra = systemChannelModelChannels([{ id: "volc", name: "火山引擎", displayName: "火山引擎", models: [
        model("Seedance 2 Mini", 300000, "seedance-2-mini", "Seedance 2 Mini"),
        model("Seedance 2.0 Fast", 300000, "seedance-2-fast", "Seedance 2.0 Fast"),
        model("Seedance 2.0", 300000, "seedance-2", "Seedance 2.0"),
    ] }]);
    const groups = groupModelsForPicker({ ...config, channels: extra }, selectableModelsByCapability({ ...config, channels: extra }, "video"));
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.label)).toEqual(["Seedance 2 Mini", "Seedance 2.0 Fast", "Seedance 2.0"]);
    expect(groups.every((group) => group.kind === "product" && group.models.length === 1)).toBe(true);
});

test("group metadata is stable across channel reorder and current selection", () => {
    const config = fixture();
    config.channels[1].modelCosts![0].displayName = "不同展示名";
    config.channels[1].modelCosts![0].icon = "Jimeng";
    const options = selectableModelsByCapability(config, "video");
    const first = groupModelsForPicker(config, options).find((group) => group.label === "不同展示名")!;
    const reordered = groupModelsForPicker({ ...config, channels: [...config.channels].reverse(), model: "c::seedance-2.0" }, options).find((group) => group.label === "不同展示名")!;
    expect([reordered.label, reordered.icon]).toEqual([first.label, first.icon]);
    expect(reordered.models[0].models).toEqual(["b::seedance-2.0"]);
});

test("each channel keeps its own capability restrictions", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].capabilityConfig!.video!.references.maxImages = 0;
    config.channels[1].modelCosts![0].capabilityConfig!.video!.references.maxImages = 2;
    config.channels[1].modelCosts![0].capabilityConfig!.video!.operations = ["image_to_video"];
    const requirements = { capability: "video" as const, input: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } };
    expect(modelCompatibilityError(config, "a::seedance-2.0", requirements)).not.toBe("");
    expect(modelCompatibilityError(config, "b::seedance-2.0", requirements)).toBe("");
    expect(groupModelsForPicker(config, selectableModelsByCapability(config, "video"))[0].models).toHaveLength(3);
});

test("managed logical models and personal channels never become system product routes", () => {
    const config = fixture();
    config.channels[1].id = "managed";
    config.channels[1].modelCosts![0].logicalModelId = "logical-test";
    config.channels[2].scope = "user";
    const groups = groupModelsForPicker(config, ["a::seedance-2.0", "managed::seedance-2.0", "c::seedance-2.0"]);
    expect(groups.map((item) => item.kind)).toEqual(["product", "channel", "channel"]);
    expect(groups[0].models).toHaveLength(1);
    expect(groupModelsForPicker(config, [])).toEqual([]);
});
