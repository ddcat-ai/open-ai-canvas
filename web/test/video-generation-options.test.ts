import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { normalizeVideoResolution, VIDEO_RESOLUTION_CAPABILITY_OPTIONS, VIDEO_RESOLUTION_OPTIONS } from "../src/lib/video-generation-options";

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
