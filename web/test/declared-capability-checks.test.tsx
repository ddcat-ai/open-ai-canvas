import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { audioFormatOptionsForConfig, audioProviderNotesVisible, audioReferenceLimitsForConfig, audioVoiceIsFreeform, audioVoiceOptionsForConfig, normalizeAudioVoiceForConfig } from "../src/lib/audio-generation";
import { emotionGenerationSize, emotionGenerationSizeForProfile, resolveEmotionEditPlan } from "../src/lib/canvas/canvas-emotion";
import { imageLayerGenerationConfig, imageLayerProviderMetadata } from "../src/lib/canvas/canvas-image-layers";
import { supportsVideoReferenceAudio } from "../src/lib/canvas/canvas-project-generation";
import { videoReferenceSegmentError } from "../src/lib/canvas/canvas-video-regeneration";
import { canvasThemes } from "../src/lib/canvas-theme";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { resolveModelAdaptationProfile } from "../src/lib/plugins/builtin/prompt-optimizer";
import { audioReferenceCapacity, modelCompatibilityError } from "../src/lib/model-selection";
import { isSeedanceConfig } from "../src/services/api/video-provider-seedance";
import { defaultConfig, useConfigStore, type AiConfig } from "../src/stores/use-config-store";

const theme = Object.values(canvasThemes)[0];

/** 插件万相视频模型：能力与 catalog 声明一致（maxAudios=5，无 minVideoDurationSeconds）。 */
const wanVideo = {
    version: 1,
    video: {
        references: { promptMaxChars: 8000, minImages: 0, maxImages: 10, maxImageBytes: 31457280, maxVideos: 5, maxVideoBytes: 52428800, maxVideoDurationSeconds: 30, maxAudios: 5, maxAudioBytes: 15728640, maxAudioDurationSeconds: 30 },
        duration: { selection: "range", min: 2, max: 30, step: 1, default: 5 },
        ratios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        defaultRatio: "16:9",
        resolutions: ["480p", "720p", "1080p"],
        defaultResolution: "720p",
        generateAudio: { supported: false, default: false },
        watermark: { supported: false, default: false },
        operations: ["text_to_video", "image_to_video", "reference_to_video"],
        defaultOperation: "text_to_video",
    },
};

/** 插件 Seedance 模型：名字带 seedance，但参数档位完全来自能力声明。 */
const seedanceVideo = {
    version: 1,
    video: {
        references: { promptMaxChars: 8000, minImages: 0, maxImages: 9, maxImageBytes: 31457280, maxVideos: 3, maxVideoBytes: 52428800, maxVideoDurationSeconds: 15, maxAudios: 3, maxAudioBytes: 15728640, maxAudioDurationSeconds: 15 },
        duration: { selection: "enum", values: [5, 10], default: 5 },
        ratios: ["16:9", "9:16", "1:1"],
        defaultRatio: "16:9",
        resolutions: ["720p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: false },
        watermark: { supported: false, default: false },
        operations: ["text_to_video", "image_to_video"],
        defaultOperation: "text_to_video",
    },
};

/** 插件图片模型：能力声明用比例，不支持蒙版，vendor 侧靠插件参数绑定透明底。 */
const bananaImage = (overrides: { maskSupported?: boolean; transparentBackground?: boolean; backgroundParameter?: "same-name" | "binding"; sizeParameter?: "aspect_ratio" | "size" } = {}) => ({
    version: 1,
    image: {
        parameters:
            overrides.backgroundParameter === "binding"
                ? [{ name: "background", label: "背景", type: "string", values: ["opaque", "transparent"], default: "opaque", binding: "transparentBackground" }]
                : overrides.transparentBackground
                  ? [{ name: "transparentBackground", label: "透明底", type: "boolean", default: false, binding: "transparentBackground" }]
                  : undefined,
        references: { promptMaxChars: 32000, maxImages: 16, maxImageBytes: 31457280, maskSupported: overrides.maskSupported === true },
        size: { parameter: overrides.sizeParameter || "aspect_ratio", values: ["1:1", "16:9", "9:16", "3:4", "4:3"], default: "1:1", allowCustom: false },
        resolution: { supported: true, values: ["1K", "2K"], default: "1K" },
        quality: { supported: false, values: [], default: "auto" },
        transparentBackground: { supported: overrides.transparentBackground === true, default: false },
        responseFormat: { supported: false, default: "auto" },
        outputFormat: { supported: false },
        maxOutputs: 1,
    },
});

function channelConfig(capability: "image" | "video" | "audio", protocol: string, model: string, capabilityConfig: Record<string, unknown>, baseUrl = "https://vendor.example.com"): AiConfig {
    return {
        ...defaultConfig,
        model: `ch::${model}`,
        imageModel: `ch::${model}`,
        videoModel: `ch::${model}`,
        audioModel: `ch::${model}`,
        channels: [
            {
                id: "ch",
                name: "vendor",
                baseUrl,
                apiKey: "test-key",
                apiFormat: "openai",
                models: [model],
                scope: "user",
                modelCosts: [{ model, capability, protocol, billingMode: "per_second", unitPriceMicrocredits: 1, capabilityConfig: capabilityConfig as never }],
            },
        ],
    };
}

afterEach(() => {
    useConfigStore.setState({ config: defaultConfig });
});

describe("G18 视频重试带参考音频按能力判断", () => {
    test("万相（maxAudios=5，协议 vendor-video-wan3）能带参考音频", () => {
        const config = channelConfig("video", "vendor-video-wan3", "wan3-0-video-wan", wanVideo);
        expect(supportsVideoReferenceAudio(config)).toBe(true);
    });

    test("能力未声明参考音频的插件视频不带参考音频", () => {
        const capability = structuredClone(wanVideo);
        capability.video.references.maxAudios = 0;
        const config = channelConfig("video", "vendor-video", "kling-video-v4-tencent", capability);
        expect(supportsVideoReferenceAudio(config)).toBe(false);
    });

    test("名字带 seedance 但能力 maxAudios=0 时不再按名字放开", () => {
        const capability = structuredClone(seedanceVideo);
        capability.video.references.maxAudios = 0;
        const config = channelConfig("video", "vendor-video-seedance", "seedance-2-5-deal", capability);
        expect(supportsVideoReferenceAudio(config)).toBe(false);
    });

    test("内置 NewAPI 视频协议保留原有分支", () => {
        const config = channelConfig("video", "newapi-channel-2", "some-video", { version: 1, video: defaultModelCapabilityConfig("newapi-channel-2", "some-video").video });
        expect(supportsVideoReferenceAudio(config)).toBe(true);
    });
});

describe("G17 参考视频最短时长按能力字段", () => {
    test("能力声明 minVideoDurationSeconds=2 时拦截过短片段", () => {
        const capability = { ...structuredClone(seedanceVideo), video: { ...structuredClone(seedanceVideo.video), references: { ...structuredClone(seedanceVideo.video.references), minVideoDurationSeconds: 2 } } };
        const config = channelConfig("video", "vendor-video-seedance", "seedance-2-5-deal", capability);
        expect(videoReferenceSegmentError(config, 1500)).toContain("至少 2 秒");
        expect(videoReferenceSegmentError(config, 2500)).toBe("");
    });

    test("能力没有声明最短时长时不设下限（不再按 Seedance 名字写死）", () => {
        const config = channelConfig("video", "vendor-video-seedance", "seedance-2-5-deal", seedanceVideo);
        expect(videoReferenceSegmentError(config, 1500)).toBe("");
    });

    test("内置方舟 /  Agent Plan / NewAPI 四个协议的默认能力仍保留 2 秒下限", () => {
        for (const protocol of ["volcengine-ark-video", "volcengine-ark-agent-plan-video", "newapi-channel-1", "newapi-channel-2"]) {
            const capability = defaultModelCapabilityConfig(protocol, "video-model");
            expect(capability.video?.references.minVideoDurationSeconds).toBe(2);
            const config = channelConfig("video", protocol, "video-model", capability as unknown as Record<string, unknown>);
            expect(videoReferenceSegmentError(config, 1500)).toContain("至少 2 秒");
            expect(videoReferenceSegmentError(config, 2500)).toBe("");
        }
    });

    test("其余协议的默认能力不设最短参考视频时长", () => {
        for (const protocol of ["gemini-veo", "volcengine-jimeng-video", "minimax-video"]) {
            expect(defaultModelCapabilityConfig(protocol, "video-model").video?.references.minVideoDurationSeconds).toBeUndefined();
        }
    });
});

describe("G17 视频设置面板统一读能力声明", () => {
    test("名字带 seedance 的模型用通用面板，档位等于能力声明", () => {
        const config = channelConfig("video", "vendor-video-seedance", "doubao-seedance-2-0-fast-official-token", seedanceVideo);
        const html = renderToStaticMarkup(<VideoSettingsPanel config={config} onConfigChange={() => {}} theme={theme} />);
        expect(html).not.toContain("fast 模型自动使用 720P");
        expect(html).toContain("分辨率");
        expect(html).toContain("720P");
        // 能力只声明 720p，因此不会出现 Seedance 面板的 1080P / 480P 档
        expect(html).not.toContain("1080P");
        expect(html).not.toContain("480P");
        // 比例档位等于能力声明（16:9 / 9:16 / 1:1），不再固定 7 档
        for (const ratio of ["16:9", "9:16", "1:1"]) expect(html).toContain(ratio);
        expect(html).not.toContain("21:9");
        expect(html).not.toContain("adaptive");
        // 秒数等于能力声明的枚举
        expect(html).toContain("5s");
        expect(html).toContain("10s");
        expect(html).not.toContain("15s");
    });

    test("万相模型的分辨率/比例来自能力声明，1080p 不会被名字规则禁用", () => {
        const config = channelConfig("video", "vendor-video-wan3", "wan3-0-video-wan", wanVideo);
        const html = renderToStaticMarkup(<VideoSettingsPanel config={config} onConfigChange={() => {}} theme={theme} />);
        for (const resolution of ["480P", "720P", "1080P"]) expect(html).toContain(resolution);
        for (const ratio of ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]) expect(html).toContain(ratio);
        expect(html).not.toContain('disabled=""');
        // 内置方舟协议才出现可信素材开关；插件视频不出现
        expect(html).not.toContain("自动同步可信素材");
    });

    test("内置火山方舟视频协议仍显示可信素材开关", () => {
        const config = channelConfig("video", "volcengine-ark-video", "doubao-seedance-2-0-official", seedanceVideo);
        const html = renderToStaticMarkup(<VideoSettingsPanel config={config} onConfigChange={() => {}} theme={theme} />);
        expect(html).toContain("自动同步可信素材");
    });
});

describe("G19 表情调整按能力判断", () => {
    test("maskSupported=false 的图片模型走本地裁脸融合，尺寸传比例不传像素", () => {
        const config = channelConfig("image", "vendor-image-banana", "nano-banana-2", bananaImage({ maskSupported: false }));
        const profile = modelCapabilityConfigForTest(config);
        expect(resolveEmotionEditPlan(profile!.references.maskSupported)).toMatchObject({ mode: "local-composite", includeMask: false });
        const wide = emotionGenerationSizeForProfile({ x: 0, y: 0, width: 640, height: 360 }, profile!);
        expect(wide).toBe("16:9");
        expect(wide).not.toMatch(/x/);
        const tall = emotionGenerationSizeForProfile({ x: 0, y: 0, width: 360, height: 640 }, profile!);
        expect(tall).toBe("9:16");
    });

    test("maskSupported=true 的图片模型仍走 provider 蒙版", () => {
        const config = channelConfig("image", "vendor-image-banana", "nano-banana-2", bananaImage({ maskSupported: true }));
        const profile = modelCapabilityConfigForTest(config);
        expect(resolveEmotionEditPlan(profile!.references.maskSupported)).toMatchObject({ mode: "provider-mask", includeMask: true });
    });

    test(" openai-image 模型的像素尺寸与蒙版行为不变", () => {
        const config = channelConfig("image", "openai-image", "gpt-image-2.5", defaultModelCapabilityConfig("openai-image", "gpt-image-2.5") as unknown as Record<string, unknown>);
        const profile = modelCapabilityConfigForTest(config);
        expect(resolveEmotionEditPlan(profile!.references.maskSupported)).toMatchObject({ mode: "provider-mask", includeMask: true });
        expect(emotionGenerationSizeForProfile({ x: 0, y: 0, width: 640, height: 360 }, profile!)).toBe(emotionGenerationSize({ x: 0, y: 0, width: 640, height: 360 }));
        expect(emotionGenerationSizeForProfile({ x: 0, y: 0, width: 640, height: 360 }, profile!)).toBe("1536x1024");
    });
});

describe("G20 拆层透明底按插件参数绑定", () => {
    test(" openai-image 仍用 providerOptions.background", () => {
        const config = channelConfig("image", "openai-image", "gpt-image-2.5", defaultModelCapabilityConfig("openai-image", "gpt-image-2.5") as unknown as Record<string, unknown>);
        expect(imageLayerProviderMetadata(config, 0)).toEqual({ providerOptions: { "openai-image": { background: "opaque" } } });
        expect(imageLayerProviderMetadata(config, 1)).toEqual({ providerOptions: { "openai-image": { background: "transparent" } } });
    });

    test("能力声明透明底的插件模型按 transparentBackground 参数绑定传", () => {
        const config = channelConfig("image", "vendor-image-gpt-2-5", "gpt-image-2-5-deal", bananaImage({ transparentBackground: true }));
        expect(imageLayerProviderMetadata(config, 0)).toEqual({ transparentBackground: "false" });
        expect(imageLayerProviderMetadata(config, 1)).toEqual({ transparentBackground: "true" });
        const layer = imageLayerGenerationConfig(config, { prompt: "前景", background: "transparent" }, 1);
        expect(layer.transparentBackground).toBe("true");
    });

    test("插件参数名与宿主控件不同名时通过 binding 写入扩展参数", () => {
        const config = channelConfig("image", "vendor-image-gpt-2-5", "gpt-image-2-5-deal", bananaImage({ transparentBackground: true, backgroundParameter: "binding" }));
        const layer = imageLayerGenerationConfig(config, { prompt: "前景", background: "transparent" }, 1);
        expect(layer.transparentBackground).toBe("true");
        expect(JSON.parse(layer.imageParameters || "{}")).toMatchObject({ background: "true" });
    });

    test("能力未声明透明底的模型不凭空下发透明参数", () => {
        const config = channelConfig("image", "vendor-image-banana", "nano-banana-2", bananaImage());
        expect(imageLayerProviderMetadata(config, 1)).toEqual({});
        expect(imageLayerGenerationConfig(config, { prompt: "前景", background: "transparent" }, 1).imageParameters).toBeUndefined();
    });
});

describe("G21 音频音色/格式/参考素材容量按能力声明", () => {
    const audioCapability = {
        version: 1,
        audio: {
            references: { maxAudios: 2, maxImages: 1 },
            voices: [
                { value: "voice-a", label: "音色 A" },
                { value: "voice-b", label: "音色 B" },
            ],
            formats: [
                { value: "wav", label: "WAV" },
                { value: "mp3", label: "MP3" },
            ],
            voiceInput: "free",
            providerNotes: true,
        },
    };

    test("音色/格式/容量来自能力声明", () => {
        const config = channelConfig("audio", "vendor-audio", "voice-model", audioCapability);
        expect(audioVoiceOptionsForConfig(config).map((item) => item.value)).toEqual(["voice-a", "voice-b"]);
        expect(audioFormatOptionsForConfig(config).map((item) => item.value)).toEqual(["wav", "mp3"]);
        expect(audioVoiceIsFreeform(config)).toBe(true);
        expect(audioProviderNotesVisible(config)).toBe(true);
        expect(audioReferenceLimitsForConfig(config)).toEqual({ maxAudios: 2, maxImages: 1 });
        expect(audioReferenceCapacity(config, "ch::voice-model")).toBe(2);
        expect(normalizeAudioVoiceForConfig(config, "alloy")).toBe("");
        expect(modelCompatibilityError(config, "ch::voice-model", { capability: "audio", input: { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 3, characterCount: 0 } })).toContain("最多支持 2 个参考音频");
    });

    test("没有音频能力的模型保持 OpenAI 兜底", () => {
        const config = { ...defaultConfig, model: "openai::tts-1", audioModel: "openai::tts-1" };
        expect(audioVoiceOptionsForConfig(config).some((item) => item.value === "alloy")).toBe(true);
        expect(audioReferenceLimitsForConfig(config)).toEqual({ maxAudios: 0, maxImages: 0 });
        expect(audioReferenceCapacity(config, "openai::tts-1")).toBe(0);
        expect(audioVoiceIsFreeform(config)).toBe(false);
        expect(audioProviderNotesVisible(config)).toBe(false);
    });

    test("豆包音频协议行为不变", () => {
        const config = channelConfig("audio", "doubao-streaming-tts", "seed-audio-1.0", {});
        expect(audioReferenceCapacity(config, "ch::seed-audio-1.0")).toBe(3);
        expect(audioReferenceLimitsForConfig(config)).toEqual({ maxAudios: 3, maxImages: 1 });
        expect(audioVoiceIsFreeform(config)).toBe(true);
        expect(audioProviderNotesVisible(config)).toBe(true);
        expect(audioVoiceOptionsForConfig(config).some((item) => item.value === "zh_female_shuangkuaisisi_moon_bigtts")).toBe(true);
    });
});

describe("G05 提示词适配先读 promptFamily", () => {
    test("能力声明 promptFamily 时不再按模型名猜模型族", () => {
        const config = channelConfig("video", "vendor-video", "omni-flow", { version: 1, promptFamily: "kling-video" });
        useConfigStore.setState({ config });
        expect(resolveModelAdaptationProfile({ prompt: "p", mode: "model-adapt", generationMode: "video", targetModel: "ch::omni-flow", targetProtocol: "vendor-video" }).id).toBe("kling-video");
    });

    test("未声明 promptFamily 时保留原来的模型名关键词策略", () => {
        const config = channelConfig("video", "vendor-video-flow", "veo-lite-flow", { version: 1 });
        useConfigStore.setState({ config });
        expect(resolveModelAdaptationProfile({ prompt: "p", mode: "model-adapt", generationMode: "video", targetModel: "ch::veo-lite-flow", targetProtocol: "vendor-video-flow" }).id).toBe("veo-video");
    });

    test("图片族按 promptFamily 走，未知族回落到通用画像", () => {
        const config = channelConfig("image", "vendor-image-banana", "nano-banana-pro-unified", { version: 1, promptFamily: "gemini-image" });
        useConfigStore.setState({ config });
        expect(resolveModelAdaptationProfile({ prompt: "p", mode: "model-adapt", generationMode: "image", targetModel: "ch::nano-banana-pro-unified" }).id).toBe("gemini-image");
        const unknown = channelConfig("image", "vendor-image-banana", "nano-banana-pro-unified", { version: 1, promptFamily: "not-a-family" });
        useConfigStore.setState({ config: unknown });
        expect(resolveModelAdaptationProfile({ prompt: "p", mode: "model-adapt", generationMode: "image", targetModel: "ch::nano-banana-pro-unified" }).id).toBe("generic-image");
    });
});

describe("G22 测试按钮的协议分派", () => {
    test("名字带 seedance 的插件模型不再走手写 Seedance 请求", () => {
        const config = channelConfig("video", "vendor-video-seedance", "seedance-2-5-deal", seedanceVideo);
        expect(isSeedanceConfig({ ...config, model: "seedance-2-5-deal", interfaceType: "vendor-video-seedance" } as never)).toBe(false);
        expect(isSeedanceConfig({ ...config, model: "seedance-2-5-deal", interfaceType: "volcengine-ark-video" } as never)).toBe(true);
    });
});

function modelCapabilityConfigForTest(config: AiConfig) {
    // 与页面一致：走 modelCapabilityConfigFor(config, 选中模型)
    return modelCapabilityConfigFor(config, config.model).image;
}
