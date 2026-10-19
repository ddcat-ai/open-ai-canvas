import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, videoDurationOptions } from "../src/lib/model-capabilities";
import { modelCompatibilityError } from "../src/lib/model-selection";
import { assertVideoCapability } from "../src/services/api/video-validation";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";

function profile() {
    const video = defaultModelCapabilityConfig("minimax-video").video!;
    return {
        ...video,
        duration: { selection: "range" as const, min: 1, max: 15, step: 1, default: 5 },
        resolutions: ["768p", "1080p"],
        defaultResolution: "768p",
        durationByResolution: {
            "768p": { selection: "range" as const, min: 1, max: 20, step: 1, default: 5 },
            "1080p": { selection: "enum" as const, values: [5, 10], default: 5 },
        },
    };
}

test("video admission uses the selected resolution duration", () => {
    expect(() => assertVideoCapability(profile(), [], [], [], "15", "1080p")).toThrow("视频时长");
    expect(() => assertVideoCapability(profile(), [], [], [], "20", "768p")).not.toThrow();
});

test("the real video panel renders the selected resolution duration choices", () => {
    const config: AiConfig = {
        ...defaultConfig,
        model: "channel::video",
        videoModel: "channel::video",
        videoSeconds: "10",
        vquality: "1080p",
        channels: [{ id: "channel", name: "Video", models: ["video"], baseUrl: "", apiKey: "", apiFormat: "openai", modelCosts: [{ model: "video", capability: "video", protocol: "minimax-video", capabilityConfig: { version: 1, video: profile() } }] }],
    };
    const html = renderToStaticMarkup(<VideoSettingsPanel config={config} onConfigChange={() => {}} theme={canvasThemes.dark} />);
    expect(html).toContain(">10s<");
    expect(html).not.toContain('max="15"');
});

test("logical video matching uses per resolution constraints instead of the global range", () => {
    const spec = {
        version: 1 as const,
        capability: "video" as const,
        options: { vquality: { values: ["768p", "1080p"] }, videoSeconds: { min: 1, max: 15, step: 1 } },
        videoDurationByResolution: { "768p": { min: 1, max: 20, step: 1 }, "1080p": { values: [5, 10] } },
    };
    const config: AiConfig = { ...defaultConfig, channels: [{ id: "channel", name: "Video", models: ["video"], baseUrl: "", apiKey: "", apiFormat: "openai", modelCosts: [{ model: "video", capability: "video", logicalCapabilitySpec: spec }] }] };
    expect(modelCompatibilityError(config, "channel::video", { capability: "video", videoSeconds: "15", options: { vquality: "1080p" } })).toContain("时长");
    expect(modelCompatibilityError(config, "channel::video", { capability: "video", videoSeconds: "20", options: { vquality: "768p" } })).toBe("");
});

test("fixed screen preset labels retain independent duration rules", () => {
    const video = {
        ...profile(),
        resolutions: ["480p横", "768p竖"],
        defaultResolution: "480p横",
        durationByResolution: { "480p横": { selection: "enum" as const, values: [5], default: 5 }, "768p竖": { selection: "enum" as const, values: [10], default: 10 } },
    };
    const normalized = normalizeModelCapabilityConfig({ version: 1, video }).video!;
    expect(videoDurationOptions(normalized, "480p横")).toEqual([5]);
    expect(videoDurationOptions(normalized, "768p竖")).toEqual([10]);
});
