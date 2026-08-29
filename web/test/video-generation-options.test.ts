import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { formatVideoResolutionLabel, normalizeVideoResolution, videoDimensionsForRatioAndResolution, videoResolutionComparisonKey, VIDEO_RESOLUTION_CAPABILITY_OPTIONS, VIDEO_RESOLUTION_OPTIONS } from "../src/lib/video-generation-options";

describe("video generation resolution options", () => {
    test("统一档位包含 1440P 与 4K，并识别常见别名", () => {
        expect(VIDEO_RESOLUTION_OPTIONS).toEqual([480, 720, 1080, 1440, 2160]);
        expect(VIDEO_RESOLUTION_CAPABILITY_OPTIONS).toEqual(["480p", "720p", "1080p", "1440p", "2160p"]);
        expect(normalizeVideoResolution("2k")).toBe("1440");
        expect(normalizeVideoResolution("1440p")).toBe("1440");
        expect(normalizeVideoResolution("4K")).toBe("2160");
    });

    test("保留模型声明的非标准档位而不是静默降级", () => {
        expect(normalizeVideoResolution("768p")).toBe("768");
        expect(normalizeVideoResolution("768p竖")).toBe("768p竖");
        expect(normalizeVideoResolution("HD_Portrait")).toBe("HD_Portrait");
        expect(videoResolutionComparisonKey("768P竖")).toBe("768p竖");
        expect(formatVideoResolutionLabel("768p竖")).toBe("768P竖");
    });

    test("根据当前比例和分辨率推导视频尺寸", () => {
        expect(videoDimensionsForRatioAndResolution("16:9", "720p")).toEqual({ width: 1280, height: 720 });
        expect(videoDimensionsForRatioAndResolution("16:9", "1080P")).toEqual({ width: 1920, height: 1080 });
        expect(videoDimensionsForRatioAndResolution("16:9", "4K")).toEqual({ width: 3840, height: 2160 });
        expect(videoDimensionsForRatioAndResolution("9:16", "1080p")).toEqual({ width: 1080, height: 1920 });
        expect(videoDimensionsForRatioAndResolution("1:1", "1440p")).toEqual({ width: 1440, height: 1440 });
        expect(videoDimensionsForRatioAndResolution("adaptive", "1080p")).toBeUndefined();
    });

    test("按协议限制实际可选档位", () => {
        expect(defaultModelCapabilityConfig("newapi-channel-2").video?.resolutions).toEqual(["480p", "720p", "1080p", "1440p", "2160p"]);
        expect(defaultModelCapabilityConfig("volcengine-ark-video").video?.resolutions).toEqual(["480p", "720p", "1080p"]);
        expect(defaultModelCapabilityConfig("volcengine-jimeng-video").video?.resolutions).toEqual(["720p"]);
        expect(defaultModelCapabilityConfig("gemini-veo").video?.resolutions).toEqual(["720p", "1080p"]);
    });

    test("火山方舟默认开启全模态参考模式", () => {
        expect(defaultModelCapabilityConfig("volcengine-ark-video").video?.operations).toEqual(expect.arrayContaining(["reference_to_video", "audio_to_video"]));
    });
});
