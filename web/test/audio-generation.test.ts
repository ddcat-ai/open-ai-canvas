import { describe, expect, test } from "bun:test";
import { doubaoAudioVoiceOptions, isDoubaoAudioConfig, normalizeAudioSpeedValue, normalizeAudioVoiceForConfig, normalizeAudioVoiceValue } from "../src/lib/audio-generation";

const config = (protocol: string) =>
    ({
        provider: "custom",
        model: "models/index-tts",
        audioModel: "models/index-tts",
        apiKey: "",
        baseUrl: "",
        channels: [{ models: ["index-tts"], modelCosts: [], interfaceType: protocol, baseUrl: "", apiKey: "" }],
    }) as any;

describe("audio speed normalization", () => {
    test("uses normal speed for missing or blank values", () => {
        for (const value of ["", "   ", undefined, null, "invalid"]) {
            expect(normalizeAudioSpeedValue(value as any)).toBe("1");
        }
    });

    test("preserves explicit speeds and clamps numeric limits", () => {
        expect(normalizeAudioSpeedValue("0.8")).toBe("0.8");
        expect(normalizeAudioSpeedValue("1")).toBe("1");
        expect(normalizeAudioSpeedValue("1.25")).toBe("1.25");
        expect(normalizeAudioSpeedValue("0")).toBe("0.25");
        expect(normalizeAudioSpeedValue("5")).toBe("4");
    });
});

describe("audio voice protocol handling", () => {
    test("keeps custom voice identifiers for non-OpenAI channels", () => {
        expect(normalizeAudioVoiceValue("voice_001")).toBe("voice_001");
    });

    test("uses provider-specific Doubao defaults instead of OpenAI alloy", () => {
        const doubao = { ...config("doubao-streaming-tts"), model: "seed-audio-1.0", audioModel: "seed-audio-1.0" } as any;
        expect(isDoubaoAudioConfig(doubao)).toBe(true);
        expect(normalizeAudioVoiceForConfig(doubao, "alloy")).toBe("");
    });

    test("offers synthesis 2.0 voices for audio generation 1.0", () => {
        const values = doubaoAudioVoiceOptions.map((item) => item.value);
        expect(new Set(values).size).toBe(values.length);
        expect(values).toContain("zh_female_vv_uranus_bigtts");
        expect(values).toContain("zh_female_xiaohe_uranus_bigtts");
        expect(values).toContain("zh_male_m191_uranus_bigtts");
        expect(values).toContain("zh_male_taocheng_uranus_bigtts");
        expect(values.every((value) => value.endsWith("_uranus_bigtts"))).toBe(true);
    });

    test("preserves manually entered official Doubao speaker IDs", () => {
        const doubao = { ...config("doubao-streaming-tts"), model: "seed-audio-1.0", audioModel: "seed-audio-1.0" } as any;
        expect(normalizeAudioVoiceForConfig(doubao, "zh_male_custom_official_speaker")).toBe("zh_male_custom_official_speaker");
    });
});
