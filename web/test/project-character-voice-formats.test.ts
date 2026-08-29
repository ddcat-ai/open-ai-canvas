import { describe, expect, test } from "bun:test";

import { audioFileExtension, characterVoiceTitleFromFileName, isSupportedCharacterVoiceFile } from "@/lib/character-voice-formats";

describe("角色声音格式", () => {
    test("接受浏览器可试听的常用音频格式", () => {
        for (const [name, type] of [
            ["voice.mp3", "audio/mpeg"],
            ["voice.wav", "audio/x-wav"],
            ["voice.m4a", "audio/mp4"],
            ["voice.aac", "audio/aac"],
            ["voice.flac", "audio/flac"],
            ["voice.ogg", "audio/ogg"],
            ["voice.opus", "audio/opus"],
            ["voice.weba", "audio/webm"],
        ]) expect(isSupportedCharacterVoiceFile({ name, type })).toBe(true);
    });

    test("仅在 MIME 未知时使用扩展名兜底", () => {
        expect(isSupportedCharacterVoiceFile({ name: "voice.wav", type: "" })).toBe(true);
        expect(isSupportedCharacterVoiceFile({ name: "video.webm", type: "video/webm" })).toBe(false);
        expect(isSupportedCharacterVoiceFile({ name: "voice.wma", type: "audio/x-ms-wma" })).toBe(false);
    });

    test("生成正确的标题和参考音频扩展名", () => {
        expect(characterVoiceTitleFromFileName("张振天原声.FLAC")).toBe("张振天原声");
        expect(audioFileExtension("audio/mp4", "sample.m4a")).toBe("m4a");
        expect(audioFileExtension("audio/ogg", "sample.opus")).toBe("opus");
        expect(audioFileExtension("audio/wav")).toBe("wav");
    });
});
