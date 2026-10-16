import { expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as modelPicker from "../src/components/model-picker";
import * as videoSettingsPanel from "../src/components/video-settings-panel";
import { CanvasAgentVideoApprovalSettings } from "../src/components/canvas/canvas-agent-video-approval-settings";
import { agentVideoSettingsForModel } from "../src/lib/canvas/agent-media-approval";
import { canvasThemes } from "../src/lib/canvas-theme";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocol } from "../src/lib/model-protocols";
import type { AgentMediaSettings } from "../src/services/api/agent";
import * as configStore from "../src/stores/use-config-store";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";

function fixture(supported = false, protocol: ModelProtocol = "minimax-video", logicalModelId?: string) {
    const model = "video-model";
    const capabilityConfig = defaultModelCapabilityConfig("minimax-video", model);
    capabilityConfig.video!.generateAudio = { supported, default: false };
    capabilityConfig.video!.watermark = { supported, default: false };
    capabilityConfig.video!.duration = { selection: "enum", values: [4, 8, 15], default: 15 };
    capabilityConfig.video!.ratios = ["9:16", "16:9"];
    capabilityConfig.video!.defaultRatio = "9:16";
    capabilityConfig.video!.resolutions = ["768P", "2K"];
    capabilityConfig.video!.defaultResolution = "768P";
    const channel = createModelChannel({
        id: "platform",
        scope: "system",
        interfaceType: protocol,
        models: [model],
        modelCosts: [{ model, capability: "video", capabilityConfig, protocol, logicalModelId, billingMode: "per_second", unitPriceMicrocredits: 1 }],
    });
    return { config: { ...defaultConfig, channels: [channel] }, model: encodeChannelModel(channel.id, model) };
}

test("switching approval model clears hidden unsupported switches and replaces old model identity", () => {
    const { config, model } = fixture();
    const previous = { logicalModelId: "old-model", size: "1:1", quality: "720p", durationSeconds: 30, videoGenerateAudio: true, videoWatermark: true, videoArkPrivateAssetUpload: true };
    expect(agentVideoSettingsForModel(config, model, previous)).toEqual({
        channelId: "platform",
        channelModelKey: "video-model",
        size: "9:16",
        quality: "768P",
        durationSeconds: 15,
        videoGenerateAudio: false,
        videoWatermark: false,
        videoArkPrivateAssetUpload: undefined,
    });
    expect(previous.videoGenerateAudio).toBe(true);
    expect(previous.logicalModelId).toBe("old-model");
});

test.each([true, false, undefined])("supported audio and watermark preserve explicit %s or use model defaults", (value) => {
    const { config, model } = fixture(true);
    const result = agentVideoSettingsForModel(config, model, { size: "16:9", quality: "2K", durationSeconds: 8, videoGenerateAudio: value, videoWatermark: value });
    expect(result).toMatchObject({ size: "16:9", quality: "2K", durationSeconds: 8, videoGenerateAudio: value ?? false, videoWatermark: value ?? false });
});

test("Ark-specific upload preference stays with Ark protocols only", () => {
    const { config, model } = fixture(true, "volcengine-ark-video");
    expect(agentVideoSettingsForModel(config, model, { size: "9:16", quality: "768P", videoArkPrivateAssetUpload: false }).videoArkPrivateAssetUpload).toBe(false);
});

test("selecting a logical model drops the previous channel identity", () => {
    const { config, model } = fixture(false, "minimax-video", "logical-video");
    const result = agentVideoSettingsForModel(config, model, { channelId: "old-channel", channelModelKey: "old", size: "9:16", quality: "768P" });
    expect(result.logicalModelId).toBe("logical-video");
    expect(result.channelId).toBeUndefined();
    expect(result.channelModelKey).toBeUndefined();
});

test("approval component callbacks submit normalized settings on model and option changes", () => {
    const { config, model } = fixture();
    const nextValues: AgentMediaSettings[] = [];
    let chooseModel: ((model: string) => void) | undefined;
    let changeOption: ((key: "videoSeconds", value: string) => void) | undefined;
    const spies = [
        spyOn(configStore, "useEffectiveConfig").mockReturnValue(config),
        spyOn(modelPicker, "ModelPicker").mockImplementation((props) => {
            chooseModel = props.onChange;
            return createElement("div");
        }),
        spyOn(videoSettingsPanel, "VideoSettingsPanel").mockImplementation((props) => {
            changeOption = props.onConfigChange;
            return createElement("div");
        }),
    ];
    try {
        const props = {
            initial: {
                channelId: "platform",
                channelModelKey: "video-model",
                size: "9:16",
                quality: "768P",
                durationSeconds: 15,
                videoGenerateAudio: true,
                videoWatermark: true,
                videoArkPrivateAssetUpload: true,
                prompt: "Animate",
                referenceNodeIds: ["image"],
                referenceTransientIds: [],
                sourceNodeId: "",
            },
            theme: canvasThemes.light,
            disabled: false,
            onChange: (value: AgentMediaSettings) => nextValues.push(value),
        };
        renderToStaticMarkup(createElement(CanvasAgentVideoApprovalSettings, props));
        expect(chooseModel).toBeDefined();
        chooseModel!(model);
        expect(nextValues[0]).toMatchObject({ channelId: "platform", channelModelKey: "video-model", videoGenerateAudio: false, videoWatermark: false });
        expect(nextValues[0].videoArkPrivateAssetUpload).toBeUndefined();
        changeOption!("videoSeconds", "8");
        expect(nextValues[1]).toMatchObject({ channelId: "platform", channelModelKey: "video-model", durationSeconds: 8, videoGenerateAudio: false, videoWatermark: false });
        const html = renderToStaticMarkup(createElement(CanvasAgentVideoApprovalSettings, { ...props, value: nextValues[0] }));
        expect(html).toContain("音频：关闭");
        expect(html).toContain("水印：关闭");
    } finally {
        for (const spy of spies) spy.mockRestore();
    }
});
